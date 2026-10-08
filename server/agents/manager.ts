import { Effect, Fiber, FiberMap, type Layer, Option } from 'effect';
import { helperFor, leadFor, leadId, randomAvatar } from '../../shared/crew';
import { type Closer, type LedgerEntry, type ReportCard } from '../../shared/ledger';
import type { Transcript } from './engineer';
import { goneReply } from '../../shared/mergeGate';
import { autoQaFor, prKey, sameCommit } from '../../shared/qa';
import type { Agent, ConflictsOutcome, Effort, FailedCheck, PermissionRequest, PullRequest, QaReport, QaReview, QueuedGoal, TermLine } from '../../shared/types';
import { ACTIVE_STATUSES, LEAD_DESK, TEAM_STATIONS } from '../../shared/types';
import { answerMessage } from '../../shared/artifacts';
import { GitHub, type GitHubError } from '../github/service';
import type { Hub } from '../hub';
import type { Store } from '../store';
import { errorMessage, newId, slugify, truncate } from '../util';
import { afterCloudRun, attachAgain, carryOnInNewSession, fallBackToLocal } from './cloud';
import { conflictsAgentModel } from './conflicts';
import { afterLanding, afterVerdict, answerQuestion, type ArtifactInput, askQuestion, type QuestionInput, showArtifact, carriedNote, applyHelperEvent, applyNote, COMPACT_INSTRUCTIONS, compactInstructions, behindNote, closeCheck, conflictsResolvedNote, fileGoal, leftLog, freshSessionPrompt, goalBrief, goalEffort, goalRecord, goalReviewerId, goalTitle, everyPr, HELPER_LINGER_MS, heldBack, landedMidTurnNote, landedNote, leadPrBody, leadSystemAppend, leadWorktreeId, moveQueued, newSliceNote, nextGoal, type NoteInput, notShipped, openPr, pageErrorsNote, pickStation, qaVerdictNote, reopenable, reopenedNote, reopenedWork, sessionGone, shipped, shippedSha, shipPlan, sliceBranch, sliceLanded, snapshotMessage, type FreshBranch, freshBranchNote, needsFreshBranch, repoBranch } from './lead';
import { explainerPage, type ExplainerInput } from './explainer';
import { repoFolders } from './planner';
import { carryOnPrompt, COMMIT_NUDGE, conflictsPrompt, issuePrompt, pickName, pullRequestBody, pushNudge, systemAppend } from './prompts';
import { MAX_SCREENSHOTS, QA_SCHEMA } from './qa';
import { offTheFloor, pickDesk } from './desks';
import { deskless, whoStarts } from './schedule';
import { type GitFailed, Renderer, Sessions, Workspace } from './services';
import { applyTaskTool } from './tasks';
import { type BaseMerge, type RunHooks, type RunOutcome, type RunRequest, STOPPED_BY_CAPTAIN } from './types';
import { CloudMoves } from './manager/cloudMoves';
import { Core, EmptyRepository, FINISHED, type ManagerServices, NothingToCheckOut, Part, Refused, ReportGone, withNotes, type WorkError } from './manager/core';
import { Ledger } from './manager/ledger';
import { Reviews } from './manager/reviews';
import { Triages } from './manager/triages';

/**
 * Hires agents, seats them at desks, runs them, and turns their work into pull requests.
 *
 * Plain methods outside, Effect inside: each agent's work runs as its one fiber (`runs`), so they never run twice at
 * once and sending them home interrupts it (and with it their Claude Code session); timers are `Effect.sleep`s. What
 * they share is in the `Core` (`manager/core.ts`); QA reviews, triage, moves to the cloud and the ledger are parts of
 * their own in `manager/`, which the public methods below hand over to.
 */
export class AgentManager extends Part {
  /** The pull requests (prKey) the office is merging its base branch into right now. */
  private merging = new Set<string>();
  private leaving = new Set<string>();
  /** The leads whose goal is closing right now: nothing of theirs ships, so a WIP snapshot never reaches a pull request. */
  private closingGoals = new Set<string>();

  constructor(store: Store, hub: Hub, services: Layer.Layer<ManagerServices>, boardChanged: (projectId: string) => void) {
    super(new Core(store, hub, services, boardChanged));
    this.core.manager = this;
    this.core.reviews = new Reviews(this.core);
    this.core.triages = new Triages(this.core);
    this.core.cloud = new CloudMoves(this.core);
    this.core.ledger = new Ledger(this.core);
  }

  /** Reads an agent session's Claude Code transcript by its id (missing in the demo, which has none). */
  get readTranscript(): Ledger['readTranscript'] {
    return this.core.ledger.readTranscript;
  }

  set readTranscript(read: Ledger['readTranscript']) {
    this.core.ledger.readTranscript = read;
  }

  /** Reads each digested span for its frictions (Haiku); without one, digests carry the facts alone. */
  get extractor(): Ledger['extractor'] {
    return this.core.ledger.extractor;
  }

  set extractor(extractor: Ledger['extractor']) {
    this.core.ledger.extractor = extractor;
  }

  /** The agents' transcripts on this machine, for digesting the ones from before digests began. */
  get transcripts(): Ledger['transcripts'] {
    return this.core.ledger.transcripts;
  }

  set transcripts(transcripts: Ledger['transcripts']) {
    this.core.ledger.transcripts = transcripts;
  }

  private printHelper(agent: Agent, id: string, lines: Omit<TermLine, 't'>[]): void {
    this.core.printHelper(agent, id, lines);
  }

  // ---------------------------------------------------------------- handed to the manager's parts

  requestReview(projectId: string, repo: string, number: number, title: string, retryNote?: string, asked = false): QaReview {
    return this.core.reviews.requestReview(projectId, repo, number, title, retryNote, asked);
  }

  requestMerge(repo: string, number: number, on: boolean): QaReview {
    return this.core.reviews.requestMerge(repo, number, on);
  }

  sendBackChecks(repo: string, number: number, checks: FailedCheck[]): Promise<void> {
    return this.core.reviews.sendBackChecks(repo, number, checks);
  }

  reviewGone(repo: string, number: number, merged: boolean): void {
    this.core.reviews.reviewGone(repo, number, merged);
  }

  moveToCloud(id: string): Promise<Agent> {
    return this.core.cloud.moveToCloud(id);
  }

  openCloudTerminal(id: string): Promise<Agent> {
    return this.core.cloud.openCloudTerminal(id);
  }

  attachCloud(id: string, link: string): Promise<Agent> {
    return this.core.cloud.attachCloud(id, link);
  }

  stayLocal(id: string, start = true): Promise<Agent> {
    return this.core.cloud.stayLocal(id, start);
  }

  recordLanding(repo: string, number: number, merged: boolean, by: Closer = 'github', headSha?: string): void {
    this.core.ledger.recordLanding(repo, number, merged, by, headSha);
  }

  undigested(): Promise<Transcript[]> {
    return this.core.ledger.undigested();
  }

  backfill(): Promise<{ sessions: number }> {
    return this.core.ledger.backfill();
  }

  record(projectId: string, entry: LedgerEntry, at = Date.now()): void {
    this.core.ledger.record(projectId, entry, at);
  }

  report(): ReportCard {
    return this.core.ledger.report();
  }

  // ---------------------------------------------------------------- hiring

  /** `cloud` puts them in a Claude Code cloud session instead of on this machine. */
  hire(projectId: string, repo: string, issue: { number: number; title?: string; url?: string }, how: { effort?: Effort; cloud?: boolean } = {}): Agent {
    const id = newId('agent');
    const title = issue.title ?? `Issue #${issue.number}`;
    const closed = this.store.closedPrs.get(prKey(repo, issue.number));
    if (closed) {
      // the last attempt was closed as the wrong approach: the new developer hears why
      this.rt(id).inbox.push(`${closed.officer} closed an earlier attempt at this issue (PR #${closed.pr}) because the approach was wrong: ${closed.note}`);
      this.store.removeClosedPr(repo, issue.number);
      this.boardChanged(projectId);
    }
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
   * Gets a pull request's merge conflicts resolved without interrupting anyone. The office first merges the base branch
   * in itself, and pushes it when git needs no help. Otherwise the developer who opened the PR takes it, if they're still
   * in the office; for anyone else's, a goal's slice included, a new agent sits down on the PR's branch in a worktree of
   * their own. A goal's lead hears about it once their turn is over.
   */
  async resolveConflicts(projectId: string, pr: PullRequest): Promise<ConflictsOutcome> {
    const resolving = [...this.store.agents.values()].find((a) => a.task === 'conflicts' && a.repo === pr.repo && a.pr?.number === pr.number && !FINISHED.includes(a.status));
    if (resolving) throw new Refused({ message: `${resolving.name} is already resolving the conflicts on #${pr.number}` });
    const lead = this.leadWith(pr.repo, pr.number);
    const owner = lead ? undefined : this.prOwner(pr.repo, pr.number);
    const merge = await this.mergeBase(pr);
    if (merge.kind === 'up-to-date') return merge;
    this.core.ledger.record(projectId, { kind: 'conflicts', repo: pr.repo, pr: pr.number, goal: lead?.lead?.title, resolved: merge.kind === 'merged' ? 'office' : 'agent' });
    if (merge.kind === 'merged') {
      if (lead) this.mergedForLead(lead, pr, merge.sha, 'the office');
      else if (owner) await this.runtime.runPromise(this.catchUp(owner, merge));
      return { kind: 'merged' };
    }
    if (owner) {
      this.update(owner, { baseBranch: pr.baseBranch });
      this.message(owner.id, conflictsPrompt(owner));
      return { kind: 'agent', agent: owner };
    }
    const agent = this.seat(projectId, pr.repo, {
      id: newId('agent'),
      task: 'conflicts',
      issue: { number: pr.number, title: pr.title, url: pr.url },
      branch: pr.branch,
      baseBranch: pr.baseBranch,
      pr: { number: pr.number, url: pr.url },
      ...conflictsAgentModel(this.store.settings),
    });
    return { kind: 'agent', agent };
  }

  /** The office's own merge of the PR's base branch into it. One that fails for any reason other than conflicts goes to an agent too. */
  private async mergeBase(pr: PullRequest): Promise<BaseMerge> {
    const key = prKey(pr.repo, pr.number);
    if (this.merging.has(key)) throw new Refused({ message: `The office is already merging ${pr.baseBranch} into #${pr.number}` });
    this.merging.add(key);
    const merge = Workspace.use((w) => w.mergeBase(pr.repo, pr.branch, pr.baseBranch)).pipe(
      Effect.catch((err) => Effect.sync((): BaseMerge => {
        console.warn(`Couldn't merge ${pr.baseBranch} into ${pr.repo}#${pr.number} on the office's side: ${err.message}`);
        return { kind: 'conflicts' };
      })),
    );
    return this.runtime.runPromise(merge).finally(() => this.merging.delete(key));
  }

  /**
   * The office merged the base into a finished developer's PR: their worktree, which still has the PR's old head and
   * nothing else, moves up to the merge, so their next push doesn't undo it.
   */
  private catchUp(owner: Agent, merge: { from: string }): Effect.Effect<void, never, Workspace> {
    return Effect.gen({ self: this }, function* () {
      if (owner.cloud || !FINISHED.includes(owner.status)) return;
      const workspace = yield* Workspace;
      const dir = workspace.dir(owner.id);
      if ((yield* workspace.hasUncommittedChanges(dir)) || (yield* workspace.head(dir)) !== merge.from) return;
      yield* workspace.pull(dir, owner.branch);
    }).pipe(Effect.ignore);
  }

  /**
   * The office pushed a merge to one of a lead's pull requests: the slice records the PR's new head, and the lead hears
   * to pull it before touching that repo again, once their turn is over.
   */
  private mergedForLead(lead: Agent, pr: Pick<PullRequest, 'repo' | 'number' | 'baseBranch' | 'branch'>, sha: string, who: string): void {
    const work = lead.lead;
    if (!work) return;
    const folder = work.repos.find((r) => r.repo === pr.repo)?.folder ?? pr.repo.split('/')[1];
    const prs = work.prs.map((p) => (p.repo === pr.repo && p.number === pr.number ? { ...p, sha } : p));
    this.update(lead, { lead: { ...work, prs } });
    this.noteForLead(lead, 'Office', conflictsResolvedNote(pr, folder, who));
  }

  /** The agent in the office whose PR this is: the one who opened it, or one seated on it since. */
  prOwner(repo: string, number: number): Agent | undefined {
    return [...this.store.agents.values()].find((a) => a.task !== 'review' && a.repo === repo && a.pr?.number === number);
  }

  /** An agent of the office opened the PR (QA's review remembers it after they've gone home). */
  openedByOffice(repo: string, number: number): boolean {
    return !!this.store.reviews.get(prKey(repo, number))?.openedByOffice
      || [...this.store.agents.values()].some((a) => a.task === 'issue' && a.repo === repo && a.pr?.number === number);
  }

  /** Someone in the office is working on the PR right now, or queued to. */
  busyOn(repo: string, number: number): boolean {
    const owner = this.prOwner(repo, number);
    return !!owner && !FINISHED.includes(owner.status);
  }

  seat(projectId: string, repo: string, work: Pick<Agent, 'id' | 'task' | 'issue' | 'branch' | 'baseBranch' | 'pr' | 'effort' | 'model' | 'cloud'>): Agent {
    const project = this.store.project(projectId);
    if (!project.repos.includes(repo)) throw new Refused({ message: `${repo} is not connected to ${project.name}` });
    // QA reviewing the PR, or a goal's lead, isn't working on it the way a developer would
    const existing = [...this.store.agents.values()].find(
      (a) => a.task !== 'review' && a.task !== 'lead' && a.repo === repo && a.issue.number === work.issue.number && !FINISHED.includes(a.status),
    );
    if (existing) throw new Refused({ message: `${existing.name} is already working on #${work.issue.number}` });

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
    this.print(agent, [{ kind: 'system', text: `✻ ${name} joined ${project.name} to work on ${repo}#${work.issue.number} (${work.model ? `${work.model}, ` : ''}${work.effort ?? 'default'} effort${work.cloud ? ', in the cloud' : ''})` }]);
    this.schedule();
    return agent;
  }

  /** A desk in the room, sending home whoever finished first when they're all taken (`pickDesk`). */
  private freeDesk(projectId: string): number {
    const pick = pickDesk(this.store.agentsIn(projectId));
    if (!pick) throw new Refused({ message: 'Every desk on this holodeck is taken by a working agent' });
    if (pick.evict) this.background(this.goHome(pick.evict.id));
    return pick.desk;
  }

  /**
   * Starts queued agents while there is room under the global and per-project limits (`whoStarts`). QA goes first, and
   * doesn't count against a room's limit: finished work gets reviewed before new work starts.
   */
  schedule(): void {
    const { start, wait } = whoStarts([...this.store.agents.values()], this.store.projects, this.store.settings.maxConcurrent);
    for (const { agent, why } of wait) this.update(agent, { activity: why });
    for (const agent of start) {
      // still finishing their last piece of work: they start once it's over (runFor looks again then)
      if (FiberMap.hasUnsafe(this.runs, agent.id)) continue;
      // saved at a desk the room no longer has: they take one now, or wait for one
      if (offTheFloor(agent)) {
        const pick = pickDesk(this.store.agentsIn(agent.projectId));
        if (!pick) {
          this.update(agent, { activity: 'Waiting for a free desk' });
          continue;
        }
        if (pick.evict) this.background(this.goHome(pick.evict.id));
        this.update(agent, { desk: pick.desk });
      }
      this.runFor(agent.id, this.launch(agent));
    }
  }

  private launch(agent: Agent): Effect.Effect<void, never, ManagerServices> {
    const rt = this.rt(agent.id);
    // a reopened goal's repos are checked out before anything else, however many tries that takes
    if (agent.task === 'lead' && agent.lead?.reopening) {
      rt.resume = false;
      this.update(agent, { status: 'setting-up', activity: 'Checking the goal’s branch out again', error: undefined });
      return this.launchReopened(agent, agent.lead.reopening.closedAt).pipe(this.orFail(agent));
    }
    if (rt.resume) {
      rt.resume = false;
      this.update(agent, { status: 'setting-up', activity: 'Picking up where they left off' });
      return this.runSession(agent, rt.inbox.splice(0).join('\n\n'), agent.sessionId).pipe(this.orFail(agent));
    }
    this.update(agent, { status: 'setting-up', activity: agent.task === 'review' ? 'Reading the pull request' : 'Reading the issue', error: undefined });
    return Effect.gen({ self: this }, function* () {
      if (agent.task === 'review') return yield* this.core.reviews.launchReview(agent);
      if (agent.task === 'lead') return yield* this.launchLead(agent);
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const info = yield* github.repoInfo(agent.repo);
      if (info.isEmpty) return yield* new EmptyRepository({ repo: agent.repo });
      if (agent.task === 'issue') this.update(agent, { baseBranch: info.defaultBranch });
      const prompt = yield* this.taskPrompt(agent);
      // an issue starts a new branch from the base; conflicts and QA's findings are fixed on the PR's own branch
      const startPoint = agent.task === 'issue' ? agent.baseBranch : agent.branch;
      this.print(agent, [{ kind: 'system', text: `✻ Setting up a worktree for ${agent.repo} on ${agent.branch}` }]);
      this.update(agent, { activity: 'Cloning the repository' });
      // the PR's branch may be checked out in its goal's lead's workspace: someone resolving its conflicts works on a
      // local branch of their own, which the office pushes to the PR's
      const local = agent.task === 'conflicts' ? `${agent.branch}-conflicts-${agent.id.slice(-4)}` : undefined;
      yield* workspace.create(agent.repo, agent.id, agent.branch, startPoint, (id) => this.store.agents.has(id), local);
      if (agent.cloud) {
        // a cloud session clones its branch from GitHub, so a new one has to be there first
        this.update(agent, { activity: 'Publishing the branch for the cloud session' });
        yield* workspace.publish(workspace.dir(agent.id), agent.branch);
      }
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      rt.notes = rt.inbox.splice(0);
      yield* this.runSession(agent, withNotes(prompt, rt.notes));
    }).pipe(this.orFail(agent));
  }

  /** The agent's task, told for where they work now. */
  taskPrompt(agent: Agent): Effect.Effect<string, GitHubError | ReportGone | Refused, GitHub> {
    return Effect.gen({ self: this }, function* () {
      switch (agent.task) {
        case 'review':
          return yield* new Refused({ message: 'The QA officer gets qaPrompt (qa.ts)' });
        case 'lead':
          return yield* new Refused({ message: 'The project lead takes the captain’s messages, not a task' });
        case 'issue': {
          const issue = yield* (yield* GitHub).getIssue(agent.repo, agent.issue.number);
          this.update(agent, { issue: { number: issue.number, title: issue.title, url: issue.url } });
          return issuePrompt(agent, issue);
        }
        case 'conflicts':
          return conflictsPrompt(agent);
        case 'fix': {
          const review = this.store.reviews.get(prKey(agent.repo, agent.issue.number));
          if (!review?.report) return yield* new ReportGone({ number: agent.issue.number });
          const fixes = review.followUp?.kind === 'fixing' ? review.followUp.fixes : { kind: 'qa' as const };
          return this.core.reviews.fixPromptFor(agent, review, review.report, fixes);
        }
      }
    });
  }

  private hooks(agent: Agent): RunHooks {
    const rt = this.rt(agent.id);
    return {
      lines: (lines) => this.print(agent, lines),
      // a lead's helpers sit at its team station, each with a transcript of its own; anyone else's stay in their lines
      helperLines: agent.task === 'lead' ? (id, lines) => this.printHelper(agent, id, lines) : undefined,
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
      // a new session keeps a task list of its own, if any
      session: (sessionId) => this.update(agent, { sessionId, ...(agent.sessionId && agent.sessionId !== sessionId ? { tasks: undefined, context: undefined } : {}) }),
      context: (context) => this.update(agent, { context }),
      taskTool: (name, input, result, said) => {
        const before = agent.tasks ?? [];
        const tasks = applyTaskTool(before, name, input, result, said);
        if (tasks !== before) this.update(agent, { tasks });
      },
      helper: (event) => {
        // only a lead's helpers have somewhere to sit: the lead's team station
        if (agent.task !== 'lead') return;
        const before = agent.helpers ?? [];
        const helpers = applyHelperEvent(before, event, Date.now(), agent.effort);
        if (helpers === before) return;
        this.update(agent, { helpers });
        if (event.kind === 'started') this.print(agent, [{ kind: 'system', text: `✻ ${helperFor(event.id).name} joins ${agent.name}'s team station: ${event.description}` }]);
        // a helper that's done lingers a moment, so you see how it got on
        if (event.kind === 'ended') {
          this.background(Effect.sleep(HELPER_LINGER_MS).pipe(Effect.andThen(Effect.sync(() => this.update(agent, { helpers: (agent.helpers ?? []).filter((h) => h.id !== event.id) })))));
        }
      },
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

  /** The agent's instructions. The QA officer's may need GitHub, and that can fail. */
  instructions(agent: Agent): Effect.Effect<string, GitHubError, GitHub> {
    if (agent.task === 'review') return this.core.reviews.qaSystem(agent);
    if (agent.task === 'lead' && agent.lead) return Effect.succeed(leadSystemAppend(agent, this.store.project(agent.projectId).name, agent.lead.station));
    return Effect.succeed(systemAppend(agent));
  }

  /** One turn of the agent's session: the same tools and instructions on every turn, so a resumed session stays itself. */
  private runRequest(agent: Agent, prompt: string, instructions: string, resumeSessionId?: string): RunRequest {
    // the lead's tools answer Claude Code as Promises: the SDK's tool boundary
    const tool = <A>(effect: Effect.Effect<A, WorkError, ManagerServices>) => this.runtime.runPromise(effect);
    return {
      agentId: agent.id,
      agentName: agent.name,
      cwd: this.runtime.runSync(Workspace.use((w) => Effect.succeed(w.dir(agent.id)))),
      prompt,
      systemAppend: instructions,
      resumeSessionId,
      settings: this.store.settings,
      effort: agent.effort,
      model: agent.model,
      outputSchema: agent.task === 'review' ? QA_SCHEMA : undefined,
      cloud: agent.cloud ? { branch: agent.branch } : undefined,
      tools: agent.task === 'lead'
        ? { ship: (input) => tool(this.shipLead(agent, input)), note: (input) => tool(this.noteGoal(agent, input)), show: (input) => tool(this.showArtifact(agent, input)), explain: (input) => tool(this.explain(agent, input)), ask: (input) => tool(this.askCaptain(agent, input)), proposeClose: (input) => tool(this.proposeClose(agent, input.reason)) }
        : undefined,
    };
  }

  /**
   * One turn of the agent's session, start to finish. Messages waiting for them go in as it starts (`withInbox`). The
   * turn is held in a scope: interrupting it stops Claude.
   */
  private turn(agent: Agent, req: RunRequest, withInbox: boolean): Effect.Effect<RunOutcome, never, Sessions> {
    const rt = this.rt(agent.id);
    return Effect.scoped(
      Effect.gen({ self: this }, function* () {
        const session = yield* (yield* Sessions).start(req, this.hooks(agent));
        rt.session = session;
        if (withInbox) for (const message of rt.inbox.splice(0)) session.send(message);
        return yield* Effect.promise(() => session.done);
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => (rt.session = undefined))));
  }

  /**
   * Compacts the agent's conversation with `/compact` and the office's instructions for what to keep. Never fails the
   * agent: a compaction that doesn't happen leaves the conversation as it was. Succeeds with whether it happened.
   */
  private compact(agent: Agent, keep: string): Effect.Effect<boolean, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      if (!agent.sessionId || agent.cloud) return false;
      const rt = this.rt(agent.id);
      const wasBusy = rt.busy;
      rt.busy = true;
      this.update(agent, { activity: 'Compacting the conversation' });
      this.print(agent, [{ kind: 'system', text: '✻ The office compacts the conversation, keeping what the goal needs' }]);
      const outcome = yield* this.instructions(agent).pipe(
        Effect.flatMap((instructions) => this.turn(agent, this.runRequest(agent, `/compact ${keep}`, instructions, agent.sessionId), false)),
        Effect.catch((err) => Effect.succeed<RunOutcome>({ ok: false, summary: '', error: err.message })),
        Effect.ensuring(Effect.sync(() => (rt.busy = wasBusy))),
      );
      if (!outcome.ok) this.print(agent, [{ kind: 'error', text: `✘ Couldn't compact the conversation: ${outcome.error ?? 'no reason given'}. Carrying on as it is.` }]);
      return outcome.ok;
    });
  }

  /** The captain's Compact now: between the agent's turns, keeping what their work needs. */
  compactNow(id: string): Promise<Agent> {
    const agent = this.store.agent(id);
    if (agent.task === 'review') throw new Refused({ message: 'QA starts each review afresh, so there’s nothing to compact' });
    if (!agent.sessionId || agent.cloud) throw new Refused({ message: `${agent.name} has no conversation here to compact` });
    if (!FINISHED.includes(agent.status) || FiberMap.hasUnsafe(this.runs, id)) throw new Refused({ message: `${agent.name} is working: compact once their turn ends` });
    const { status, activity } = agent;
    this.update(agent, { status: 'working' });
    const keep = agent.lead ? compactInstructions(agent.lead) : COMPACT_INSTRUCTIONS;
    const work = this.compact(agent, keep).pipe(Effect.flatMap((ok) => Effect.sync(() => this.update(agent, { status, activity: ok ? 'Conversation compacted' : activity }))));
    return this.runtime.runPromise(Fiber.join(this.runFor(id, work))).then(() => agent);
  }

  runSession(agent: Agent, prompt: string, resumeSessionId?: string): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      const review = agent.task === 'review';
      const lead = agent.task === 'lead' ? agent.lead : undefined;
      // the lead's last slice has landed: their repos move to fresh code before they hear anything else
      if (lead && sliceLanded(lead.prs)) prompt = `${yield* this.nextSlice(agent, lead)}\n\n${prompt}`;
      // before marking them busy: the QA officer's instructions may need GitHub, and that can fail
      const instructions = yield* this.instructions(agent);
      rt.busy = true;
      this.update(agent, { status: 'working', activity: resumeSessionId ? 'Reading your message' : 'Getting started', error: undefined, finishedAt: undefined });
      const outcome = yield* this.turn(agent, this.runRequest(agent, prompt, instructions, resumeSessionId), true);
      rt.busy = false;
      // what the manager wrote during the turn carries them on into another; notes that waited for its end don't
      const carryOn = rt.inbox.length > 0;
      rt.inbox.push(...(rt.afterTurn?.splice(0) ?? []));
      if (!this.store.agents.has(agent.id)) return;

      const attaching = rt.attaching;
      if (attaching) {
        // the session the captain started may still be answering its first message
        if (attachAgain(outcome, attaching.tries)) {
          attaching.tries++;
          this.update(agent, { activity: 'Waiting for the cloud session to finish its first reply' });
          yield* Effect.sleep('15 seconds');
          return yield* this.runSession(agent, prompt, resumeSessionId);
        }
        rt.attaching = undefined;
        if (!outcome.ok && !outcome.aborted && !outcome.started) {
          this.print(agent, [{ kind: 'error', text: `✘ Couldn't attach to the cloud session: ${outcome.error ?? 'no reason given'}` }]);
          return this.core.cloud.awaitCloud(agent, attaching.handover);
        }
      }
      if (outcome.aborted) {
        this.update(agent, { status: 'stopped', activity: STOPPED_BY_CAPTAIN, permission: undefined, finishedAt: Date.now() });
        if (review) this.core.reviews.reviewEnded(agent, STOPPED_BY_CAPTAIN);
        this.core.reviews.fixEnded(agent, 'stopped');
        this.schedule();
        return;
      }
      if (fallBackToLocal(agent, outcome)) {
        // a session id from the cloud means it already worked there: its pushes may be on GitHub but not in the worktree
        const ranInCloud = !!agent.sessionId;
        rt.nudged = false;
        if (!ranInCloud) {
          // they haven't started: the captain starts their cloud session, which a terminal can, or keeps them here
          this.print(agent, [{ kind: 'system', text: "✻ Claude Code won't start a cloud session without a terminal" }]);
          return this.core.cloud.awaitCloud(agent, { since: Date.now(), fresh: true });
        }
        this.update(agent, { cloud: undefined, sessionId: undefined });
        this.print(agent, [{ kind: 'system', text: "✻ Claude Code won't start a cloud session from Focus – carrying on here as a 💻 local agent" }]);
        this.update(agent, { activity: `Fetching ${agent.branch} from GitHub` });
        const workspace = yield* Workspace;
        yield* workspace.pull(workspace.dir(agent.id), agent.branch);
        // only a new session gets refused, so this is already a carry-on prompt with the manager's message in it
        return yield* this.runSession(agent, prompt);
      }
      if (lead && sessionGone(outcome, !!resumeSessionId)) {
        this.print(agent, [{ kind: 'system', text: '✻ Claude Code no longer has their conversation – carrying on in a new one' }]);
        this.update(agent, { sessionId: undefined });
        return yield* this.runSession(agent, freshSessionPrompt(agent.lead!, agent.branch, [prompt], false));
      }
      if (agent.cloud && carryOnInNewSession(outcome, !!resumeSessionId)) {
        // everything the old session did is on the branch: a new one picks it up from there
        this.print(agent, [{ kind: 'system', text: `✻ Couldn't get back into the cloud session (${truncate(outcome.error ?? 'no reason given', 200)}) – starting a new one on ${agent.branch}` }]);
        return yield* this.runSession(agent, carryOnPrompt(agent, prompt));
      }
      if (carryOn) {
        // The manager wrote while the session was wrapping up: carry on in the same conversation.
        return yield* this.runSession(agent, rt.inbox.splice(0).join('\n\n'), agent.sessionId);
      }
      if (!outcome.ok) {
        this.fail(agent, outcome.error ?? 'The agent stopped with an error');
        return;
      }
      if (review) return yield* this.core.reviews.finishReview(agent, outcome.structured, outcome.summary);
      if (lead) {
        // the lead's turn is over: it's the captain's turn, and their work ships when the lead says so, not now. Their
        // subagents ended with it; any that just finished linger a moment
        this.update(agent, { status: 'done', activity: 'Your turn', finishedAt: Date.now(), helpers: agent.helpers?.filter((h) => h.status !== 'working') });
        this.schedule();
        return;
      }
      yield* this.deliver(agent, outcome.summary);
    });
  }

  /** Pushes the branch and opens (or updates) the pull request. Then the agent hears anything the manager said meanwhile. */
  private deliver(agent: Agent, summary: string): Effect.Effect<void, never, ManagerServices> {
    const rt = this.rt(agent.id);
    return Effect.gen({ self: this }, function* () {
      rt.busy = true;
      yield* this.ship(agent, summary).pipe(
        this.orFail(agent),
        Effect.ensuring(Effect.sync(() => {
          rt.busy = false;
          this.schedule();
        })),
      );
      if (rt.inbox.length && this.store.agents.has(agent.id) && agent.status === 'done' && agent.sessionId) {
        yield* this.runSession(agent, rt.inbox.splice(0).join('\n\n'), agent.sessionId).pipe(this.orFail(agent));
      }
    });
  }

  /** The agent's work, onto GitHub: they're asked once to commit (or, in the cloud, push) what they left behind. */
  private ship(agent: Agent, summary: string): Effect.Effect<void, WorkError, ManagerServices> {
    const rt = this.rt(agent.id);
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const dir = workspace.dir(agent.id);
      if (agent.cloud) {
        // a cloud agent pushed its work to GitHub: bring it into the worktree, where the checks below look
        const before = yield* workspace.head(dir);
        this.update(agent, { activity: `Fetching ${agent.branch} from GitHub` });
        yield* workspace.pull(dir, agent.branch);
        if (afterCloudRun({ before, after: yield* workspace.head(dir), nudged: rt.nudged }) === 'nudge') {
          rt.nudged = true;
          this.print(agent, [{ kind: 'system', text: `✻ Nothing new on ${agent.branch} – asking the agent to push their work` }]);
          return yield* this.runSession(agent, pushNudge(agent), agent.sessionId);
        }
      } else if (!rt.nudged && (yield* workspace.hasUncommittedChanges(dir))) {
        rt.nudged = true;
        this.print(agent, [{ kind: 'system', text: '✻ Uncommitted changes left behind – asking the agent to commit them' }]);
        return yield* this.runSession(agent, COMMIT_NUDGE, agent.sessionId);
      }
      const fixing = this.core.reviews.fixing(agent);
      if (fixing?.sha && sameCommit(yield* workspace.head(dir), fixing.sha)) {
        this.update(agent, { status: 'done', activity: 'Finished without fixing anything – see the terminal', finishedAt: Date.now() });
        this.core.reviews.fixEnded(agent, 'pushed-nothing');
        return;
      }
      const ahead = yield* workspace.commitsAhead(dir, agent.baseBranch);
      if (ahead === 0) {
        this.update(agent, { status: 'done', activity: 'Finished without committing changes – see the terminal', finishedAt: Date.now() });
        this.hub.toast('info', `${agent.name} finished #${agent.issue.number} without code changes`, agent.id);
        return;
      }
      if (agent.cloud) {
        this.print(agent, [{ kind: 'system', text: `✻ ${ahead} commit${ahead === 1 ? '' : 's'} on ${agent.branch}, pushed from the cloud session` }]);
      } else {
        // the push is forced, and every worktree of the repo shares its remote-tracking refs, so the lease alone wouldn't stop it
        if (yield* workspace.missingRemoteCommits(dir, agent.branch)) {
          return yield* new Refused({ message: `Someone else pushed to ${agent.branch} meanwhile: merge it in with \`git pull --no-rebase origin ${agent.branch}\` before this can ship` });
        }
        this.update(agent, { status: 'pushing', activity: `Pushing ${ahead} commit${ahead === 1 ? '' : 's'}` });
        this.print(agent, [{ kind: 'system', text: `✻ Pushing ${agent.branch}` }]);
        yield* this.retrying(agent, 'the push', workspace.push(dir, agent.branch));
      }

      let pr = agent.pr ?? (yield* this.retrying(agent, 'looking for the pull request', github.findPullRequest(agent.repo, agent.branch)));
      if (pr) {
        this.hub.toast('success', `${agent.name} updated PR #${pr.number}`, agent.id);
      } else {
        this.update(agent, { activity: 'Opening the pull request' });
        pr = yield* this.retrying(agent, 'opening the pull request', github.createPullRequest(agent.repo, {
          head: agent.branch,
          base: agent.baseBranch,
          title: agent.issue.title,
          body: pullRequestBody(agent, summary, this.store.settings.attribution),
        }));
        this.hub.toast('success', `🎉 ${agent.name} opened PR #${pr.number}: ${agent.issue.title}`, agent.id);
      }
      this.print(agent, [{ kind: 'success', text: `✔ Pull request ready: ${pr.url}` }]);
      this.update(agent, { status: 'done', pr, activity: `PR #${pr.number} is ready for review`, finishedAt: Date.now() });
      const lead = agent.task === 'conflicts' ? this.leadWith(agent.repo, pr.number) : undefined;
      if (lead) this.mergedForLead(lead, { repo: agent.repo, number: pr.number, baseBranch: agent.baseBranch, branch: agent.branch }, yield* workspace.head(dir), agent.name);
      this.boardChanged(agent.projectId);
      this.core.reviews.fixEnded(agent, 'pushed');
      // new code on the PR: the room's QA officer tests it
      const project = this.store.projects.find((p) => p.id === agent.projectId);
      if (project && autoQaFor(project)) {
        try {
          this.core.reviews.requestReview(agent.projectId, agent.repo, pr.number, agent.issue.title);
        } catch (err) {
          this.print(agent, [{ kind: 'error', text: `✘ Couldn't hand PR #${pr.number} to QA: ${errorMessage(err)}` }]);
        }
      }
    });
  }

  fail(agent: Agent, err: { message: string } | string): void {
    const message = typeof err === 'string' ? err : err.message;
    this.print(agent, [{ kind: 'error', text: `✘ ${message}` }]);
    this.update(agent, { status: 'error', error: message, activity: 'Hit a problem – send a message to retry', permission: undefined, finishedAt: Date.now() });
    this.hub.toast('error', `${agent.name}: ${truncate(message, 140)}`, agent.id);
    if (agent.task === 'review') this.core.reviews.reviewEnded(agent, message);
    this.core.reviews.fixEnded(agent, 'failed');
    this.schedule();
  }

  // ---------------------------------------------------------------- goals and their leads

  /**
   * Starts a goal at one of the room's team stations: a lead of its own (the captain's own Claude Code session for the
   * goal), with every repo of the project checked out on the goal's first branch, who hears `text` first. `station`
   * picks the station; otherwise the goal takes the first free one. Later messages go to the lead like any agent's.
   */
  startGoal(projectId: string, text: string, how: { station?: number; effort?: Effort; from?: string } = {}): { agent: Agent } | { queued: QueuedGoal } {
    const project = this.store.project(projectId);
    if (!project.repos.length) throw new Refused({ message: `Connect a repository to ${project.name} first` });
    if (!text.trim()) throw new Refused({ message: 'Tell them what you’re after' });
    const leads = this.store.agentsIn(projectId).filter((a) => a.task === 'lead');
    // goals already waiting go first: a new one joins the line behind them, even if a station has just come free
    if (how.station === undefined && project.goalQueue?.length) return { queued: this.queueGoal(projectId, text, how) };
    const station = pickStation(leads.map((a) => a.lead?.station ?? 0), how.station);
    if (station === undefined) {
      const wanted = how.station;
      if (wanted === undefined) return { queued: this.queueGoal(projectId, text, how) };
      const holder = leads.find((a) => a.lead?.station === wanted);
      throw new Refused({ message: holder ? `Team station ${wanted + 1} already has a goal: ${holder.lead?.title ?? holder.name}` : `${project.name} has team stations 1 to ${TEAM_STATIONS}` });
    }
    const suffix = newId('g').slice(-6);
    const id = leadId(projectId, suffix);
    const crew = leadFor(projectId, suffix, leads.map((a) => a.name));
    const title = goalTitle(text);
    const effort = goalEffort(how.effort, this.store.settings);
    const agent: Agent = {
      id,
      name: crew.name,
      avatar: crew.avatar,
      projectId,
      repo: project.repos[0],
      task: 'lead',
      issue: { number: 0, title, url: '' },
      effort,
      desk: LEAD_DESK,
      status: 'queued',
      activity: `Coming over to team station ${station + 1}`,
      branch: sliceBranch(title, 1, newId('s').slice(-4)),
      baseBranch: 'main',
      lead: { station, title, brief: goalBrief(text), repos: [], slice: 1, prs: [] },
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.core.runtimes.set(id, { inbox: [text.trim()], notes: [], nudged: false, busy: false });
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [
      { kind: 'system', text: `✻ ${crew.name} takes team station ${station + 1} to lead “${title}” across ${project.repos.join(', ')} (${effort} effort)` },
      { kind: 'manager', text: `▶ ${how.from ? `Captain, from ${how.from}` : 'Captain'}: ${text.trim()}` },
    ]);
    this.schedule();
    return { agent };
  }

  /**
   * Reopens a closed goal from the room's log at a free team station (`station`, or the first free one): the same lead,
   * so Claude Code finds their conversation again, with every repo checked out on the goal's branch as it was left.
   */
  reopenGoal(projectId: string, goalId: string, station?: number): Agent {
    const project = this.store.project(projectId);
    const goal = (project.goals ?? []).find((g) => g.id === goalId);
    if (!goal) throw new Refused({ message: 'That goal isn’t in the room’s log' });
    if (!reopenable(goal)) throw new Refused({ message: `“${goal.title}” closed before the office kept its branch, so it can’t be reopened` });
    if (this.store.agents.has(goal.id)) throw new Refused({ message: `“${goal.title}” is already under way` });
    const leads = this.store.agentsIn(projectId).filter((a) => a.task === 'lead');
    const free = pickStation(leads.map((a) => a.lead?.station ?? 0), station) ?? pickStation(leads.map((a) => a.lead?.station ?? 0));
    if (free === undefined) throw new Refused({ message: `Every team station in ${project.name} has a goal: close one first` });
    const crew = leadFor(projectId, goal.id.split('_').at(-1)!, leads.map((a) => a.name));
    const agent: Agent = {
      id: goal.id,
      name: leads.some((a) => a.name === goal.leadName) ? crew.name : goal.leadName,
      avatar: crew.avatar,
      projectId,
      repo: goal.repos![0].repo,
      task: 'lead',
      issue: { number: 0, title: goal.title, url: '' },
      effort: goalEffort(undefined, this.store.settings),
      desk: LEAD_DESK,
      status: 'queued',
      activity: `Coming back to team station ${free + 1}`,
      branch: goal.branch!,
      baseBranch: goal.repos![0].baseBranch,
      lead: reopenedWork(goal, free),
      sessionId: goal.sessionId,
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.core.runtimes.set(agent.id, { inbox: [], notes: [], nudged: false, busy: false });
    project.goals = (project.goals ?? []).filter((g) => g.id !== goal.id);
    this.projectsChanged();
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [{ kind: 'system', text: `✻ The captain reopened “${goal.title}”: ${agent.name} comes back to team station ${free + 1}, on ${goal.branch}` }]);
    this.schedule();
    return agent;
  }

  /** Puts a goal in line for the next free team station. It waits there for the captain to start it. */
  private queueGoal(projectId: string, text: string, how: { effort?: Effort; from?: string }): QueuedGoal {
    const project = this.store.project(projectId);
    const queued: QueuedGoal = { id: newId('q'), text: text.trim(), effort: how.effort, from: how.from, at: Date.now() };
    const ahead = project.goalQueue?.length ?? 0;
    this.changeQueue(projectId, [...(project.goalQueue ?? []), queued]);
    this.hub.toast('info', `🧭 “${goalTitle(text)}” waits in line for a team station in ${project.name}${ahead ? `, behind ${ahead} other goal${ahead === 1 ? '' : 's'}` : ''}`, undefined, projectId);
    return queued;
  }

  private changeQueue(projectId: string, queue: QueuedGoal[]): void {
    this.store.project(projectId).goalQueue = queue;
    this.projectsChanged();
  }

  private projectsChanged(): void {
    this.store.save();
    this.hub.send({ type: 'projects', projects: this.store.projects });
  }

  /** Starts a queued goal at a free team station, with the captain's last edits to it. */
  startQueued(projectId: string, queueId: string, edits: { text?: string; effort?: Effort; station?: number } = {}): Agent {
    const project = this.store.project(projectId);
    const queued = (project.goalQueue ?? []).find((g) => g.id === queueId);
    if (!queued) throw new Refused({ message: 'That goal is no longer in line' });
    const leads = this.store.agentsIn(projectId).filter((a) => a.task === 'lead');
    // the station the captain started it from, if it's still free; else the first free one
    const taken = leads.map((a) => a.lead?.station ?? 0);
    const station = (edits.station === undefined ? undefined : pickStation(taken, edits.station)) ?? pickStation(taken);
    if (station === undefined) throw new Refused({ message: `Every team station in ${project.name} still has a goal` });
    const started = this.startGoal(projectId, edits.text?.trim() || queued.text, { station, effort: edits.effort ?? queued.effort, from: queued.from });
    if (!('agent' in started)) throw new Refused({ message: 'No team station was free after all' });
    this.changeQueue(projectId, (project.goalQueue ?? []).filter((g) => g.id !== queueId));
    return started.agent;
  }

  dropQueued(projectId: string, queueId: string): void {
    this.changeQueue(projectId, (this.store.project(projectId).goalQueue ?? []).filter((g) => g.id !== queueId));
  }

  moveQueued(projectId: string, queueId: string, by: number): void {
    this.changeQueue(projectId, moveQueued(this.store.project(projectId).goalQueue ?? [], queueId, by));
  }

  /** The lead's note tool: the goal's note and title, as they want them. */
  private noteGoal(agent: Agent, input: NoteInput): Effect.Effect<string, Refused> {
    return Effect.gen({ self: this }, function* () {
      const work = agent.lead;
      if (!work) return yield* new Refused({ message: 'There’s no goal to keep a note on' });
      const next = applyNote(work, input);
      if ('error' in next) return yield* new Refused({ message: next.error });
      this.update(agent, { lead: { ...work, title: next.title, note: next.note }, issue: { ...agent.issue, title: next.title } });
      return 'Noted. The captain sees the note on the goal, and you hear it again at each new slice.';
    });
  }

  /**
   * The lead's show tool: the page goes on the goal, with a picture of it for the station's screen. A page the office
   * can't take a picture of still goes up: the captain can open it, though the screen only shows its title.
   */
  private showArtifact(agent: Agent, input: ArtifactInput): Effect.Effect<string, Refused, Renderer> {
    return Effect.gen({ self: this }, function* () {
      if (!agent.lead) return yield* new Refused({ message: 'There’s no goal to show it on' });
      const checked = showArtifact(agent.lead.artifacts ?? [], input, Date.now());
      if ('error' in checked) return yield* new Refused({ message: checked.error });
      this.store.saveArtifact(agent.id, `${input.id}.html`, Buffer.from(input.html));
      const picture = yield* (yield* Renderer).render(input.html).pipe(
        Effect.map(({ image, errors }) => ({ bytes: image, errors })),
        Effect.catch((err) => Effect.succeed({ failed: err.message })),
      );
      if ('bytes' in picture) this.store.saveArtifact(agent.id, `${input.id}.jpg`, picture.bytes);
      else this.store.deleteArtifact(agent.id, `${input.id}.jpg`);
      // taking the picture takes a moment: the goal may have closed, or the lead shown something else, meanwhile
      const work = agent.lead;
      if (!work) return 'The goal closed before it went up.';
      const next = showArtifact(work.artifacts ?? [], input, Date.now());
      if ('error' in next) return yield* new Refused({ message: next.error });
      this.update(agent, { lead: { ...work, artifacts: next.map((a) => (a.id === input.id && 'bytes' in picture ? { ...a, image: true } : a)) } });
      const where = `“${next.find((a) => a.id === input.id)!.title}” is on your station's screen; the captain can open it up close.`;
      return 'bytes' in picture ? `${where}${pageErrorsNote(picture.errors)}` : `${where} The office couldn't take a picture of it for the screen (${picture.failed}), so the screen shows only its title.`;
    });
  }

  /** The lead's explain tool: their beats and stage go in the office's player, which goes up like any of show's visuals. */
  private explain(agent: Agent, input: ExplainerInput): Effect.Effect<string, Refused, Renderer> {
    return Effect.gen({ self: this }, function* () {
      const built = explainerPage(input);
      if ('error' in built) return yield* new Refused({ message: built.error });
      const shown = yield* this.showArtifact(agent, built);
      const seconds = input.beats.reduce((sum, b) => sum + b.seconds, 0);
      return `${shown} It's an explainer of ${input.beats.length} beats, ${Math.round(seconds)} seconds in all.`;
    });
  }

  /**
   * The lead's ask tool: the question goes on the station's screen, each option a page with a picture of its own, in
   * place of one still open. The captain's pick comes back to the lead as a message from them (`answer`).
   */
  private askCaptain(agent: Agent, input: QuestionInput): Effect.Effect<string, Refused, Renderer> {
    return Effect.gen({ self: this }, function* () {
      if (!agent.lead) return yield* new Refused({ message: 'There’s no goal to ask about' });
      const checked = askQuestion(agent.lead.questions ?? [], input, Date.now());
      if ('error' in checked) return yield* new Refused({ message: checked.error });
      // the pictures first, in memory: the question's id, and which files are whose, are settled once they're taken
      const renderer = yield* Renderer;
      const pictures: (Buffer | undefined)[] = [];
      for (const option of input.options) pictures.push(Option.getOrUndefined(yield* renderer.render(option.html).pipe(Effect.map((p) => p.image), Effect.option)));
      // taking them takes a moment: the goal may have closed, or the lead asked again, meanwhile
      const work = agent.lead;
      if (!work) return 'The goal closed before the question went up.';
      const next = askQuestion(work.questions ?? [], input, Date.now());
      if ('error' in next) return yield* new Refused({ message: next.error });
      const { asked } = next;
      for (const q of next.dropped) for (const o of q.options) for (const ext of ['html', 'jpg']) this.store.deleteArtifact(agent.id, `${q.id}.${o.id}.${ext}`);
      for (const [i, option] of asked.options.entries()) {
        this.store.saveArtifact(agent.id, `${asked.id}.${option.id}.html`, Buffer.from(input.options[i].html));
        const picture = pictures[i];
        if (picture) this.store.saveArtifact(agent.id, `${asked.id}.${option.id}.jpg`, picture);
      }
      const questions = next.questions.map((q) => (q.id === asked.id ? { ...q, options: q.options.map((o, i) => (pictures[i] ? { ...o, image: true } : o)) } : q));
      this.update(agent, { lead: { ...work, questions } });
      this.print(agent, [{ kind: 'manager', text: `❓ Asked the captain: ${asked.question} (${asked.options.map((o) => `${o.id.toUpperCase()}: ${o.label}`).join(' · ')})` }]);
      const missing = pictures.filter((p) => !p).length;
      return `Your question is on your station's screen with its ${asked.options.length} options${missing ? ` (the office couldn't take a picture of ${missing} of them, so the screen shows just their labels)` : ''}. The captain's pick comes back to you as a message from them: end your turn here and wait for it.`;
    });
  }

  /** The captain picks an option of the lead's open question: it's marked answered, and the lead hears which. */
  answer(id: string, questionId: string, option: string, note?: string): Agent {
    const agent = this.store.agent(id);
    const work = agent.lead;
    if (!work) throw new Error(`${agent.name} isn’t leading a goal`);
    const questions = answerQuestion(work.questions ?? [], questionId, option, note, Date.now());
    if ('error' in questions) throw new Error(questions.error);
    this.update(agent, { lead: { ...work, questions } });
    this.message(id, answerMessage(questions.find((q) => q.id === questionId)!, option, note));
    return agent;
  }

  /** The lead's propose_close tool: the captain hears the goal looks done, and closes it or carries on. */
  private proposeClose(agent: Agent, reason: string): Effect.Effect<string, Refused> {
    return Effect.gen({ self: this }, function* () {
      const work = agent.lead;
      if (!work) return yield* new Refused({ message: 'There’s no goal to close' });
      this.update(agent, { lead: { ...work, closing: { reason: reason.trim() || 'The goal looks done', at: Date.now() } } });
      this.print(agent, [{ kind: 'success', text: `🏁 ${agent.name} thinks “${work.title}” is ready to wrap up: ${reason.trim()}` }]);
      this.hub.toast('success', `🏁 ${agent.name} thinks “${work.title}” is ready to wrap up`, agent.id);
      return 'The captain sees that you think the goal is ready to wrap up. Tell them why in a sentence or two, then stop: they close the goal, or carry on with you.';
    });
  }

  /**
   * Closes a goal: commits any uncommitted work as a WIP snapshot on its branch, files it in the room's log and sends its
   * lead home, which frees the station. First says what would be left behind (work GitHub hasn't got, open pull
   * requests, a goal that shipped nothing), unless `force`. A checkout whose work can't be saved keeps the goal open.
   */
  closeGoal(id: string, force = false): Promise<{ closed: true } | { warn: string[] }> {
    return this.runtime.runPromise(Effect.gen({ self: this }, function* () {
      const agent = this.store.agent(id);
      const work = agent.lead;
      if (agent.task !== 'lead' || !work) return yield* new Refused({ message: `${agent.name} isn’t leading a goal` });
      const workspace = yield* Workspace;
      const dir = (folder: string) => workspace.dir(leadWorktreeId(id, folder));
      // a check that fails counts against closing: changes git couldn't look for are treated as there. A reopened goal
      // whose repos were never checked out again has nothing to check: its branch is as it was
      const repos = yield* Effect.forEach(work.reopening ? [] : work.repos, (r) =>
        Effect.all({
          folder: Effect.succeed(r.folder),
          dirty: workspace.hasUncommittedChanges(dir(r.folder)).pipe(Effect.orElseSucceed(() => true)),
          branch: workspace.branchState(dir(r.folder), repoBranch(r, agent.branch), r.baseBranch).pipe(Effect.orElseSucceed(() => undefined)),
          on: Effect.succeed(r.branch),
        }), { concurrency: 'unbounded' });
      const check = closeCheck(work, agent.branch, repos);
      if (check.kind === 'warn' && !force) return { warn: check.reasons };
      this.closingGoals.add(id);
      yield* Effect.forEach(work.repos, (r) =>
        workspace.snapshot(dir(r.folder), snapshotMessage(work.title)).pipe(
          Effect.mapError((err) => new Refused({ message: `Couldn’t commit ./${r.folder}’s uncommitted work as a WIP snapshot (${err.message}), so “${work.title}” stays open` })),
          Effect.tap((saved) => Effect.sync(() => saved && this.print(agent, [{ kind: 'system', text: `✻ Committed ./${r.folder}’s uncommitted work as a WIP snapshot on ${repoBranch(r, agent.branch)}` }]))),
        ), { discard: true }).pipe(Effect.onError(() => Effect.sync(() => this.closingGoals.delete(id))));
      const project = this.store.project(agent.projectId);
      const record = goalRecord(agent, Date.now());
      const before = project.goals ?? [];
      project.goals = fileGoal(before, record);
      // what its lead showed stays with the goal in the log, until the goal drops off the end of it
      for (const gone of leftLog(before, project.goals)) this.store.dropArtifacts(gone.id);
      this.core.ledger.record(project.id, { kind: 'goal-closed', goal: record });
      this.projectsChanged();
      yield* this.goHome(id);
      this.closingGoals.delete(id);
      // the goal's reviewer goes home with its lead; a review they were on, or still waiting, goes to the room's QA officer
      const reviewer = goalReviewerId(id);
      for (const r of this.store.reviews.values()) {
        if (r.agentId === reviewer && (r.status === 'testing' || r.status === 'queued')) this.core.reviews.putReview({ ...r, status: 'queued', agentId: undefined });
      }
      yield* this.goHome(reviewer);
      this.core.reviews.nextReview(agent.projectId);
      const next = nextGoal(project.goalQueue);
      this.hub.toast('success', next
        ? `🏁 “${work.title}” is closed. Team station ${work.station + 1} is free: next up is “${goalTitle(next.text)}” (L to start it)`
        : `🏁 “${work.title}” is closed, and team station ${work.station + 1} is free`, undefined, project.id);
      return { closed: true as const };
    }));
  }

  /** How hard the agent thinks from now on: from its next request if it's working, else from its next turn. */
  setEffort(id: string, effort: Effort): Agent {
    const agent = this.store.agent(id);
    if (agent.effort === effort) return agent;
    this.update(agent, { effort });
    this.rt(id).session?.setEffort?.(effort);
    this.print(agent, [{ kind: 'system', text: `✻ The captain set ${agent.name}'s effort to ${effort}` }]);
    return agent;
  }

  /** Checks out every repo of the project side by side, on the goal's first branch, then hands the lead the captain's words. */
  private launchLead(agent: Agent): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      const project = this.store.project(agent.projectId);
      yield* this.checkOutSlice(agent, project.repos);
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      // a new goal, or one whose conversation couldn't be resumed: the lead hears where it stands
      yield* this.runSession(agent, freshSessionPrompt(agent.lead!, agent.branch, rt.inbox.splice(0), sliceLanded(agent.lead!.prs)));
    });
  }

  /**
   * A reopened goal's lead: its pull requests as GitHub has them now, every repo checked out on the goal's branch as it
   * was left, then the conversation picked back up (or a new one, when there's none to go back to).
   */
  private launchReopened(agent: Agent, closedAt: number): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      // a pull request may have merged or closed while the goal was closed, with no lead to hear about it
      const prs = yield* Effect.forEach(agent.lead!.prs, (p) =>
        p.outcome ? Effect.succeed(p) : github.pullRequestState(p.repo, p.number).pipe(
          Effect.map((state) => (state === 'OPEN' ? p : { ...p, outcome: state === 'MERGED' ? 'merged' as const : 'closed' as const })),
          Effect.orElseSucceed(() => p),
        ));
      for (const r of agent.lead!.repos) {
        this.update(agent, { activity: `Checking out ${r.repo}` });
        this.print(agent, [{ kind: 'system', text: `✻ Checking out ${r.repo} at ./${r.folder} on ${repoBranch(r, agent.branch)}, as it was left` }]);
        yield* workspace.reopen(r.repo, leadWorktreeId(agent.id, r.folder), repoBranch(r, agent.branch), (id) => this.store.agents.has(id));
      }
      this.update(agent, { lead: { ...agent.lead!, prs, reopening: undefined } });
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      const note = [reopenedNote(agent.lead!, agent.branch, closedAt), ...rt.inbox.splice(0)].join('\n\n');
      yield* this.runSession(agent, agent.sessionId ? note : freshSessionPrompt(agent.lead!, agent.branch, [note], sliceLanded(prs)), agent.sessionId);
    });
  }

  /** Worktrees of `repos` on the lead's current branch, each from its repo's default branch, recorded on the lead. */
  private checkOutSlice(agent: Agent, repos: string[]): Effect.Effect<void, GitHubError | GitFailed | NothingToCheckOut, GitHub | Workspace> {
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const folders = repoFolders(repos);
      const checkouts: NonNullable<Agent['lead']>['repos'] = [];
      for (const repo of repos) {
        const info = yield* github.repoInfo(repo);
        if (info.isEmpty) {
          this.print(agent, [{ kind: 'system', text: `✻ Skipping ${repo}: it has no commits yet` }]);
          continue;
        }
        const folder = folders.get(repo)!;
        this.update(agent, { activity: `Checking out ${repo}` });
        this.print(agent, [{ kind: 'system', text: `✻ Checking out ${repo} at ./${folder} on ${agent.branch}` }]);
        yield* workspace.create(repo, leadWorktreeId(agent.id, folder), agent.branch, info.defaultBranch, (id) => this.store.agents.has(id));
        checkouts.push({ repo, folder, baseBranch: info.defaultBranch });
      }
      if (!checkouts.length) return yield* new NothingToCheckOut();
      this.update(agent, { lead: { ...agent.lead!, repos: checkouts }, baseBranch: checkouts[0].baseBranch });
    });
  }

  /**
   * The slice has landed: a new branch on fresh code in every repo, unless a repo has uncommitted changes, which are
   * never thrown away. Commits that never shipped come along onto the new branch, or stay on the old one, with the
   * lead told how to bring them over, when they don't apply cleanly. Succeeds with what the lead hears about it.
   */
  private nextSlice(agent: Agent, lead: NonNullable<Agent['lead']>): Effect.Effect<string, GitHubError | GitFailed | NothingToCheckOut, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const workspace = yield* Workspace;
      const project = this.store.project(agent.projectId);
      const dir = (folder: string) => workspace.dir(leadWorktreeId(agent.id, folder));
      const dirty = yield* Effect.filter(lead.repos, (r) => workspace.hasUncommittedChanges(dir(r.folder)));
      if (afterLanding(dirty.map((r) => r.folder)) === 'held-back') return heldBack(lead, dirty.map((r) => r.folder));
      const unshipped = yield* Effect.forEach(lead.repos, (r) =>
        workspace.unshippedCommits(dir(r.folder), r.baseBranch, shippedSha(lead, r.repo)).pipe(Effect.map((commits) => ({ ...r, commits }))),
      );
      const oldBranch = agent.branch;
      const slice = lead.slice + 1;
      yield* Effect.forEach(lead.repos, (r) => workspace.remove(r.repo, leadWorktreeId(agent.id, r.folder)), { discard: true });
      const note = lead.note && { ...lead.note, slice: [] };
      this.update(agent, { branch: sliceBranch(lead.title, slice, newId('s').slice(-4)), lead: { ...lead, note, repos: [], slice, prs: [], landed: everyPr(lead) } });
      yield* this.checkOutSlice(agent, project.repos);
      const carried = yield* Effect.forEach(unshipped.filter((r) => r.commits.length), ({ repo, folder, commits }) =>
        Effect.gen({ self: this }, function* () {
          const now = agent.lead!.repos.find((r) => r.repo === repo);
          if (!now) return { folder, commits, applied: false };
          this.print(agent, [{ kind: 'system', text: `✻ Bringing ${commits.length} unshipped commit${commits.length === 1 ? '' : 's'} over to ./${now.folder}` }]);
          const applied = yield* workspace.cherryPick(dir(now.folder), commits).pipe(Effect.as(true), Effect.orElseSucceed(() => false));
          return { folder: now.folder, commits, applied };
        }),
      );
      return [newSliceNote(agent.lead!, agent.branch), carriedNote(carried, oldBranch)].filter(Boolean).join('\n\n');
    });
  }

  /**
   * The lead's ship tool: pushes every repo with new commits and opens (or updates) its pull request, which QA then
   * reviews. Nothing ships while any repo has uncommitted changes.
   */
  private shipLead(agent: Agent, input: { title: string; summary: string }): Effect.Effect<string, GitHubError | GitFailed | Refused, GitHub | Workspace> {
    return Effect.gen({ self: this }, function* () {
      const work = agent.lead;
      if (!work?.repos.length) return yield* new Refused({ message: 'There’s nothing checked out to ship' });
      if (this.closingGoals.has(agent.id)) return yield* new Refused({ message: 'The captain is closing the goal: nothing ships now' });
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      // a repo whose pull request merged moves to a fresh branch first: its own still carries the merged commits
      const moved = yield* this.freshBranches(agent);
      const movedNotes = moved.map(freshBranchNote);
      if (moved.some((m) => !m.applied)) return `Nothing shipped.\n\n${movedNotes.join('\n\n')}`;
      const states = yield* Effect.forEach(
        agent.lead!.repos,
        (r) =>
          Effect.gen(function* () {
            const dir = workspace.dir(leadWorktreeId(agent.id, r.folder));
            const head = yield* workspace.head(dir);
            const changed = !openPr(work, r.repo)?.sha || !sameCommit(head, openPr(work, r.repo)!.sha!);
            return { ...r, dir, head, branch: repoBranch(r, agent.branch), changed, dirty: yield* workspace.hasUncommittedChanges(dir), ahead: yield* workspace.commitsAhead(dir, r.baseBranch) };
          }),
        { concurrency: 'unbounded' },
      );
      // the office may have pushed a merge to the slice's branch (resolving conflicts): never ship over it
      for (const s of states.filter((x) => x.changed && openPr(work, x.repo))) {
        if (yield* workspace.missingRemoteCommits(s.dir, s.branch)) return yield* new Refused({ message: behindNote(s.folder, s.branch) });
      }
      const plan = shipPlan(states);
      if (plan.kind !== 'ship') return [notShipped(plan), ...movedNotes].join('\n\n');
      const project = this.store.project(agent.projectId);
      const title = input.title.trim() || `Slice ${work.slice}`;
      const lines: string[] = [];
      for (const s of states.filter((x) => plan.repos.includes(x.repo))) {
        this.update(agent, { status: 'pushing', activity: `Shipping ${s.repo}` });
        this.print(agent, [{ kind: 'system', text: `✻ Pushing ${s.branch} in ${s.repo}` }]);
        yield* this.retrying(agent, `the push in ${s.repo}`, workspace.push(s.dir, s.branch));
        const found = openPr(work, s.repo) ?? (yield* this.retrying(agent, 'looking for the pull request', github.findPullRequest(s.repo, s.branch)));
        let pr: { number: number; url: string };
        if (found) {
          pr = found;
          lines.push(`Updated ${s.repo}#${pr.number}: ${pr.url}`);
        } else {
          const alongside = plan.repos.filter((r) => r !== s.repo);
          const body = leadPrBody(input.summary, agent, alongside, this.store.settings.attribution);
          pr = yield* this.retrying(agent, 'opening the pull request', github.createPullRequest(s.repo, { head: s.branch, base: s.baseBranch, title, body }));
          lines.push(`Opened ${s.repo}#${pr.number}: ${pr.url}`);
          this.hub.toast('success', `🎉 ${agent.name} opened ${s.repo.split('/')[1]}#${pr.number}: ${title}`, agent.id);
        }
        const others = agent.lead!.prs.filter((p) => !(p.repo === s.repo && p.number === pr.number));
        this.update(agent, { lead: { ...agent.lead!, prs: [...others, { repo: s.repo, number: pr.number, url: pr.url, sha: s.head, branch: s.branch }] } });
        this.print(agent, [{ kind: 'success', text: `✔ ${lines.at(-1)}` }]);
        if (autoQaFor(project)) {
          try {
            this.core.reviews.requestReview(agent.projectId, s.repo, pr.number, title);
          } catch (err) {
            this.print(agent, [{ kind: 'error', text: `✘ Couldn't hand ${s.repo}#${pr.number} to QA: ${errorMessage(err)}` }]);
          }
        }
      }
      this.update(agent, { status: 'working', activity: 'Shipped the slice' });
      this.boardChanged(agent.projectId);
      return [shipped(lines), ...movedNotes].join('\n\n');
    });
  }

  /**
   * Moves each of the lead's repos whose pull request merged (`needsFreshBranch`) onto a new branch from its base, with
   * the commits that hadn't shipped cherry-picked onto it. A repo with uncommitted changes stays put: it can't ship yet.
   */
  private freshBranches(agent: Agent): Effect.Effect<FreshBranch[], GitFailed, Workspace> {
    return Effect.gen({ self: this }, function* () {
      const workspace = yield* Workspace;
      const moved: FreshBranch[] = [];
      for (const r of agent.lead!.repos) {
        const work = agent.lead!;
        const from = repoBranch(r, agent.branch);
        if (!needsFreshBranch(work, r.repo, from)) continue;
        const dir = workspace.dir(leadWorktreeId(agent.id, r.folder));
        if (yield* workspace.hasUncommittedChanges(dir)) continue;
        const commits = yield* workspace.unshippedCommits(dir, r.baseBranch, shippedSha(work, r.repo));
        const to = sliceBranch(work.title, work.slice, newId('s').slice(-4));
        this.print(agent, [{ kind: 'system', text: `✻ ${r.repo}'s pull request from ${from} has merged: starting ${to} from ${r.baseBranch}` }]);
        yield* workspace.freshBranch(dir, to, r.baseBranch);
        this.update(agent, { lead: { ...agent.lead!, repos: agent.lead!.repos.map((x) => (x.repo === r.repo ? { ...x, branch: to } : x)) } });
        const applied = commits.length ? yield* workspace.cherryPick(dir, commits).pipe(Effect.as(true), Effect.orElseSucceed(() => false)) : true;
        if (commits.length) this.print(agent, [{ kind: 'system', text: applied ? `✻ Brought ${commits.length} unshipped commit${commits.length === 1 ? '' : 's'} over to ${to}` : `✻ The unshipped commits didn't apply cleanly to ${to}: they're still on ${from}` }]);
        moved.push({ folder: r.folder, from, to, baseBranch: r.baseBranch, commits, applied });
      }
      return moved;
    });
  }


  /** The lead whose open pull request this is, if any. */
  leadWith(repo: string, number: number): Agent | undefined {
    return [...this.store.agents.values()].find((a) => a.task === 'lead' && a.lead?.prs.some((p) => p.repo === repo && p.number === number && !p.outcome));
  }

  /** QA's verdict on one of the lead's pull requests: a fail wakes the lead to fix it, a couple of times at most. */
  leadHearsVerdict(repo: string, number: number, from: string, report: QaReport, failedRounds: number): void {
    const lead = this.leadWith(repo, number);
    if (!lead) return;
    const text = qaVerdictNote(repo, number, report);
    const step = afterVerdict(report.verdict, failedRounds);
    if (step === 'wake') return this.message(lead.id, text, from);
    // no turn spent on it: the lead hears it with the captain's next message
    this.noteForLead(lead, from, text);
    if (step === 'needs-you') this.hub.toast('error', `🙋 QA failed ${repo.split('/')[1]}#${number} ${failedRounds} times: ${lead.name} needs you to look`, lead.id);
  }

  /**
   * News for a lead that needn't cost them a turn: it waits for the end of the one they're in (an inbox that fills during
   * a turn carries them on into another), then goes with whatever they hear next.
   */
  private noteForLead(lead: Agent, from: string, text: string): void {
    this.print(lead, [{ kind: 'manager', text: `▶ ${from}: ${text}` }]);
    const rt = this.rt(lead.id);
    (rt.busy ? (rt.afterTurn ??= []) : rt.inbox).push(`[${from}] ${text}`);
  }

  /** The lead's pull request was merged or closed. Once the slice's have all landed, the lead hears about it. */
  private leadPrClosed(repo: string, number: number, merged: boolean): boolean {
    const lead = this.leadWith(repo, number);
    if (!lead?.lead) return false;
    const prs = lead.lead.prs.map((p) => (p.repo === repo && p.number === number ? { ...p, outcome: merged ? ('merged' as const) : ('closed' as const) } : p));
    this.update(lead, { lead: { ...lead.lead, prs } });
    this.print(lead, [{ kind: merged ? 'success' : 'system', text: `${merged ? '🎉' : '✻'} ${repo}#${number} was ${merged ? 'merged' : 'closed'}` }]);
    if (sliceLanded(prs)) {
      this.core.ledger.digestSession(lead, prs.map((p) => ({ repo: p.repo, pr: p.number })));
      // a lead in the middle of a turn carries on: their repos only move at the start of the next one
      this.message(lead.id, (this.rt(lead.id).busy ? landedMidTurnNote : landedNote)(lead.lead), 'Office');
    }
    return true;
  }

  /** The leads' pull requests still open, for the office to notice when they're merged or closed on GitHub. */
  leadPrs(projectId: string): { repo: string; number: number }[] {
    return this.store.agentsIn(projectId).flatMap((a) => (a.task === 'lead' ? (a.lead?.prs ?? []).filter((p) => !p.outcome) : []));
  }

  // ---------------------------------------------------------------- manager actions

  /** The captain has read the lead's latest turn: it stops hailing them, on every screen, until their next one ends. */
  readTurn(id: string): void {
    const agent = this.store.agent(id);
    if (!agent.lead || agent.status !== 'done' || agent.finishedAt === undefined || agent.lead.readTurn === agent.finishedAt) return;
    this.update(agent, { lead: { ...agent.lead, readTurn: agent.finishedAt } });
  }

  /** Sends the agent a message: the captain's, or (with `from`) news from someone else aboard. */
  message(id: string, text: string, from?: string): void {
    const agent = this.store.agent(id);
    const rt = this.rt(id);
    text = text.trim();
    if (!text) return;
    this.print(agent, [{ kind: 'manager', text: `▶ ${from ?? 'Captain'}: ${text}` }]);
    // the captain carries on with a goal the lead thought was done
    if (!from && agent.lead?.closing) this.update(agent, { lead: { ...agent.lead, closing: undefined } });
    if (from) text = `[${from}] ${text}`;

    // a QA officer whose PR merged or closed has nothing left to review: their session stays over
    if (agent.task === 'review' && agent.prGone) {
      const reply = goneReply(agent.issue.number, agent.prGone);
      this.print(agent, [{ kind: 'system', text: `✻ ${reply}` }]);
      this.hub.toast('info', `${agent.name}: ${reply}`, agent.id);
      return;
    }

    if (agent.handover) {
      rt.inbox.push(text);
      this.print(agent, [{ kind: 'system', text: `✻ ${agent.name} will read it once their cloud session has started` }]);
      return;
    }
    if (rt.session?.send(text)) {
      if (!rt.permission) this.update(agent, { activity: 'Reading your message' });
      return;
    }
    if (agent.status === 'queued' || rt.busy || agent.status === 'setting-up') {
      rt.inbox.push(text);
      return;
    }
    // Finished, stopped or failed: pick the conversation back up (or start over, with no session to go back to) once
    // there's a free slot, like any agent starting work.
    rt.nudged = false;
    rt.inbox.push(text);
    rt.resume = !!agent.sessionId;
    this.update(agent, { status: 'queued', activity: 'Waiting for a free slot', error: undefined });
    this.schedule();
  }

  resolvePermission(id: string, requestId: string, allow: boolean): void {
    const agent = this.store.agent(id);
    const rt = this.rt(id);
    const pending = rt.permission;
    if (!pending || pending.req.id !== requestId) throw new Refused({ message: 'That request is no longer pending' });
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
    if (agent.handover) {
      void this.core.cloud.stayLocal(id, false).catch(() => undefined);
    } else if (rt.session) {
      rt.session.stop();
    } else if (!FINISHED.includes(agent.status)) {
      this.update(agent, { status: 'stopped', activity: STOPPED_BY_CAPTAIN, finishedAt: Date.now() });
      this.schedule();
    }
  }

  dismiss(id: string): Promise<void> {
    return this.runtime.runPromise(this.goHome(id));
  }

  /** Sends the agent home: their work stops (and with it their Claude Code session) and their checkouts go. */
  private goHome(id: string): Effect.Effect<void, never, Workspace> {
    return Effect.gen({ self: this }, function* () {
      const agent = this.store.agents.get(id);
      if (!agent) return;
      this.core.ledger.digestSession(agent, this.core.ledger.prsOf(agent));
      // out of the office first, so their work, as it's interrupted, finds them gone
      this.core.runtimes.get(id)?.session?.stop();
      this.core.runtimes.delete(id);
      for (const h of agent.helpers ?? []) this.store.dropLines(h.id);
      this.store.removeAgent(id);
      this.hub.send({ type: 'agent-removed', id });
      yield* FiberMap.remove(this.runs, id);
      this.schedule();
      const workspace = yield* Workspace;
      const checkouts = agent.lead ? agent.lead.repos.map((r) => ({ repo: r.repo, id: leadWorktreeId(id, r.folder) })) : [{ repo: agent.repo, id }];
      // whatever a lead wrote since the goal closed (its session only stopped just now) goes on the branch too
      const title = agent.lead?.title;
      yield* Effect.forEach(checkouts, (c) =>
        (title ? Effect.ignore(workspace.snapshot(workspace.dir(c.id), snapshotMessage(title))) : Effect.void).pipe(Effect.andThen(workspace.remove(c.repo, c.id))), { discard: true });
    });
  }

  /** Called when a PR an agent opened was merged or closed. The agent packs up and goes home. `headSha` is the commit that merged, when the office knows it. */
  prClosed(repo: string, number: number, merged: boolean, by: Closer = 'github', headSha?: string): void {
    this.core.ledger.recordLanding(repo, number, merged, by, headSha);
    this.core.reviews.reviewGone(repo, number, merged);
    if (this.leadPrClosed(repo, number, merged)) return;
    const agent = this.prOwner(repo, number);
    if (!agent || this.leaving.has(agent.id)) return;
    this.leaving.add(agent.id);
    this.print(agent, [{ kind: 'success', text: merged ? `🎉 PR #${number} was merged!` : `PR #${number} was closed` }]);
    this.update(agent, { activity: merged ? '🎉 Merged! Packing up' : 'PR closed – packing up' });
    if (merged) this.hub.toast('success', `🎉 Merged ${repo}#${number} – ${agent.name} heads home`, agent.id);
    this.background(Effect.sleep('6 seconds').pipe(
      Effect.andThen(Effect.sync(() => this.leaving.delete(agent.id))),
      Effect.andThen(this.goHome(agent.id)),
    ));
  }

  /** Issues already claimed by an agent who is still in the office. */
  claimed(repo: string): Set<number> {
    return new Set([...this.store.agents.values()].filter((a) => a.repo === repo).map((a) => a.issue.number));
  }

  freeSlots(projectId: string): number {
    const project = this.store.project(projectId);
    const busy = this.store.agentsIn(projectId).filter((a) => !deskless(a) && (a.status === 'queued' || ACTIVE_STATUSES.includes(a.status))).length;
    return Math.max(0, project.maxAgents - busy);
  }
}

