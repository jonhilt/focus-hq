import { Data, Effect, Exit, Fiber, FiberMap, type Layer, ManagedRuntime, PartitionedSemaphore, Scope } from 'effect';
import { helperFor, leadFor, leadId, plannerFor, qaFor, qaOfficerFor, randomAvatar } from '../../shared/crew';
import { autoQaFor, autoSendBackFor, prKey, sameCommit } from '../../shared/qa';
import { afterTriage, triageLabel, type TriageResult, type TriageStep, whenStuck } from '../../shared/triage';
import type { Agent, AgentStatus, BrowserFrame, Effort, FailedCheck, FixFor, PermissionRequest, PullRequest, QaReport, QaReview, QaScreenshot, QueuedGoal, TermLine } from '../../shared/types';
import { ACTIVE_STATUSES, LEAD_DESK, QA_DESK, TEAM_STATIONS } from '../../shared/types';
import type { PullRequestDetail } from '../github/provider';
import { GitHub, type GitHubError } from '../github/service';
import type { Hub } from '../hub';
import type { Store } from '../store';
import { decodeImage, errorMessage, newId, slugify, truncate } from '../util';
import { afterCloudRun, carryOnInNewSession, fallBackToLocal } from './cloud';
import { afterLanding, afterVerdict, carriedNote, applyHelperEvent, applyNote, COMPACT_INSTRUCTIONS, compactInstructions, closeCheck, conflictsNote, fileGoal, freshSessionPrompt, goalBrief, goalEffort, goalOf, goalRecord, goalReviewerId, goalTitle, HELPER_LINGER_MS, heldBack, landedNote, leadPrBody, leadSystemAppend, leadWorktreeId, moveQueued, newSliceNote, nextGoal, type NoteInput, notShipped, openPr, pickStation, qaVerdictNote, reviewsToStart, shipped, shippedSha, shipPlan, sliceBranch, sliceLanded } from './lead';
import { repoFolders } from './planner';
import { carryOnPrompt, COMMIT_NUDGE, conflictsPrompt, issuePrompt, pickName, pullRequestBody, pushNudge, systemAppend } from './prompts';
import { checksFixPrompt, evidencePath, fixPrompt, keptCaptions, MAX_SCREENSHOTS, parseQaReport, QA_SCHEMA, qaComment, qaPrompt, qaSystemAppend } from './qa';
import type { QaLoopEvent } from './qaLoop';
import { qaNextStep } from './qaLoop';
import { offTheFloor, pickDesk } from './desks';
import { deskless, whoStarts } from './schedule';
import { type GitFailed, Sessions, Triage, Workspace } from './services';
import { applyTaskTool } from './tasks';
import { type AgentSession, type RunHooks, type RunOutcome, type RunRequest, STOPPED_BY_CAPTAIN } from './types';
import { triageWorkspaceId } from './worktrees';

/** What the manager's work needs: GitHub, the agents' checkouts, Claude Code sessions and the operations officer. */
export type ManagerServices = GitHub | Workspace | Sessions | Triage;

/** The repository has no commits yet, so there's no branch to work from. */
export class EmptyRepository extends Data.TaggedError('EmptyRepository')<{ repo: string }> {
  override get message() {
    return 'This repository has no commits yet – add a README first so there is a branch to work from.';
  }
}

/** None of a goal's repos has a commit to check out. */
export class NothingToCheckOut extends Data.TaggedError('NothingToCheckOut') {
  override get message() {
    return 'None of the project’s repositories has any commits yet – add a README first';
  }
}

/** A fixer was seated on a PR whose QA report has gone since. */
export class ReportGone extends Data.TaggedError('ReportGone')<{ number: number }> {
  override get message() {
    return `QA's report on PR #${this.number} is gone, so there's nothing to fix`;
  }
}

/** The office won't do what was asked, and says why (a taken station, a busy agent, a goal that isn't one). */
export class Refused extends Data.TaggedError('Refused')<{ message: string }> {}

/** What can stop an agent's work, each with a message for their terminal. */
type WorkError = GitHubError | GitFailed | EmptyRepository | NothingToCheckOut | ReportGone | Refused;

interface Runtime {
  session?: AgentSession;
  /** Messages from the manager that arrived while no session could take them. */
  inbox: string[];
  /** The manager's notes folded into the task when it was handed out, kept in case it has to be told again. */
  notes: string[];
  permission?: { req: PermissionRequest; resolve: (ok: boolean) => void; resume: AgentStatus };
  nudged: boolean;
  busy: boolean;
  /** Queued to pick its conversation back up (the inbox is what it hears), rather than to start its task. */
  resume?: boolean;
  /** The QA officer's instructions for the review in hand (they depend on the PR). */
  qaSystem?: string;
  /** The screenshots the QA officer took on purpose this review: how many, and the last MAX_SCREENSHOTS of them. */
  shots?: { taken: number; frames: BrowserFrame[] };
}

const FINISHED: AgentStatus[] = ['done', 'stopped', 'error'];

/** Each room has one QA officer; their agent record is reused from review to review. */
const qaAgentId = (projectId: string) => `qa_${projectId}`;

/**
 * Hires agents, seats them at desks, runs them, and turns their work into pull requests.
 *
 * Plain methods outside, Effect inside: each agent's work runs as its one fiber (`runs`), so they never run twice at
 * once and sending them home interrupts it (and with it their Claude Code session); timers are `Effect.sleep`s; each
 * room's operations officer looks at one stuck PR at a time (`triageLock`).
 */
export class AgentManager {
  private runtimes = new Map<string, Runtime>();
  private leaving = new Set<string>();
  private readonly runtime: ManagedRuntime.ManagedRuntime<ManagerServices, never>;
  private readonly scope = Scope.makeUnsafe();
  /** Each agent's work in hand, by agent id: their launch, a turn and what follows it, or a compaction. */
  private readonly runs: FiberMap.FiberMap<string, void, never>;
  /** The operations officer's look at a stuck PR, by prKey: stopped when the PR goes or the manager re-tests it. */
  private readonly triageRuns: FiberMap.FiberMap<string, TriageResult, never>;
  /** One triage at a time per room. */
  private readonly triageLock: PartitionedSemaphore.PartitionedSemaphore<string>;

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    services: Layer.Layer<ManagerServices>,
    private readonly boardChanged: (projectId: string) => void,
  ) {
    this.runtime = ManagedRuntime.make(services);
    this.runs = this.runtime.runSync(FiberMap.make<string, void, never>().pipe(Scope.provide(this.scope)));
    this.triageRuns = this.runtime.runSync(FiberMap.make<string, TriageResult, never>().pipe(Scope.provide(this.scope)));
    this.triageLock = this.runtime.runSync(PartitionedSemaphore.make<string>({ permits: 1 }));
  }

  private rt(id: string): Runtime {
    let rt = this.runtimes.get(id);
    if (!rt) {
      rt = { inbox: [], notes: [], nudged: false, busy: false };
      this.runtimes.set(id, rt);
    }
    return rt;
  }

  private update(agent: Agent, patch: Partial<Agent>): void {
    // a helper that's gone on its way takes its transcript with it
    if ('helpers' in patch) for (const h of agent.helpers ?? []) if (!patch.helpers?.some((x) => x.id === h.id)) this.store.dropLines(h.id);
    Object.assign(agent, patch);
    if (!this.store.agents.has(agent.id)) return; // dismissed meanwhile
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
  }

  /** A lead's helper's lines: its own transcript, which goes when it does. */
  private printHelper(agent: Agent, id: string, lines: Omit<TermLine, 't'>[]): void {
    // one we don't know of (Claude Code never said it started) keeps to the lead's own lines
    if (!agent.helpers?.some((h) => h.id === id)) return this.print(agent, lines.map((l) => ({ ...l, text: `    ${l.text}` })));
    if (!lines.length || !this.store.agents.has(agent.id)) return;
    const t = Date.now();
    const stamped = lines.map((l) => ({ t, ...l }));
    this.store.appendLines(id, stamped, false);
    this.hub.send({ type: 'lines', id, lines: stamped });
  }

  private print(agent: Agent, lines: Omit<TermLine, 't'>[]): void {
    if (!lines.length || !this.store.agents.has(agent.id)) return;
    const t = Date.now();
    const stamped = lines.map((l) => ({ t, ...l }));
    this.store.appendLines(agent.id, stamped);
    this.hub.send({ type: 'lines', id: agent.id, lines: stamped });
  }

  /** Something to do in the background, after the current step: a timer, a follow-up, a check. */
  private background(effect: Effect.Effect<void, never, ManagerServices>): void {
    this.runtime.runFork(effect);
  }

  /**
   * Runs `work` as the agent's one fiber. When they're already at work, nothing new starts. When it ends, whoever is
   * queued gets a look in (the agent themselves included, once their fiber has gone).
   */
  private runFor(id: string, work: Effect.Effect<void, never, ManagerServices>): Fiber.Fiber<void> {
    const after = Effect.sync(() => this.background(Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => this.schedule())))));
    return this.runtime.runSync(FiberMap.run(this.runs, id, work.pipe(Effect.ensuring(after)), { onlyIfMissing: true }));
  }

  /** Whatever went wrong in an agent's work: in their terminal, and in a toast. A bug fails them too, rather than leaving them stuck. */
  private orFail(agent: Agent) {
    return (work: Effect.Effect<void, WorkError, ManagerServices>): Effect.Effect<void, never, ManagerServices> =>
      work.pipe(
        Effect.catch((err) => Effect.sync(() => this.fail(agent, err))),
        Effect.catchDefect((defect) => Effect.sync(() => this.fail(agent, errorMessage(defect)))),
      );
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
   * Gets a pull request's merge conflicts resolved. A goal's slice goes back to its lead, whose checkout holds the PR's
   * branch; any other PR to the agent who opened it if they're still in the office; otherwise a new agent sits down on
   * the PR's branch.
   */
  resolveConflicts(projectId: string, pr: PullRequest): Agent {
    const lead = this.leadWith(pr.repo, pr.number);
    if (lead?.lead) {
      const folder = lead.lead.repos.find((r) => r.repo === pr.repo)?.folder ?? pr.repo.split('/')[1];
      this.message(lead.id, conflictsNote(pr.repo, pr.number, pr.baseBranch, folder), 'Office');
      this.hub.toast('info', `🔧 ${pr.repo.split('/')[1]}#${pr.number} conflicts with ${pr.baseBranch} – back to ${lead.name}`, lead.id);
      return lead;
    }
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

  private seat(projectId: string, repo: string, work: Pick<Agent, 'id' | 'task' | 'issue' | 'branch' | 'baseBranch' | 'pr' | 'effort' | 'cloud'>): Agent {
    const project = this.store.project(projectId);
    if (!project.repos.includes(repo)) throw new Refused({ message: `${repo} is not connected to ${project.name}` });
    const existing = [...this.store.agents.values()].find(
      (a) => a.repo === repo && a.issue.number === work.issue.number && !FINISHED.includes(a.status),
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
    this.print(agent, [{ kind: 'system', text: `✻ ${name} joined ${project.name} to work on ${repo}#${work.issue.number} (${work.effort ?? 'default'} effort${work.cloud ? ', in the cloud' : ''})` }]);
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
    if (rt.resume) {
      rt.resume = false;
      this.update(agent, { status: 'setting-up', activity: 'Picking up where they left off' });
      return this.runSession(agent, rt.inbox.splice(0).join('\n\n'), agent.sessionId).pipe(this.orFail(agent));
    }
    this.update(agent, { status: 'setting-up', activity: agent.task === 'review' ? 'Reading the pull request' : 'Reading the issue', error: undefined });
    return Effect.gen({ self: this }, function* () {
      if (agent.task === 'review') return yield* this.launchReview(agent);
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
      yield* workspace.create(agent.repo, agent.id, agent.branch, startPoint, (id) => this.store.agents.has(id));
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
  private taskPrompt(agent: Agent): Effect.Effect<string, GitHubError | ReportGone | Refused, GitHub> {
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
          return this.fixPromptFor(agent, review, review.report, fixes);
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
        const helpers = applyHelperEvent(before, event, Date.now());
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
  private instructions(agent: Agent): Effect.Effect<string, GitHubError, GitHub> {
    if (agent.task === 'review') return this.qaSystem(agent);
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
      outputSchema: agent.task === 'review' ? QA_SCHEMA : undefined,
      cloud: agent.cloud ? { branch: agent.branch } : undefined,
      tools: agent.task === 'lead'
        ? { ship: (input) => tool(this.shipLead(agent, input)), note: (input) => tool(this.noteGoal(agent, input)), proposeClose: (input) => tool(this.proposeClose(agent, input.reason)) }
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

  private runSession(agent: Agent, prompt: string, resumeSessionId?: string): Effect.Effect<void, WorkError, ManagerServices> {
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
        if (!ranInCloud) return yield* this.runSession(agent, withNotes(yield* this.taskPrompt(agent), rt.notes));
        this.update(agent, { activity: `Fetching ${agent.branch} from GitHub` });
        const workspace = yield* Workspace;
        yield* workspace.pull(workspace.dir(agent.id), agent.branch);
        // only a new session gets refused, so this is already a carry-on prompt with the manager's message in it
        return yield* this.runSession(agent, prompt);
      }
      if (agent.cloud && carryOnInNewSession(outcome, !!resumeSessionId)) {
        // everything the old session did is on the branch: a new one picks it up from there
        this.print(agent, [{ kind: 'system', text: `✻ Couldn't get back into the cloud session (${truncate(outcome.error ?? 'no reason given', 200)}) – starting a new one on ${agent.branch}` }]);
        return yield* this.runSession(agent, carryOnPrompt(agent, prompt));
      }
      if (rt.inbox.length) {
        // The manager wrote while the session was wrapping up: carry on in the same conversation.
        return yield* this.runSession(agent, rt.inbox.splice(0).join('\n\n'), agent.sessionId);
      }
      if (!outcome.ok) {
        this.fail(agent, outcome.error ?? 'The agent stopped with an error');
        return;
      }
      if (review) return yield* this.finishReview(agent, outcome.structured, outcome.summary);
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
      const fixing = this.fixing(agent);
      if (fixing?.sha && sameCommit(yield* workspace.head(dir), fixing.sha)) {
        this.update(agent, { status: 'done', activity: 'Finished without fixing anything – see the terminal', finishedAt: Date.now() });
        this.fixEnded(agent, 'pushed-nothing');
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
        this.update(agent, { status: 'pushing', activity: `Pushing ${ahead} commit${ahead === 1 ? '' : 's'}` });
        this.print(agent, [{ kind: 'system', text: `✻ Pushing ${agent.branch}` }]);
        yield* workspace.push(dir, agent.branch);
      }

      let pr = agent.pr ?? (yield* github.findPullRequest(agent.repo, agent.branch));
      if (pr) {
        this.hub.toast('success', `${agent.name} updated PR #${pr.number}`, agent.id);
      } else {
        this.update(agent, { activity: 'Opening the pull request' });
        pr = yield* github.createPullRequest(agent.repo, {
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
    });
  }

  private fail(agent: Agent, err: { message: string } | string): void {
    const message = typeof err === 'string' ? err : err.message;
    this.print(agent, [{ kind: 'error', text: `✘ ${message}` }]);
    this.update(agent, { status: 'error', error: message, activity: 'Hit a problem – send a message to retry', permission: undefined, finishedAt: Date.now() });
    this.hub.toast('error', `${agent.name}: ${truncate(message, 140)}`, agent.id);
    if (agent.task === 'review') this.reviewEnded(agent, message);
    this.fixEnded(agent, 'failed');
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
    this.runtimes.set(id, { inbox: [text.trim()], notes: [], nudged: false, busy: false });
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [
      { kind: 'system', text: `✻ ${crew.name} takes team station ${station + 1} to lead “${title}” across ${project.repos.join(', ')} (${effort} effort)` },
      { kind: 'manager', text: `▶ ${how.from ? `Captain, from ${how.from}` : 'Captain'}: ${text.trim()}` },
    ]);
    this.schedule();
    return { agent };
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
   * Closes a goal: files it in the room's log and sends its lead home, which frees the station. First says what would be
   * lost or left behind (uncommitted changes, open pull requests), unless `force`.
   */
  closeGoal(id: string, force = false): Promise<{ closed: true } | { warn: string[] }> {
    return this.runtime.runPromise(Effect.gen({ self: this }, function* () {
      const agent = this.store.agent(id);
      const work = agent.lead;
      if (agent.task !== 'lead' || !work) return yield* new Refused({ message: `${agent.name} isn’t leading a goal` });
      const workspace = yield* Workspace;
      const dirty = yield* Effect.filter(work.repos, (r) => workspace.hasUncommittedChanges(workspace.dir(leadWorktreeId(id, r.folder))).pipe(Effect.orElseSucceed(() => false)));
      const check = closeCheck(work, dirty.map((r) => r.folder));
      if (check.kind === 'warn' && !force) return { warn: check.reasons };
      const project = this.store.project(agent.projectId);
      project.goals = fileGoal(project.goals ?? [], goalRecord(agent, Date.now()));
      this.projectsChanged();
      yield* this.goHome(id);
      // the goal's reviewer goes home with its lead; a review they were on, or still waiting, goes to the room's QA officer
      const reviewer = goalReviewerId(id);
      for (const r of this.store.reviews.values()) {
        if (r.agentId === reviewer && (r.status === 'testing' || r.status === 'queued')) this.putReview({ ...r, status: 'queued', agentId: undefined });
      }
      yield* this.goHome(reviewer);
      this.nextReview(agent.projectId);
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
      this.update(agent, { branch: sliceBranch(lead.title, slice, newId('s').slice(-4)), lead: { ...lead, note, repos: [], slice, prs: [] } });
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
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const states = yield* Effect.forEach(
        work.repos,
        (r) =>
          Effect.gen(function* () {
            const dir = workspace.dir(leadWorktreeId(agent.id, r.folder));
            const head = yield* workspace.head(dir);
            const changed = !openPr(work, r.repo)?.sha || !sameCommit(head, openPr(work, r.repo)!.sha!);
            return { ...r, dir, head, changed, dirty: yield* workspace.hasUncommittedChanges(dir), ahead: yield* workspace.commitsAhead(dir, r.baseBranch) };
          }),
        { concurrency: 'unbounded' },
      );
      const plan = shipPlan(states);
      if (plan.kind !== 'ship') return notShipped(plan);
      const project = this.store.project(agent.projectId);
      const title = input.title.trim() || `Slice ${work.slice}`;
      const lines: string[] = [];
      for (const s of states.filter((x) => plan.repos.includes(x.repo))) {
        this.update(agent, { status: 'pushing', activity: `Shipping ${s.repo}` });
        this.print(agent, [{ kind: 'system', text: `✻ Pushing ${agent.branch} in ${s.repo}` }]);
        yield* workspace.push(s.dir, agent.branch);
        const found = openPr(work, s.repo) ?? (yield* github.findPullRequest(s.repo, agent.branch));
        let pr: { number: number; url: string };
        if (found) {
          pr = found;
          lines.push(`Updated ${s.repo}#${pr.number}: ${pr.url}`);
        } else {
          const alongside = plan.repos.filter((r) => r !== s.repo);
          const body = leadPrBody(input.summary, agent, alongside, this.store.settings.attribution);
          pr = yield* github.createPullRequest(s.repo, { head: agent.branch, base: s.baseBranch, title, body });
          lines.push(`Opened ${s.repo}#${pr.number}: ${pr.url}`);
          this.hub.toast('success', `🎉 ${agent.name} opened ${s.repo.split('/')[1]}#${pr.number}: ${title}`, agent.id);
        }
        const others = agent.lead!.prs.filter((p) => !(p.repo === s.repo && p.number === pr.number));
        this.update(agent, { lead: { ...agent.lead!, prs: [...others, { repo: s.repo, number: pr.number, url: pr.url, sha: s.head }] } });
        this.print(agent, [{ kind: 'success', text: `✔ ${lines.at(-1)}` }]);
        if (autoQaFor(project)) {
          try {
            this.requestReview(agent.projectId, s.repo, pr.number, title);
          } catch (err) {
            this.print(agent, [{ kind: 'error', text: `✘ Couldn't hand ${s.repo}#${pr.number} to QA: ${errorMessage(err)}` }]);
          }
        }
      }
      this.update(agent, { status: 'working', activity: 'Shipped the slice' });
      this.boardChanged(agent.projectId);
      return shipped(lines);
    });
  }

  /** The lead whose open pull request this is, if any. */
  private leadWith(repo: string, number: number): Agent | undefined {
    return [...this.store.agents.values()].find((a) => a.task === 'lead' && a.lead?.prs.some((p) => p.repo === repo && p.number === number && !p.outcome));
  }

  /** QA's verdict on one of the lead's pull requests: a fail wakes the lead to fix it, a couple of times at most. */
  private leadHearsVerdict(repo: string, number: number, from: string, report: QaReport, failedRounds: number): void {
    const lead = this.leadWith(repo, number);
    if (!lead) return;
    const text = qaVerdictNote(repo, number, report);
    const step = afterVerdict(report.verdict, failedRounds);
    if (step === 'wake') return this.message(lead.id, text, from);
    // no turn spent on it: the lead hears it with the captain's next message
    this.print(lead, [{ kind: 'manager', text: `▶ ${from}: ${text}` }]);
    this.rt(lead.id).inbox.push(`[${from}] ${text}`);
    if (step === 'needs-you') this.hub.toast('error', `🙋 QA failed ${repo.split('/')[1]}#${number} ${failedRounds} times: ${lead.name} needs you to look`, lead.id);
  }

  /** The lead's pull request was merged or closed. Once the slice's have all landed, the lead hears about it. */
  private leadPrClosed(repo: string, number: number, merged: boolean): boolean {
    const lead = this.leadWith(repo, number);
    if (!lead?.lead) return false;
    const prs = lead.lead.prs.map((p) => (p.repo === repo && p.number === number ? { ...p, outcome: merged ? ('merged' as const) : ('closed' as const) } : p));
    this.update(lead, { lead: { ...lead.lead, prs } });
    this.print(lead, [{ kind: merged ? 'success' : 'system', text: `${merged ? '🎉' : '✻'} ${repo}#${number} was ${merged ? 'merged' : 'closed'}` }]);
    if (sliceLanded(prs)) this.message(lead.id, landedNote(lead.lead), 'Office');
    return true;
  }

  /** The leads' pull requests still open, for the office to notice when they're merged or closed on GitHub. */
  leadPrs(projectId: string): { repo: string; number: number }[] {
    return this.store.agentsIn(projectId).flatMap((a) => (a.task === 'lead' ? (a.lead?.prs ?? []).filter((p) => !p.outcome) : []));
  }

  // ---------------------------------------------------------------- QA

  /** Asks the room's QA officer to review and test a pull request. Queued if they're busy with another. */
  /** `retryNote` tells QA why the operations officer sent it back to them. */
  requestReview(projectId: string, repo: string, number: number, title: string, retryNote?: string): QaReview {
    const project = this.store.project(projectId);
    if (!project.repos.includes(repo)) throw new Refused({ message: `${repo} is not connected to ${project.name}` });
    const existing = this.store.reviews.get(prKey(repo, number));
    if (existing && (existing.status === 'queued' || existing.status === 'testing')) return existing;
    // a re-test from the board overrides the operations officer
    this.stopTriage(prKey(repo, number));
    const review: QaReview = {
      projectId,
      repo,
      number,
      title,
      status: 'queued',
      requestedAt: Date.now(),
      openedByOffice: this.openedByOffice(repo, number),
      failedRounds: existing?.failedRounds,
      lastRound: existing?.report ? { sha: existing.sha, report: existing.report } : existing?.lastRound,
      triages: existing?.triages,
      triage: existing?.triage,
      retryNote,
    };
    this.putReview(review);
    this.nextReview(projectId);
    return review;
  }

  /**
   * Seats reviewers on queued reviews, oldest first, as they come free: a goal's pull requests go to the goal's own
   * reviewer, at its lead's table, and everyone else's to the room's QA officer, so the room's goals are reviewed side by
   * side.
   */
  private nextReview(projectId: string): void {
    const leads = this.store.agentsIn(projectId).filter((a) => a.task === 'lead');
    const queued = [...this.store.reviews.values()].filter((r) => r.projectId === projectId && r.status === 'queued');
    const reviewerOf = (r: QaReview) => {
      const goal = goalOf(r, leads);
      return goal ? goalReviewerId(goal.id) : qaAgentId(projectId);
    };
    const busy = (id: string) => {
      const reviewer = this.store.agents.get(id);
      return !!reviewer && !FINISHED.includes(reviewer.status);
    };
    for (const { review, reviewer } of reviewsToStart(queued, reviewerOf, busy)) this.seatReviewer(projectId, reviewer, review, goalOf(review, leads));
    this.schedule();
  }

  /** Puts the room's QA officer, or `goal`'s own reviewer, on `review`: the same person every time. */
  private seatReviewer(projectId: string, id: string, review: QaReview, goal: Agent | undefined): void {
    const project = this.store.project(projectId);
    const current = this.store.agents.get(id);
    const others = this.store.agentsIn(projectId).filter((a) => a.id !== id && (a.task === 'lead' || a.reviewFor)).map((a) => a.name);
    const crew = current ?? (goal ? qaFor(projectId, goal.id, others) : qaOfficerFor(projectId));
    const url = `https://github.com/${review.repo}/pull/${review.number}`;
    const agent: Agent = {
      id,
      name: crew.name,
      avatar: crew.avatar,
      projectId,
      repo: review.repo,
      task: 'review',
      reviewFor: goal?.id,
      // GitHub numbers pull requests and issues alike; a QA officer's "issue" is the PR under test
      issue: { number: review.number, title: review.title, url },
      effort: project.qaEffort,
      desk: QA_DESK,
      status: 'queued',
      activity: 'Waiting for a free slot',
      branch: `qa/pr-${review.number}`,
      baseBranch: current?.baseBranch ?? 'main',
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.runtimes.set(id, { inbox: [], notes: [], nudged: false, busy: false });
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    const where = goal ? ` at ${goal.name}'s table, for “${goal.lead?.title ?? 'their goal'}”` : '';
    this.print(agent, [{ kind: 'system', text: `──────── ✻ ${crew.name} picks up ${review.repo}#${review.number} for QA${where}: ${review.title}` }]);
    this.putReview({ ...review, agentId: id });
  }

  private launchReview(agent: Agent): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const project = this.store.project(agent.projectId);
      const pr = yield* github.getPullRequest(agent.repo, agent.issue.number);
      const linked = yield* Effect.forEach(pr.linkedIssues.slice(0, 3), (n) => github.getIssue(agent.repo, n).pipe(Effect.orElseSucceed(() => null)), { concurrency: 'unbounded' });
      const issues = linked.filter((i) => i !== null);
      this.update(agent, { baseBranch: pr.baseBranch, issue: { number: pr.number, title: pr.title, url: pr.url }, activity: 'Checking out the pull request' });
      this.print(agent, [{ kind: 'system', text: `✻ Checking out PR #${pr.number} (${pr.branch} into ${pr.baseBranch})` }]);
      const sha = (yield* workspace.checkoutPullRequest(agent.repo, agent.id, pr.number)) || pr.headSha;
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      const review = this.store.reviews.get(prKey(agent.repo, pr.number));
      if (review) this.putReview({ ...review, status: 'testing', title: pr.title, sha, agentId: agent.id, error: undefined });
      rt.qaSystem = qaSystemAppend(agent, project, pr, sha);
      rt.shots = undefined;
      let prompt = qaPrompt(agent.repo, pr, issues, review ?? {});
      if (rt.inbox.length) prompt += `\n\nNotes from your manager:\n${rt.inbox.splice(0).map((m) => `- ${m}`).join('\n')}`;
      yield* this.runSession(agent, prompt);
    });
  }

  /** The QA officer's instructions; rebuilt from GitHub if the office restarted since the review began. */
  private qaSystem(agent: Agent): Effect.Effect<string, GitHubError, GitHub> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      if (!rt.qaSystem) {
        const pr = yield* (yield* GitHub).getPullRequest(agent.repo, agent.issue.number);
        const sha = this.store.reviews.get(prKey(agent.repo, agent.issue.number))?.sha ?? pr.headSha;
        rt.qaSystem = qaSystemAppend(agent, this.store.project(agent.projectId), pr, sha);
      }
      return rt.qaSystem;
    });
  }

  /** Records the QA officer's verdict, posts it on the pull request, and moves on to the next review. */
  private finishReview(agent: Agent, structured: unknown, text: string): Effect.Effect<void, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const number = agent.issue.number;
      const report = parseQaReport(structured, text);
      if (!report) {
        this.fail(agent, 'Finished without a QA report. Send them a message to ask for one, or send the PR to QA again.');
        return;
      }
      const pass = report.verdict === 'pass';
      const review = this.store.reviews.get(prKey(agent.repo, number));
      const screenshots = yield* this.keepScreenshots(agent, report, review?.sha);
      this.update(agent, { activity: 'Posting the QA report on the PR' });
      const body = qaComment(report, { officer: agent.name, sha: review?.sha }, screenshots, this.store.settings.attribution);
      const commentUrl = yield* (yield* GitHub).commentOnPullRequest(agent.repo, number, body).pipe(
        Effect.tap((url) => Effect.sync(() => this.print(agent, [{ kind: 'system', text: `✻ Posted the QA report: ${url || 'done'}` }]))),
        Effect.map((url) => url || undefined),
        Effect.catch((err) => Effect.sync(() => {
          this.print(agent, [{ kind: 'error', text: `✘ Couldn't post the QA report on the PR: ${err.message}` }]);
          return undefined;
        })),
      );
      const failedRounds = (review?.failedRounds ?? 0) + (pass ? 0 : 1);
      const done: QaReview | undefined = review && { ...review, status: pass ? 'passed' : 'failed', report, screenshots, commentUrl, failedRounds, finishedAt: Date.now(), error: undefined };
      if (done) this.putReview(done);
      this.print(agent, [{ kind: pass ? 'success' : 'error', text: `${pass ? '✅ QA passed' : '❌ QA failed'} PR #${number} · ${report.checks.length} checks` }]);
      this.update(agent, { status: 'done', activity: `${pass ? '✅ Passed' : '❌ Failed'} PR #${number}`, finishedAt: Date.now() });
      this.hub.toast(pass ? 'success' : 'error', `${pass ? '✅' : '❌'} ${agent.name} ${pass ? 'passed' : 'failed'} ${agent.repo.split('/')[1]}#${number}: ${truncate(report.summary, 120)}`, agent.id);
      this.boardChanged(agent.projectId);
      if (done) yield* this.qaNext(done, { kind: 'verdict', verdict: report.verdict, failedRounds });
      this.leadHearsVerdict(agent.repo, number, `QA officer ${agent.name}`, report, failedRounds);
      this.nextReview(agent.projectId);
    });
  }

  /**
   * Keeps the QA officer's screenshots for the station and uploads them to the repo's QA evidence branch. One that
   * fails to upload stays out of the PR comment, and the error goes to their terminal.
   */
  private keepScreenshots(agent: Agent, report: QaReport, sha: string | undefined): Effect.Effect<QaScreenshot[], never, GitHub> {
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
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
        shot.url = yield* github.uploadQaEvidence(agent.repo, evidencePath(agent.issue.number, sha, at, i, image.ext), image.bytes).pipe(
          Effect.catch((err) => Effect.sync(() => {
            this.print(agent, [{ kind: 'error', text: `✘ Couldn't upload screenshot ${i + 1} ("${truncate(shot.caption, 60)}"): ${err.message}` }]);
            return undefined;
          })),
        );
        screenshots.push(shot);
      }
      const uploaded = screenshots.filter((s) => s.url).length;
      if (uploaded) this.print(agent, [{ kind: 'system', text: `✻ Uploaded ${uploaded} screenshot${uploaded === 1 ? '' : 's'} to the QA evidence branch` }]);
      return screenshots;
    });
  }

  // ---------------------------------------------------------------- sending failed PRs back

  /** Acts on what qaNextStep decides for a PR after a verdict or a fix. */
  private qaNext(review: QaReview, event: QaLoopEvent): Effect.Effect<void, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const project = this.store.projects.find((p) => p.id === review.projectId);
      if (!project) return;
      const step = qaNextStep({ openedByOffice: !!review.openedByOffice, autoSendBack: autoSendBackFor(project) }, event);
      switch (step.kind) {
        case 'nothing':
          if (review.followUp) this.putReview({ ...review, followUp: undefined });
          return;
        case 'send-back':
          return yield* this.sendBack(review, { kind: 'qa' });
        case 'needs-you':
          return this.stuck(review, step.reason);
      }
    });
  }

  /** A passed PR whose checks on GitHub keep failing goes back to be fixed, like one QA failed. */
  sendBackChecks(repo: string, number: number, checks: FailedCheck[]): Promise<void> {
    const review = this.store.reviews.get(prKey(repo, number));
    if (!review) throw new Refused({ message: `QA hasn't reviewed ${repo}#${number}` });
    return this.runtime.runPromise(this.sendBack(review, { kind: 'checks', checks }));
  }

  /**
   * Hands QA's findings, or the failing checks, to the developer who opened the PR, if they're still in the office;
   * otherwise a new agent sits down on the PR's branch to fix it.
   */
  /** `note` is the operations officer's advice, when they're the one sending it back. */
  private sendBack(review: QaReview, fixes: FixFor, note?: string): Effect.Effect<void, never, GitHub> {
    return Effect.gen({ self: this }, function* () {
      const { report } = review;
      if (!report) return;
      const where = `${review.repo.split('/')[1]}#${review.number}`;
      const why = fixes.kind === 'qa' ? 'failed QA' : 'keeps failing its checks';
      const advice = note && `${plannerFor(review.projectId).name}, the operations officer, looked at why this PR is stuck: ${note}`;
      const owner = this.prOwner(review.repo, review.number);
      if (owner) {
        this.putReview({ ...review, followUp: { kind: 'fixing', agentId: owner.id, agentName: owner.name, fixes } });
        const prompt = this.fixPromptFor(owner, review, report, fixes);
        this.message(owner.id, advice ? `${prompt}\n\n${advice}` : prompt);
        this.hub.toast('info', `🔧 ${where} ${why} – back to ${owner.name}`, owner.id);
        return;
      }
      const pr = yield* (yield* GitHub).getPullRequest(review.repo, review.number);
      const agent = this.seat(review.projectId, review.repo, {
        id: newId('agent'),
        task: 'fix',
        issue: { number: pr.number, title: pr.title, url: pr.url },
        branch: pr.branch,
        baseBranch: pr.baseBranch,
        pr: { number: pr.number, url: pr.url },
      });
      if (advice) this.rt(agent.id).inbox.push(advice);
      this.putReview({ ...review, followUp: { kind: 'fixing', agentId: agent.id, agentName: agent.name, fixes } });
      this.hub.toast('info', `🔧 ${where} ${why} – ${agent.name} sits down to fix it`, agent.id);
    }).pipe(
      // a full room throws from seat(): it's the manager's call then, like any other failure to send it back
      Effect.catchDefect((defect) => Effect.sync(() => this.needsYou(review, `it couldn't be sent back (${errorMessage(defect)})`))),
      Effect.catch((err) => Effect.sync(() => this.needsYou(review, `it couldn't be sent back (${err.message})`))),
    );
  }

  private fixPromptFor(agent: Agent, review: QaReview, report: QaReport, fixes: FixFor): string {
    const pr = { number: review.number, branch: agent.branch };
    switch (fixes.kind) {
      case 'qa':
        return fixPrompt(pr, { sha: review.sha, report }, agent.cloud);
      case 'checks':
        return checksFixPrompt(pr, review.sha, fixes.checks, agent.cloud);
    }
  }

  // ---------------------------------------------------------------- triaging stuck PRs

  /** The PR is stuck: the room's operations officer looks at it first, unless they've had their tries. */
  private stuck(review: QaReview, reason: string): void {
    const officer = plannerFor(review.projectId).name;
    const step = whenStuck(review, officer, reason);
    if (step.kind === 'needs-you') return this.needsYou(review, step.reason);
    const triaging: QaReview = { ...review, triages: (review.triages ?? 0) + 1, followUp: { kind: 'triaging', officer, activity: 'Coming over to look' } };
    this.putReview(triaging);
    // one at a time per room, in the order they got stuck
    this.background(this.triageLock.withPermit(review.projectId)(this.triage(triaging, reason)));
  }

  /** Stops the operations officer looking at the PR, if they are: the manager stepped in, or the PR went. */
  private stopTriage(key: string): void {
    if (FiberMap.hasUnsafe(this.triageRuns, key)) this.runtime.runFork(FiberMap.remove(this.triageRuns, key));
  }

  /** The operations officer reads QA's reports, the checks, the diff and the issue, then does one thing about it. */
  private triage(review: QaReview, reason: string): Effect.Effect<void, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const officer = plannerFor(review.projectId);
      const key = prKey(review.repo, review.number);
      // the manager may have stepped in meanwhile (a re-test, a merge), and then it's not the officer's any more
      const current = () => {
        const now = this.store.reviews.get(key);
        return now?.followUp?.kind === 'triaging' ? now : undefined;
      };
      const activity = (text: string) => {
        const now = current();
        if (now && text) this.putReview({ ...now, followUp: { kind: 'triaging', officer: officer.name, activity: truncate(text, 120) } });
      };
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const triager = yield* Triage;
      let pr: PullRequestDetail | undefined;
      // the look itself, which a re-test or the PR going stops (stopTriage)
      const look: Effect.Effect<TriageResult, never> = Effect.gen({ self: this }, function* () {
        const project = this.store.project(review.projectId);
        activity('Reading the pull request');
        pr = yield* github.getPullRequest(review.repo, review.number);
        const checks = this.failingChecks(review);
        const [diff, linked] = yield* Effect.all([
          github.pullRequestDiff(review.repo, review.number).pipe(Effect.catch((err) => Effect.succeed(`(couldn't get the diff: ${err.message})`))),
          Effect.forEach(pr.linkedIssues.slice(0, 3), (n) => github.getIssue(review.repo, n).pipe(Effect.orElseSucceed(() => null)), { concurrency: 'unbounded' }),
        ], { concurrency: 'unbounded' });
        activity('Checking out the pull request');
        const id = triageWorkspaceId(review.projectId);
        yield* workspace.checkoutPullRequest(review.repo, id, review.number);
        if (!current()) return { error: 'The manager stepped in' };
        const decision = yield* triager.triage(
          {
            projectId: project.id,
            projectName: project.name,
            officer,
            repo: review.repo,
            pr,
            cwd: workspace.dir(id),
            reason,
            review,
            checks,
            diff,
            issues: linked.filter((i) => i !== null),
            settings: this.store.settings,
          },
          activity,
        );
        return { decision };
      }).pipe(
        Effect.catch((err) => Effect.succeed<TriageResult>({ error: err.message })),
        Effect.catchDefect((defect) => Effect.succeed<TriageResult>({ error: errorMessage(defect) })),
      );
      const exit = yield* Fiber.await(yield* FiberMap.run(this.triageRuns, key, look));
      const now = current();
      if (!now || !Exit.isSuccess(exit)) return;
      const result = exit.value;
      const decided = 'decision' in result ? { ...now, triage: { officer: officer.name, ...result.decision, at: Date.now() } } : now;
      yield* this.afterTriage(decided, afterTriage(officer.name, result, { closes: pr?.linkedIssues ?? [] }));
    });
  }

  /** Does what the operations officer decided. `review.triage` is their decision, if they came to one. */
  private afterTriage(review: QaReview, step: TriageStep): Effect.Effect<void, never, ManagerServices> {
    if (step.kind === 'needs-you') return Effect.sync(() => this.needsYou(review, step.reason));
    const officer = plannerFor(review.projectId).name;
    const where = `${review.repo.split('/')[1]}#${review.number}`;
    const backToQa = (why: string) => {
      this.putReview({ ...review, followUp: undefined });
      this.requestReview(review.projectId, review.repo, review.number, review.title, `${officer}, the room's operations officer, ${why} because it was stuck: ${step.note}`);
    };
    return Effect.gen({ self: this }, function* () {
      switch (step.kind) {
        case 'retry-qa':
          backToQa('sent it back to you');
          break;
        case 'send-back':
          yield* this.sendBack(review, { kind: 'qa' }, step.note);
          break;
        case 'rerun-checks': {
          const runIds = [...new Set(this.failingChecks(review).flatMap((c) => (c.runId ? [c.runId] : [])))];
          yield* (yield* GitHub).rerunFailedRuns(review.repo, runIds);
          const runs = runIds.length;
          backToQa(`re-ran ${runs} failed GitHub Actions run${runs === 1 ? '' : 's'} and sent it back to you`);
          break;
        }
        case 'close':
          yield* this.closeStuck(review, step.note);
          break;
      }
      this.hub.toast('info', `${triageLabel({ officer, action: step.kind })} (${where}): ${truncate(step.note, 120)}`, undefined, review.projectId);
    }).pipe(
      Effect.catch((err) => Effect.sync(() => this.needsYou(review, `${officer} chose ${step.kind} but it failed (${err.message})`))),
      Effect.catchDefect((defect) => Effect.sync(() => this.needsYou(review, `${officer} chose ${step.kind} but it failed (${errorMessage(defect)})`))),
    );
  }

  /** The PR's failing checks, as of the board's last look at GitHub: fresh enough for which checks are red. */
  private failingChecks(review: QaReview): FailedCheck[] {
    return this.store.boards.get(review.projectId)?.prs.find((p) => p.repo === review.repo && p.number === review.number)?.failedChecks ?? [];
  }

  /** Closes a PR whose approach can't work. Its issues stay open, marked on the board, for a fresh attempt. */
  private closeStuck(review: QaReview, note: string): Effect.Effect<void, GitHubError, GitHub> {
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const officer = plannerFor(review.projectId).name;
      const pr = yield* github.getPullRequest(review.repo, review.number);
      const comment = `🧭 ${officer}, the Focus office's operations officer, closed this pull request: ${note}\n\n${pr.linkedIssues.map((n) => `#${n}`).join(', ')} stays open, so it gets built again.`;
      yield* github.closePullRequest(review.repo, review.number, comment);
      for (const issue of pr.linkedIssues) this.store.putClosedPr({ repo: review.repo, issue, pr: review.number, officer, note, at: Date.now() });
      this.prClosed(review.repo, review.number, false);
      this.boardChanged(review.projectId);
    });
  }

  /** The office stops sending the PR back: it's the manager's call now. */
  private needsYou(review: QaReview, reason: string): void {
    this.putReview({ ...review, followUp: { kind: 'needs-you', reason } });
    this.hub.toast('error', `🙋 ${review.repo.split('/')[1]}#${review.number} needs you: ${reason}`, undefined, review.projectId);
  }

  /** The failed review this agent was sent to fix, while it's still theirs. */
  private fixing(agent: Agent): QaReview | undefined {
    if (!agent.pr) return undefined;
    const review = this.store.reviews.get(prKey(agent.repo, agent.pr.number));
    return review?.followUp?.kind === 'fixing' && review.followUp.agentId === agent.id ? review : undefined;
  }

  private fixEnded(agent: Agent, outcome: Extract<QaLoopEvent, { kind: 'fix-ended' }>['outcome']): void {
    const review = this.fixing(agent);
    if (review) this.background(this.qaNext(review, { kind: 'fix-ended', by: agent.name, outcome }));
  }

  /** A review that ended without a verdict (stopped, failed, or its PR went away). */
  private reviewEnded(agent: Agent, error: string): void {
    const review = this.store.reviews.get(prKey(agent.repo, agent.issue.number));
    if (review && (review.status === 'testing' || review.status === 'queued')) this.putReview({ ...review, status: 'error', error, finishedAt: Date.now() });
    // don't start the next review under the captain's nose when they stopped this one on purpose; otherwise once this
    // one's wound down
    if (error !== STOPPED_BY_CAPTAIN) this.background(Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => this.nextReview(agent.projectId)))));
  }

  /** The PR is merged or closed: forget its review, and stop the QA officer if they're on it. */
  reviewGone(repo: string, number: number): void {
    const review = this.store.reviews.get(prKey(repo, number));
    if (!review) return;
    this.stopTriage(prKey(repo, number));
    this.store.removeReview(repo, number);
    this.hub.send({ type: 'review-removed', repo, number });
    const qa = review.agentId ? this.store.agents.get(review.agentId) : undefined;
    if (qa && qa.repo === repo && qa.issue.number === number && !FINISHED.includes(qa.status)) this.stop(qa.id);
    this.nextReview(review.projectId);
  }

  private putReview(review: QaReview): void {
    this.store.putReview(review);
    this.hub.send({ type: 'review', review });
  }

  // ---------------------------------------------------------------- manager actions

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
    if (rt.session) {
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
      // out of the office first, so their work, as it's interrupted, finds them gone
      this.runtimes.get(id)?.session?.stop();
      this.runtimes.delete(id);
      for (const h of agent.helpers ?? []) this.store.dropLines(h.id);
      this.store.removeAgent(id);
      this.hub.send({ type: 'agent-removed', id });
      yield* FiberMap.remove(this.runs, id);
      this.schedule();
      const workspace = yield* Workspace;
      const checkouts = agent.lead ? agent.lead.repos.map((r) => ({ repo: r.repo, id: leadWorktreeId(id, r.folder) })) : [{ repo: agent.repo, id }];
      yield* Effect.forEach(checkouts, (c) => workspace.remove(c.repo, c.id), { discard: true });
    });
  }

  /** Called when a PR an agent opened was merged or closed. The agent packs up and goes home. */
  prClosed(repo: string, number: number, merged: boolean): void {
    this.reviewGone(repo, number);
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

function withNotes(prompt: string, notes: string[]): string {
  return notes.length ? `${prompt}\n\nNotes from your manager:\n${notes.map((m) => `- ${m}`).join('\n')}` : prompt;
}
