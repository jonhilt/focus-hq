import type { Agent, AgentStatus, PermissionRequest, TermLine } from '../../shared/types';
import { ACTIVE_STATUSES, DESKS_PER_ROOM } from '../../shared/types';
import type { GitHubProvider } from '../github/provider';
import type { Hub } from '../hub';
import type { Store } from '../store';
import { errorMessage, newId, slugify, truncate } from '../util';
import { COMMIT_NUDGE, issuePrompt, pickName, pullRequestBody, randomAvatar, systemAppend } from './prompts';
import type { AgentRunner, AgentSession, RunHooks, WorkspaceOps } from './types';

interface Runtime {
  session?: AgentSession;
  /** Messages from the manager that arrived while no session could take them. */
  inbox: string[];
  permission?: { req: PermissionRequest; resolve: (ok: boolean) => void; resume: AgentStatus };
  nudged: boolean;
  busy: boolean;
}

const FINISHED: AgentStatus[] = ['done', 'stopped', 'error'];

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
      rt = { inbox: [], nudged: false, busy: false };
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

  private activeCount(projectId?: string): number {
    return [...this.store.agents.values()].filter(
      (a) => ACTIVE_STATUSES.includes(a.status) && (!projectId || a.projectId === projectId),
    ).length;
  }

  // ---------------------------------------------------------------- hiring

  hire(projectId: string, repo: string, issue: { number: number; title?: string; url?: string }): Agent {
    const project = this.store.project(projectId);
    if (!project.repos.includes(repo)) throw new Error(`${repo} is not connected to ${project.name}`);
    const existing = [...this.store.agents.values()].find(
      (a) => a.repo === repo && a.issue.number === issue.number && !FINISHED.includes(a.status),
    );
    if (existing) throw new Error(`${existing.name} is already working on #${issue.number}`);

    const desk = this.freeDesk(projectId);
    const name = pickName(new Set([...this.store.agents.values()].map((a) => a.name)));
    const id = newId('agent');
    const agent: Agent = {
      id,
      name,
      avatar: randomAvatar(),
      projectId,
      repo,
      issue: {
        number: issue.number,
        title: issue.title ?? `Issue #${issue.number}`,
        url: issue.url ?? `https://github.com/${repo}/issues/${issue.number}`,
      },
      desk,
      status: 'queued',
      activity: 'Waiting for a free slot',
      branch: `focus/${issue.number}-${slugify(issue.title ?? 'issue', 30) || 'issue'}-${id.slice(-4)}`,
      baseBranch: 'main',
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [{ kind: 'system', text: `✻ ${name} joined ${project.name} to work on ${repo}#${issue.number}` }]);
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
    if (!leaving) throw new Error('Every desk in this room is taken by a working agent');
    void this.dismiss(leaving.id);
    return leaving.desk;
  }

  /** Starts queued agents while there is room under the global and per-project limits. */
  schedule(): void {
    const queued = [...this.store.agents.values()].filter((a) => a.status === 'queued').sort((a, b) => a.startedAt - b.startedAt);
    let running = this.activeCount();
    for (const agent of queued) {
      if (running >= this.store.settings.maxConcurrent) {
        this.update(agent, { activity: `Waiting for a free slot (${running} agents busy)` });
        continue;
      }
      const project = this.store.projects.find((p) => p.id === agent.projectId);
      if (!project) continue;
      if (this.activeCount(project.id) >= project.maxAgents) {
        this.update(agent, { activity: `Waiting – ${project.name} allows ${project.maxAgents} at once` });
        continue;
      }
      running++;
      void this.launch(agent);
    }
  }

  private async launch(agent: Agent): Promise<void> {
    const rt = this.rt(agent.id);
    this.update(agent, { status: 'setting-up', activity: 'Reading the issue', error: undefined });
    try {
      const info = await this.github.repoInfo(agent.repo);
      if (info.isEmpty) throw new Error('This repository has no commits yet – add a README first so there is a branch to work from.');
      const issue = await this.github.getIssue(agent.repo, agent.issue.number);
      this.update(agent, { baseBranch: info.defaultBranch, issue: { number: issue.number, title: issue.title, url: issue.url } });
      this.print(agent, [{ kind: 'system', text: `✻ Setting up a worktree for ${agent.repo} on ${agent.branch}` }]);
      this.update(agent, { activity: 'Cloning the repository' });
      await this.workspace.create(agent.repo, agent.id, agent.branch, info.defaultBranch);
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      let prompt = issuePrompt(agent, issue);
      if (rt.inbox.length) prompt += `\n\nNotes from your manager:\n${rt.inbox.splice(0).map((m) => `- ${m}`).join('\n')}`;
      await this.runSession(agent, prompt);
    } catch (err) {
      this.fail(agent, err);
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
      session: (sessionId) => this.update(agent, { sessionId }),
      cost: (usd) => this.update(agent, { costUsd: usd }),
      permission: (tool, summary, signal) =>
        new Promise<boolean>((resolve) => {
          const req: PermissionRequest = { id: newId('ask'), tool, summary: truncate(summary, 300), at: Date.now() };
          const resume = agent.status === 'waiting' ? 'working' : agent.status;
          rt.permission = { req, resolve, resume };
          this.update(agent, { status: 'waiting', permission: req, activity: `Needs approval: ${truncate(summary, 60)}` });
          this.print(agent, [{ kind: 'manager', text: `✋ Waiting for the manager to approve ${truncate(summary, 200)}` }]);
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
    rt.busy = true;
    this.update(agent, { status: 'working', activity: resumeSessionId ? 'Reading your message' : 'Getting started', error: undefined, finishedAt: undefined });
    const session = this.runner.start(
      {
        agentId: agent.id,
        agentName: agent.name,
        cwd: this.workspace.dir(agent.id),
        prompt,
        systemAppend: systemAppend(agent),
        resumeSessionId,
        settings: this.store.settings,
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
      this.update(agent, { status: 'stopped', activity: 'Stopped by the manager', permission: undefined, finishedAt: Date.now() });
      this.schedule();
      return;
    }
    if (rt.inbox.length) {
      // The manager wrote while the session was wrapping up: carry on in the same conversation.
      return this.runSession(agent, rt.inbox.splice(0).join('\n\n'), agent.sessionId);
    }
    if (!outcome.ok) {
      this.fail(agent, outcome.error ?? 'The agent stopped with an error');
      return;
    }
    await this.deliver(agent, outcome.summary);
  }

  /** Pushes the branch and opens (or updates) the pull request. */
  private async deliver(agent: Agent, summary: string): Promise<void> {
    const rt = this.rt(agent.id);
    rt.busy = true;
    try {
      const dir = this.workspace.dir(agent.id);
      if (!rt.nudged && (await this.workspace.hasUncommittedChanges(dir))) {
        rt.nudged = true;
        this.print(agent, [{ kind: 'system', text: '✻ Uncommitted changes left behind – asking the agent to commit them' }]);
        return await this.runSession(agent, COMMIT_NUDGE, agent.sessionId);
      }
      const ahead = await this.workspace.commitsAhead(dir, agent.baseBranch);
      if (ahead === 0) {
        this.update(agent, { status: 'done', activity: 'Finished without committing changes – see the terminal', finishedAt: Date.now() });
        this.hub.toast('info', `${agent.name} finished #${agent.issue.number} without code changes`, agent.id);
        return;
      }
      this.update(agent, { status: 'pushing', activity: `Pushing ${ahead} commit${ahead === 1 ? '' : 's'}` });
      this.print(agent, [{ kind: 'system', text: `✻ Pushing ${agent.branch}` }]);
      await this.workspace.push(dir, agent.branch);

      let pr = agent.pr ?? (await this.github.findPullRequest(agent.repo, agent.branch));
      if (pr) {
        this.hub.toast('success', `${agent.name} updated PR #${pr.number}`, agent.id);
      } else {
        this.update(agent, { activity: 'Opening the pull request' });
        pr = await this.github.createPullRequest(agent.repo, {
          head: agent.branch,
          base: agent.baseBranch,
          title: agent.issue.title,
          body: pullRequestBody(agent, summary),
        });
        this.hub.toast('success', `🎉 ${agent.name} opened PR #${pr.number}: ${agent.issue.title}`, agent.id);
      }
      this.print(agent, [{ kind: 'success', text: `✔ Pull request ready: ${pr.url}` }]);
      this.update(agent, { status: 'done', pr, activity: `PR #${pr.number} is ready for review`, finishedAt: Date.now() });
      this.boardChanged(agent.projectId);
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
    this.schedule();
  }

  // ---------------------------------------------------------------- manager actions

  message(id: string, text: string): void {
    const agent = this.store.agent(id);
    const rt = this.rt(id);
    text = text.trim();
    if (!text) return;
    this.print(agent, [{ kind: 'manager', text: `▶ Manager: ${text}` }]);

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
    this.print(agent, [{ kind: 'manager', text: `${allow ? '✔ Approved' : '✘ Declined'} by the manager: ${pending.req.summary}` }]);
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
      this.update(agent, { status: 'stopped', activity: 'Stopped by the manager', finishedAt: Date.now() });
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
    const agent = [...this.store.agents.values()].find((a) => a.repo === repo && a.pr?.number === number);
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
    const busy = this.store.agentsIn(projectId).filter((a) => a.status === 'queued' || ACTIVE_STATUSES.includes(a.status)).length;
    return Math.max(0, project.maxAgents - busy);
  }
}
