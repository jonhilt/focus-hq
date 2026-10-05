import { qaOfficerFor, randomAvatar } from '../../shared/crew';
import { autoQaFor, autoSendBackFor, prKey, sameCommit } from '../../shared/qa';
import type { Agent, AgentStatus, BrowserFrame, Effort, PermissionRequest, PullRequest, QaReport, QaReview, QaScreenshot, TermLine } from '../../shared/types';
import { ACTIVE_STATUSES, DESKS_PER_ROOM, QA_DESK } from '../../shared/types';
import type { GitHubProvider } from '../github/provider';
import type { Hub } from '../hub';
import type { Store } from '../store';
import { decodeImage, errorMessage, newId, slugify, truncate } from '../util';
import { afterCloudRun, carryOnInNewSession, fallBackToLocal } from './cloud';
import { carryOnPrompt, COMMIT_NUDGE, conflictsPrompt, issuePrompt, pickName, pullRequestBody, pushNudge, systemAppend } from './prompts';
import { evidencePath, fixPrompt, keptCaptions, MAX_SCREENSHOTS, parseQaReport, QA_SCHEMA, qaComment, qaPrompt, qaSystemAppend } from './qa';
import type { QaLoopEvent } from './qaLoop';
import { qaNextStep } from './qaLoop';
import { type AgentRunner, type AgentSession, type RunHooks, type WorkspaceOps, STOPPED_BY_CAPTAIN } from './types';

interface Runtime {
  session?: AgentSession;
  /** Messages from the manager that arrived while no session could take them. */
  inbox: string[];
  /** The manager's notes folded into the task when it was handed out, kept in case it has to be told again. */
  notes: string[];
  permission?: { req: PermissionRequest; resolve: (ok: boolean) => void; resume: AgentStatus };
  nudged: boolean;
  busy: boolean;
  /** The QA officer's instructions for the review in hand (they depend on the PR). */
  qaSystem?: string;
  /** The screenshots the QA officer took on purpose this review: how many, and the last MAX_SCREENSHOTS of them. */
  shots?: { taken: number; frames: BrowserFrame[] };
}

const FINISHED: AgentStatus[] = ['done', 'stopped', 'error'];

/** Each room has one QA officer; their agent record is reused from review to review. */
const qaAgentId = (projectId: string) => `qa_${projectId}`;

/** Hires agents, seats them at desks, runs them, and turns their work into pull requests. */
export class AgentManager {
  private runtimes = new Map<string, Runtime>();
  private leaving = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly github: GitHubProvider,
    private readonly runner: AgentRunner,
    private readonly workspace: WorkspaceOps,
    private readonly boardChanged: (projectId: string) => void,
  ) {}

  private rt(id: string): Runtime {
    let rt = this.runtimes.get(id);
    if (!rt) {
      rt = { inbox: [], notes: [], nudged: false, busy: false };
      this.runtimes.set(id, rt);
    }
    return rt;
  }

  private update(agent: Agent, patch: Partial<Agent>): void {
    Object.assign(agent, patch);
    if (!this.store.agents.has(agent.id)) return; // dismissed meanwhile
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
  }

  private print(agent: Agent, lines: Omit<TermLine, 't'>[]): void {
    if (!lines.length || !this.store.agents.has(agent.id)) return;
    const t = Date.now();
    const stamped = lines.map((l) => ({ t, ...l }));
    this.store.appendLines(agent.id, stamped);
    this.hub.send({ type: 'lines', id: agent.id, lines: stamped });
  }

  /** Agents running, everywhere or (QA officers aside, who don't take one of a room's slots) in one project. */
  private activeCount(projectId?: string): number {
    return [...this.store.agents.values()].filter(
      (a) => ACTIVE_STATUSES.includes(a.status) && (!projectId || (a.projectId === projectId && a.task !== 'review')),
    ).length;
  }

  // ---------------------------------------------------------------- hiring

  /** `cloud` puts them in a Claude Code cloud session instead of on this machine. */
  hire(projectId: string, repo: string, issue: { number: number; title?: string; url?: string }, how: { effort?: Effort; cloud?: boolean } = {}): Agent {
    const id = newId('agent');
    const title = issue.title ?? `Issue #${issue.number}`;
    return this.seat(projectId, repo, {
      id,
      task: 'issue',
      issue: { number: issue.number, title, url: issue.url ?? `https://github.com/${repo}/issues/${issue.number}` },
      branch: `focus/${issue.number}-${slugify(title, 30) || 'issue'}-${id.slice(-4)}`,
      baseBranch: 'main',
      effort: how.effort,
      cloud: how.cloud || undefined,
    });
  }

  /**
   * Gets a pull request's merge conflicts resolved. The agent who opened it picks it back up if they're still in
   * the office; otherwise a new agent sits down on the PR's branch.
   */
  resolveConflicts(projectId: string, pr: PullRequest): Agent {
    const owner = this.prOwner(pr.repo, pr.number);
    if (owner) {
      this.update(owner, { baseBranch: pr.baseBranch });
      this.message(owner.id, conflictsPrompt(owner));
      return owner;
    }
    return this.seat(projectId, pr.repo, {
      id: newId('agent'),
      task: 'conflicts',
      issue: { number: pr.number, title: pr.title, url: pr.url },
      branch: pr.branch,
      baseBranch: pr.baseBranch,
      pr: { number: pr.number, url: pr.url },
    });
  }

  /** The agent in the office whose PR this is: the one who opened it, or one seated on it since. */
  private prOwner(repo: string, number: number): Agent | undefined {
    return [...this.store.agents.values()].find((a) => a.task !== 'review' && a.repo === repo && a.pr?.number === number);
  }

  private seat(projectId: string, repo: string, work: Pick<Agent, 'id' | 'task' | 'issue' | 'branch' | 'baseBranch' | 'pr' | 'effort' | 'cloud'>): Agent {
    const project = this.store.project(projectId);
    if (!project.repos.includes(repo)) throw new Error(`${repo} is not connected to ${project.name}`);
    const existing = [...this.store.agents.values()].find(
      (a) => a.repo === repo && a.issue.number === work.issue.number && !FINISHED.includes(a.status),
    );
    if (existing) throw new Error(`${existing.name} is already working on #${work.issue.number}`);

    const desk = this.freeDesk(projectId);
    const name = pickName(new Set([...this.store.agents.values()].map((a) => a.name)));
    const agent: Agent = {
      name,
      avatar: randomAvatar(),
      projectId,
      repo,
      ...work,
      desk,
      status: 'queued',
      activity: 'Waiting for a free slot',
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [{ kind: 'system', text: `✻ ${name} joined ${project.name} to work on ${repo}#${work.issue.number} (${work.effort ?? 'default'} effort${work.cloud ? ', in the cloud' : ''})` }]);
    this.schedule();
    return agent;
  }

  private freeDesk(projectId: string): number {
    const seated = this.store.agentsIn(projectId);
    const taken = new Set(seated.map((a) => a.desk));
    for (let d = 0; d < DESKS_PER_ROOM; d++) if (!taken.has(d)) return d;
    // The room is full: send home whoever finished first (failed/stopped agents before ones with open PRs).
    const rank = (a: Agent) => (a.status === 'done' ? 1 : 0);
    const leaving = seated
      .filter((a) => FINISHED.includes(a.status))
      .sort((a, b) => rank(a) - rank(b) || (a.finishedAt ?? 0) - (b.finishedAt ?? 0))[0];
    if (!leaving) throw new Error('Every station on this holodeck is taken by a working agent');
    void this.dismiss(leaving.id);
    return leaving.desk;
  }

  /**
   * Starts queued agents while there is room under the global and per-project limits. QA goes first, and doesn't count
   * against a room's limit: finished work gets reviewed before new work starts.
   */
  schedule(): void {
    const queued = [...this.store.agents.values()]
      .filter((a) => a.status === 'queued')
      .sort((a, b) => Number(b.task === 'review') - Number(a.task === 'review') || a.startedAt - b.startedAt);
    let running = this.activeCount();
    for (const agent of queued) {
      if (running >= this.store.settings.maxConcurrent) {
        this.update(agent, { activity: `Waiting for a free slot (${running} agents busy)` });
        continue;
      }
      const project = this.store.projects.find((p) => p.id === agent.projectId);
      if (!project) continue;
      if (agent.task !== 'review' && this.activeCount(project.id) >= project.maxAgents) {
        this.update(agent, { activity: `Waiting – ${project.name} allows ${project.maxAgents} at once` });
        continue;
      }
      running++;
      void this.launch(agent);
    }
  }

  private async launch(agent: Agent): Promise<void> {
    const rt = this.rt(agent.id);
    this.update(agent, { status: 'setting-up', activity: agent.task === 'review' ? 'Reading the pull request' : 'Reading the issue', error: undefined });
    try {
      if (agent.task === 'review') return await this.launchReview(agent);
      const info = await this.github.repoInfo(agent.repo);
      if (info.isEmpty) throw new Error('This repository has no commits yet – add a README first so there is a branch to work from.');
      if (agent.task === 'issue') this.update(agent, { baseBranch: info.defaultBranch });
      const prompt = await this.taskPrompt(agent);
      // an issue starts a new branch from the base; conflicts and QA's findings are fixed on the PR's own branch
      const startPoint = agent.task === 'issue' ? agent.baseBranch : agent.branch;
      this.print(agent, [{ kind: 'system', text: `✻ Setting up a worktree for ${agent.repo} on ${agent.branch}` }]);
      this.update(agent, { activity: 'Cloning the repository' });
      await this.workspace.create(agent.repo, agent.id, agent.branch, startPoint, (id) => this.store.agents.has(id));
      if (agent.cloud) {
        // a cloud session clones its branch from GitHub, so a new one has to be there first
        this.update(agent, { activity: 'Publishing the branch for the cloud session' });
        await this.workspace.publish(this.workspace.dir(agent.id), agent.branch);
      }
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      rt.notes = rt.inbox.splice(0);
      await this.runSession(agent, withNotes(prompt, rt.notes));
    } catch (err) {
      this.fail(agent, err);
    }
  }

  /** The agent's task, told for where they work now. */
  private async taskPrompt(agent: Agent): Promise<string> {
    switch (agent.task) {
      case 'review':
        throw new Error('The QA officer gets qaPrompt (qa.ts)');
      case 'issue': {
        const issue = await this.github.getIssue(agent.repo, agent.issue.number);
        this.update(agent, { issue: { number: issue.number, title: issue.title, url: issue.url } });
        return issuePrompt(agent, issue);
      }
      case 'conflicts':
        return conflictsPrompt(agent);
      case 'fix': {
        const review = this.store.reviews.get(prKey(agent.repo, agent.issue.number));
        if (!review?.report) throw new Error(`QA's report on PR #${agent.issue.number} is gone, so there's nothing to fix`);
        return fixPrompt({ number: agent.issue.number, branch: agent.branch }, { sha: review.sha, report: review.report }, agent.cloud);
      }
    }
  }

  private hooks(agent: Agent): RunHooks {
    const rt = this.rt(agent.id);
    return {
      lines: (lines) => this.print(agent, lines),
      activity: (status, activity) => {
        if (rt.permission) return; // hand stays up until the manager answers
        this.update(agent, { status: status ?? agent.status, activity: activity || agent.activity });
      },
      browser: (frame) => {
        this.store.browser.set(agent.id, frame);
        this.hub.send({ type: 'browser', id: agent.id, frame });
      },
      screenshot: (frame) => {
        if (agent.task !== 'review') return;
        rt.shots ??= { taken: 0, frames: [] };
        rt.shots.taken++;
        rt.shots.frames.push(frame);
        if (rt.shots.frames.length > MAX_SCREENSHOTS) rt.shots.frames.shift();
      },
      session: (sessionId) => this.update(agent, { sessionId }),
      cost: (usd) => this.update(agent, { costUsd: usd }),
      permission: (tool, summary, signal) =>
        new Promise<boolean>((resolve) => {
          const req: PermissionRequest = { id: newId('ask'), tool, summary: truncate(summary, 300), at: Date.now() };
          const resume = agent.status === 'waiting' ? 'working' : agent.status;
          rt.permission = { req, resolve, resume };
          this.update(agent, { status: 'waiting', permission: req, activity: `Needs approval: ${truncate(summary, 60)}` });
          this.print(agent, [{ kind: 'manager', text: `✋ Waiting for the captain to approve ${truncate(summary, 200)}` }]);
          this.hub.toast('info', `✋ ${agent.name} needs your approval`, agent.id);
          signal.addEventListener('abort', () => {
            if (rt.permission?.req.id === req.id) {
              rt.permission = undefined;
              this.update(agent, { permission: undefined });
              resolve(false);
            }
          });
        }),
    };
  }

  private async runSession(agent: Agent, prompt: string, resumeSessionId?: string): Promise<void> {
    const rt = this.rt(agent.id);
    const review = agent.task === 'review';
    // before marking them busy: the QA officer's instructions may need GitHub, and that can fail
    const instructions = review ? await this.qaSystem(agent) : systemAppend(agent);
    rt.busy = true;
    this.update(agent, { status: 'working', activity: resumeSessionId ? 'Reading your message' : 'Getting started', error: undefined, finishedAt: undefined });
    const session = this.runner.start(
      {
        agentId: agent.id,
        agentName: agent.name,
        cwd: this.workspace.dir(agent.id),
        prompt,
        systemAppend: instructions,
        resumeSessionId,
        settings: this.store.settings,
        effort: agent.effort,
        outputSchema: review ? QA_SCHEMA : undefined,
        cloud: agent.cloud ? { branch: agent.branch } : undefined,
      },
      this.hooks(agent),
    );
    rt.session = session;
    for (const message of rt.inbox.splice(0)) session.send(message);
    const outcome = await session.done;
    rt.session = undefined;
    rt.busy = false;
    if (!this.store.agents.has(agent.id)) return;

    if (outcome.aborted) {
      this.update(agent, { status: 'stopped', activity: STOPPED_BY_CAPTAIN, permission: undefined, finishedAt: Date.now() });
      if (review) this.reviewEnded(agent, STOPPED_BY_CAPTAIN);
      this.fixEnded(agent, 'stopped');
      this.schedule();
      return;
    }
    if (fallBackToLocal(agent, outcome)) {
      // a session id from the cloud means it already worked there: its pushes may be on GitHub but not in the worktree
      const ranInCloud = !!agent.sessionId;
      rt.nudged = false;
      this.update(agent, { cloud: undefined, sessionId: undefined });
      this.print(agent, [{ kind: 'system', text: "✻ Claude Code won't start a cloud session from Focus – carrying on here as a 💻 local agent" }]);
      if (!ranInCloud) return this.runSession(agent, withNotes(await this.taskPrompt(agent), rt.notes));
      this.update(agent, { activity: `Fetching ${agent.branch} from GitHub` });
      await this.workspace.pull(this.workspace.dir(agent.id), agent.branch);
      // only a new session gets refused, so this is already a carry-on prompt with the manager's message in it
      return this.runSession(agent, prompt);
    }
    if (agent.cloud && carryOnInNewSession(outcome, !!resumeSessionId)) {
      // everything the old session did is on the branch: a new one picks it up from there
      this.print(agent, [{ kind: 'system', text: `✻ Couldn't get back into the cloud session (${truncate(outcome.error ?? 'no reason given', 200)}) – starting a new one on ${agent.branch}` }]);
      return this.runSession(agent, carryOnPrompt(agent, prompt));
    }
    if (rt.inbox.length) {
      // The manager wrote while the session was wrapping up: carry on in the same conversation.
      return this.runSession(agent, rt.inbox.splice(0).join('\n\n'), agent.sessionId);
    }
    if (!outcome.ok) {
      this.fail(agent, outcome.error ?? 'The agent stopped with an error');
      return;
    }
    if (review) return this.finishReview(agent, outcome.structured, outcome.summary);
    await this.deliver(agent, outcome.summary);
  }

  /** Pushes the branch and opens (or updates) the pull request. */
  private async deliver(agent: Agent, summary: string): Promise<void> {
    const rt = this.rt(agent.id);
    rt.busy = true;
    try {
      const dir = this.workspace.dir(agent.id);
      if (agent.cloud) {
        // a cloud agent pushed its work to GitHub: bring it into the worktree, where the checks below look
        const before = await this.workspace.head(dir);
        this.update(agent, { activity: `Fetching ${agent.branch} from GitHub` });
        await this.workspace.pull(dir, agent.branch);
        if (afterCloudRun({ before, after: await this.workspace.head(dir), nudged: rt.nudged }) === 'nudge') {
          rt.nudged = true;
          this.print(agent, [{ kind: 'system', text: `✻ Nothing new on ${agent.branch} – asking the agent to push their work` }]);
          return await this.runSession(agent, pushNudge(agent), agent.sessionId);
        }
      } else if (!rt.nudged && (await this.workspace.hasUncommittedChanges(dir))) {
        rt.nudged = true;
        this.print(agent, [{ kind: 'system', text: '✻ Uncommitted changes left behind – asking the agent to commit them' }]);
        return await this.runSession(agent, COMMIT_NUDGE, agent.sessionId);
      }
      const fixing = this.fixing(agent);
      if (fixing?.sha && sameCommit(await this.workspace.head(dir), fixing.sha)) {
        this.update(agent, { status: 'done', activity: 'Finished without fixing anything – see the terminal', finishedAt: Date.now() });
        this.fixEnded(agent, 'pushed-nothing');
        return;
      }
      const ahead = await this.workspace.commitsAhead(dir, agent.baseBranch);
      if (ahead === 0) {
        this.update(agent, { status: 'done', activity: 'Finished without committing changes – see the terminal', finishedAt: Date.now() });
        this.hub.toast('info', `${agent.name} finished #${agent.issue.number} without code changes`, agent.id);
        return;
      }
      if (agent.cloud) {
        this.print(agent, [{ kind: 'system', text: `✻ ${ahead} commit${ahead === 1 ? '' : 's'} on ${agent.branch}, pushed from the cloud session` }]);
      } else {
        this.update(agent, { status: 'pushing', activity: `Pushing ${ahead} commit${ahead === 1 ? '' : 's'}` });
        this.print(agent, [{ kind: 'system', text: `✻ Pushing ${agent.branch}` }]);
        await this.workspace.push(dir, agent.branch);
      }

      let pr = agent.pr ?? (await this.github.findPullRequest(agent.repo, agent.branch));
      if (pr) {
        this.hub.toast('success', `${agent.name} updated PR #${pr.number}`, agent.id);
      } else {
        this.update(agent, { activity: 'Opening the pull request' });
        pr = await this.github.createPullRequest(agent.repo, {
          head: agent.branch,
          base: agent.baseBranch,
          title: agent.issue.title,
          body: pullRequestBody(agent, summary, this.store.settings.attribution),
        });
        this.hub.toast('success', `🎉 ${agent.name} opened PR #${pr.number}: ${agent.issue.title}`, agent.id);
      }
      this.print(agent, [{ kind: 'success', text: `✔ Pull request ready: ${pr.url}` }]);
      this.update(agent, { status: 'done', pr, activity: `PR #${pr.number} is ready for review`, finishedAt: Date.now() });
      this.boardChanged(agent.projectId);
      this.fixEnded(agent, 'pushed');
      // new code on the PR: the room's QA officer tests it
      const project = this.store.projects.find((p) => p.id === agent.projectId);
      if (project && autoQaFor(project)) {
        try {
          this.requestReview(agent.projectId, agent.repo, pr.number, agent.issue.title);
        } catch (err) {
          this.print(agent, [{ kind: 'error', text: `✘ Couldn't hand PR #${pr.number} to QA: ${errorMessage(err)}` }]);
        }
      }
    } catch (err) {
      this.fail(agent, err);
    } finally {
      rt.busy = false;
      this.schedule();
      if (rt.inbox.length && this.store.agents.has(agent.id) && agent.status === 'done' && agent.sessionId) {
        void this.runSession(agent, rt.inbox.splice(0).join('\n\n'), agent.sessionId);
      }
    }
  }

  private fail(agent: Agent, err: unknown): void {
    const message = typeof err === 'string' ? err : errorMessage(err);
    this.print(agent, [{ kind: 'error', text: `✘ ${message}` }]);
    this.update(agent, { status: 'error', error: message, activity: 'Hit a problem – send a message to retry', permission: undefined, finishedAt: Date.now() });
    this.hub.toast('error', `${agent.name}: ${truncate(message, 140)}`, agent.id);
    if (agent.task === 'review') this.reviewEnded(agent, message);
    this.fixEnded(agent, 'failed');
    this.schedule();
  }

  // ---------------------------------------------------------------- QA

  /** Asks the room's QA officer to review and test a pull request. Queued if they're busy with another. */
  requestReview(projectId: string, repo: string, number: number, title: string): QaReview {
    const project = this.store.project(projectId);
    if (!project.repos.includes(repo)) throw new Error(`${repo} is not connected to ${project.name}`);
    const existing = this.store.reviews.get(prKey(repo, number));
    if (existing && (existing.status === 'queued' || existing.status === 'testing')) return existing;
    const review: QaReview = {
      projectId,
      repo,
      number,
      title,
      status: 'queued',
      requestedAt: Date.now(),
      openedByOffice: existing?.openedByOffice || [...this.store.agents.values()].some((a) => a.task === 'issue' && a.repo === repo && a.pr?.number === number),
      failedRounds: existing?.failedRounds,
      lastRound: existing?.report ? { sha: existing.sha, report: existing.report } : existing?.lastRound,
    };
    this.putReview(review);
    this.nextReview(projectId);
    return review;
  }

  /** Seats the room's QA officer on the oldest queued review, once they're free. */
  private nextReview(projectId: string): void {
    const id = qaAgentId(projectId);
    const current = this.store.agents.get(id);
    if (current && !FINISHED.includes(current.status)) return;
    const next = [...this.store.reviews.values()]
      .filter((r) => r.projectId === projectId && r.status === 'queued')
      .sort((a, b) => a.requestedAt - b.requestedAt)[0];
    if (!next) return;
    const officer = qaOfficerFor(projectId);
    const url = `https://github.com/${next.repo}/pull/${next.number}`;
    const agent: Agent = {
      id,
      name: officer.name,
      avatar: officer.avatar,
      projectId,
      repo: next.repo,
      task: 'review',
      // GitHub numbers pull requests and issues alike; a QA officer's "issue" is the PR under test
      issue: { number: next.number, title: next.title, url },
      desk: QA_DESK,
      status: 'queued',
      activity: 'Waiting for a free slot',
      branch: `qa/pr-${next.number}`,
      baseBranch: current?.baseBranch ?? 'main',
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.runtimes.set(id, { inbox: [], notes: [], nudged: false, busy: false });
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [{ kind: 'system', text: `──────── ✻ ${officer.name} picks up ${next.repo}#${next.number} for QA: ${next.title}` }]);
    this.putReview({ ...next, agentId: id });
    this.schedule();
  }

  private async launchReview(agent: Agent): Promise<void> {
    const rt = this.rt(agent.id);
    const project = this.store.project(agent.projectId);
    const pr = await this.github.getPullRequest(agent.repo, agent.issue.number);
    const issues = (await Promise.all(pr.linkedIssues.slice(0, 3).map((n) => this.github.getIssue(agent.repo, n).catch(() => null)))).filter((i) => i !== null);
    this.update(agent, { baseBranch: pr.baseBranch, issue: { number: pr.number, title: pr.title, url: pr.url }, activity: 'Checking out the pull request' });
    this.print(agent, [{ kind: 'system', text: `✻ Checking out PR #${pr.number} (${pr.branch} into ${pr.baseBranch})` }]);
    const sha = (await this.workspace.checkoutPullRequest(agent.repo, agent.id, pr.number)) || pr.headSha;
    if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
    const review = this.store.reviews.get(prKey(agent.repo, pr.number));
    if (review) this.putReview({ ...review, status: 'testing', title: pr.title, sha, agentId: agent.id, error: undefined });
    rt.qaSystem = qaSystemAppend(agent, project, pr, sha);
    rt.shots = undefined;
    let prompt = qaPrompt(agent.repo, pr, issues, review?.lastRound);
    if (rt.inbox.length) prompt += `\n\nNotes from your manager:\n${rt.inbox.splice(0).map((m) => `- ${m}`).join('\n')}`;
    await this.runSession(agent, prompt);
  }

  /** The QA officer's instructions; rebuilt from GitHub if the office restarted since the review began. */
  private async qaSystem(agent: Agent): Promise<string> {
    const rt = this.rt(agent.id);
    if (!rt.qaSystem) {
      const pr = await this.github.getPullRequest(agent.repo, agent.issue.number);
      const sha = this.store.reviews.get(prKey(agent.repo, agent.issue.number))?.sha ?? pr.headSha;
      rt.qaSystem = qaSystemAppend(agent, this.store.project(agent.projectId), pr, sha);
    }
    return rt.qaSystem;
  }

  /** Records the QA officer's verdict, posts it on the pull request, and moves on to the next review. */
  private async finishReview(agent: Agent, structured: unknown, text: string): Promise<void> {
    const number = agent.issue.number;
    const report = parseQaReport(structured, text);
    if (!report) {
      this.fail(agent, 'Finished without a QA report. Send them a message to ask for one, or send the PR to QA again.');
      return;
    }
    const pass = report.verdict === 'pass';
    const review = this.store.reviews.get(prKey(agent.repo, number));
    const screenshots = await this.keepScreenshots(agent, report, review?.sha);
    let commentUrl: string | undefined;
    try {
      this.update(agent, { activity: 'Posting the QA report on the PR' });
      const body = qaComment(report, { officer: agent.name, sha: review?.sha }, screenshots, this.store.settings.attribution);
      commentUrl = (await this.github.commentOnPullRequest(agent.repo, number, body)) || undefined;
      this.print(agent, [{ kind: 'system', text: `✻ Posted the QA report: ${commentUrl ?? 'done'}` }]);
    } catch (err) {
      this.print(agent, [{ kind: 'error', text: `✘ Couldn't post the QA report on the PR: ${errorMessage(err)}` }]);
    }
    const failedRounds = (review?.failedRounds ?? 0) + (pass ? 0 : 1);
    const done: QaReview | undefined = review && { ...review, status: pass ? 'passed' : 'failed', report, screenshots, commentUrl, failedRounds, finishedAt: Date.now(), error: undefined };
    if (done) this.putReview(done);
    this.print(agent, [{ kind: pass ? 'success' : 'error', text: `${pass ? '✅ QA passed' : '❌ QA failed'} PR #${number} · ${report.checks.length} checks` }]);
    this.update(agent, { status: 'done', activity: `${pass ? '✅ Passed' : '❌ Failed'} PR #${number}`, finishedAt: Date.now() });
    this.hub.toast(pass ? 'success' : 'error', `${pass ? '✅' : '❌'} ${agent.name} ${pass ? 'passed' : 'failed'} ${agent.repo.split('/')[1]}#${number}: ${truncate(report.summary, 120)}`, agent.id);
    this.boardChanged(agent.projectId);
    if (done) await this.qaNext(done, { kind: 'verdict', verdict: report.verdict, failedRounds });
    this.nextReview(agent.projectId);
  }

  /**
   * Keeps the QA officer's screenshots for the station and uploads them to the repo's QA evidence branch. One that
   * fails to upload stays out of the PR comment, and the error goes to their terminal.
   */
  private async keepScreenshots(agent: Agent, report: QaReport, sha: string | undefined): Promise<QaScreenshot[]> {
    const rt = this.rt(agent.id);
    const { taken, frames } = rt.shots ?? { taken: 0, frames: [] };
    rt.shots = undefined;
    const images = frames.map((f) => (f.image ? decodeImage(f.image) : null));
    const captions = keptCaptions(report.captions, taken, frames.length);
    const at = Date.now();
    const screenshots: QaScreenshot[] = [];
    if (frames.length) this.update(agent, { activity: `Uploading ${frames.length} screenshot${frames.length === 1 ? '' : 's'}` });
    for (const [i, image] of images.entries()) {
      if (!image) continue;
      const file = `${slugify(agent.repo)}-${agent.issue.number}-${at}-${i + 1}.${image.ext}`;
      this.store.saveShot(file, image.bytes);
      const shot: QaScreenshot = { caption: captions[i], file };
      try {
        shot.url = await this.github.uploadQaEvidence(agent.repo, evidencePath(agent.issue.number, sha, at, i, image.ext), image.bytes);
      } catch (err) {
        this.print(agent, [{ kind: 'error', text: `✘ Couldn't upload screenshot ${i + 1} ("${truncate(shot.caption, 60)}"): ${errorMessage(err)}` }]);
      }
      screenshots.push(shot);
    }
    const uploaded = screenshots.filter((s) => s.url).length;
    if (uploaded) this.print(agent, [{ kind: 'system', text: `✻ Uploaded ${uploaded} screenshot${uploaded === 1 ? '' : 's'} to the QA evidence branch` }]);
    return screenshots;
  }

  // ---------------------------------------------------------------- sending failed PRs back

  /** Acts on what qaNextStep decides for a PR after a verdict or a fix. */
  private async qaNext(review: QaReview, event: QaLoopEvent): Promise<void> {
    const project = this.store.projects.find((p) => p.id === review.projectId);
    if (!project) return;
    const step = qaNextStep({ openedByOffice: !!review.openedByOffice, autoSendBack: autoSendBackFor(project) }, event);
    switch (step.kind) {
      case 'nothing':
        if (review.followUp) this.putReview({ ...review, followUp: undefined });
        return;
      case 'send-back':
        return this.sendBack(review);
      case 'needs-you':
        return this.needsYou(review, step.reason);
    }
  }

  /**
   * Hands QA's findings to the developer who opened the PR, if they're still in the office; otherwise a new agent sits
   * down on the PR's branch to fix it.
   */
  private async sendBack(review: QaReview): Promise<void> {
    const { report } = review;
    if (!report) return;
    const where = `${review.repo.split('/')[1]}#${review.number}`;
    try {
      const owner = this.prOwner(review.repo, review.number);
      if (owner) {
        this.putReview({ ...review, followUp: { kind: 'fixing', agentId: owner.id, agentName: owner.name } });
        this.message(owner.id, fixPrompt({ number: review.number, branch: owner.branch }, { sha: review.sha, report }, owner.cloud));
        this.hub.toast('info', `🔧 ${where} failed QA – back to ${owner.name}`, owner.id);
        return;
      }
      const pr = await this.github.getPullRequest(review.repo, review.number);
      const agent = this.seat(review.projectId, review.repo, {
        id: newId('agent'),
        task: 'fix',
        issue: { number: pr.number, title: pr.title, url: pr.url },
        branch: pr.branch,
        baseBranch: pr.baseBranch,
        pr: { number: pr.number, url: pr.url },
      });
      this.putReview({ ...review, followUp: { kind: 'fixing', agentId: agent.id, agentName: agent.name } });
      this.hub.toast('info', `🔧 ${where} failed QA – ${agent.name} sits down to fix it`, agent.id);
    } catch (err) {
      this.needsYou(review, `it couldn't be sent back (${errorMessage(err)})`);
    }
  }

  /** The office stops sending the PR back: it's the manager's call now. */
  private needsYou(review: QaReview, reason: string): void {
    this.putReview({ ...review, followUp: { kind: 'needs-you', reason } });
    this.hub.toast('error', `🙋 ${review.repo.split('/')[1]}#${review.number} needs you: ${reason}`);
  }

  /** The failed review this agent was sent to fix, while it's still theirs. */
  private fixing(agent: Agent): QaReview | undefined {
    if (!agent.pr) return undefined;
    const review = this.store.reviews.get(prKey(agent.repo, agent.pr.number));
    return review?.followUp?.kind === 'fixing' && review.followUp.agentId === agent.id ? review : undefined;
  }

  private fixEnded(agent: Agent, outcome: Extract<QaLoopEvent, { kind: 'fix-ended' }>['outcome']): void {
    const review = this.fixing(agent);
    if (review) void this.qaNext(review, { kind: 'fix-ended', by: agent.name, outcome });
  }

  /** A review that ended without a verdict (stopped, failed, or its PR went away). */
  private reviewEnded(agent: Agent, error: string): void {
    const review = this.store.reviews.get(prKey(agent.repo, agent.issue.number));
    if (review && (review.status === 'testing' || review.status === 'queued')) this.putReview({ ...review, status: 'error', error, finishedAt: Date.now() });
    // don't start the next review under the captain's nose when they stopped this one on purpose
    if (error !== STOPPED_BY_CAPTAIN) setTimeout(() => this.nextReview(agent.projectId), 0);
  }

  /** The PR is merged or closed: forget its review, and stop the QA officer if they're on it. */
  reviewGone(repo: string, number: number): void {
    const review = this.store.reviews.get(prKey(repo, number));
    if (!review) return;
    this.store.removeReview(repo, number);
    this.hub.send({ type: 'review-removed', repo, number });
    const qa = this.store.agents.get(qaAgentId(review.projectId));
    if (qa && qa.repo === repo && qa.issue.number === number && !FINISHED.includes(qa.status)) this.stop(qa.id);
    this.nextReview(review.projectId);
  }

  private putReview(review: QaReview): void {
    this.store.putReview(review);
    this.hub.send({ type: 'review', review });
  }

  // ---------------------------------------------------------------- manager actions

  message(id: string, text: string): void {
    const agent = this.store.agent(id);
    const rt = this.rt(id);
    text = text.trim();
    if (!text) return;
    this.print(agent, [{ kind: 'manager', text: `▶ Captain: ${text}` }]);

    if (rt.session?.send(text)) {
      if (!rt.permission) this.update(agent, { activity: 'Reading your message' });
      return;
    }
    if (agent.status === 'queued' || rt.busy || agent.status === 'setting-up') {
      rt.inbox.push(text);
      return;
    }
    // Finished, stopped or failed: pick the conversation back up.
    rt.nudged = false;
    if (agent.sessionId) {
      void this.runSession(agent, text, agent.sessionId).catch((err) => this.fail(agent, err));
    } else {
      rt.inbox.push(text);
      this.update(agent, { status: 'queued', activity: 'Waiting for a free slot', error: undefined });
      this.schedule();
    }
  }

  resolvePermission(id: string, requestId: string, allow: boolean): void {
    const agent = this.store.agent(id);
    const rt = this.rt(id);
    const pending = rt.permission;
    if (!pending || pending.req.id !== requestId) throw new Error('That request is no longer pending');
    rt.permission = undefined;
    this.print(agent, [{ kind: 'manager', text: `${allow ? '✔ Approved' : '✘ Declined'} by the captain: ${pending.req.summary}` }]);
    this.update(agent, {
      status: pending.resume,
      permission: undefined,
      activity: allow ? `Approved: ${truncate(pending.req.summary, 60)}` : 'Finding another way',
    });
    pending.resolve(allow);
  }

  stop(id: string): void {
    const agent = this.store.agent(id);
    const rt = this.rt(id);
    if (rt.session) {
      rt.session.stop();
    } else if (!FINISHED.includes(agent.status)) {
      this.update(agent, { status: 'stopped', activity: STOPPED_BY_CAPTAIN, finishedAt: Date.now() });
      this.schedule();
    }
  }

  async dismiss(id: string): Promise<void> {
    const agent = this.store.agents.get(id);
    if (!agent) return;
    this.runtimes.get(id)?.session?.stop();
    this.runtimes.delete(id);
    this.store.removeAgent(id);
    this.hub.send({ type: 'agent-removed', id });
    this.schedule();
    await this.workspace.remove(agent.repo, id).catch(() => undefined);
  }

  /** Called when a PR an agent opened was merged or closed. The agent packs up and goes home. */
  prClosed(repo: string, number: number, merged: boolean): void {
    this.reviewGone(repo, number);
    const agent = this.prOwner(repo, number);
    if (!agent || this.leaving.has(agent.id)) return;
    this.leaving.add(agent.id);
    this.print(agent, [{ kind: 'success', text: merged ? `🎉 PR #${number} was merged!` : `PR #${number} was closed` }]);
    this.update(agent, { activity: merged ? '🎉 Merged! Packing up' : 'PR closed – packing up' });
    if (merged) this.hub.toast('success', `🎉 Merged ${repo}#${number} – ${agent.name} heads home`, agent.id);
    setTimeout(() => {
      this.leaving.delete(agent.id);
      void this.dismiss(agent.id);
    }, 6000);
  }

  /** Issues already claimed by an agent who is still in the office. */
  claimed(repo: string): Set<number> {
    return new Set([...this.store.agents.values()].filter((a) => a.repo === repo).map((a) => a.issue.number));
  }

  freeSlots(projectId: string): number {
    const project = this.store.project(projectId);
    const busy = this.store.agentsIn(projectId).filter((a) => a.task !== 'review' && (a.status === 'queued' || ACTIVE_STATUSES.includes(a.status))).length;
    return Math.max(0, project.maxAgents - busy);
  }
}

function withNotes(prompt: string, notes: string[]): string {
  return notes.length ? `${prompt}\n\nNotes from your manager:\n${notes.map((m) => `- ${m}`).join('\n')}` : prompt;
}
