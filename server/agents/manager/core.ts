import { Data, Effect, type Fiber, FiberMap, type Layer, ManagedRuntime, Scope } from 'effect';
import type { Agent, AgentStatus, BrowserFrame, CloudHandover, PermissionRequest, TermLine } from '../../../shared/types';
import type { GitHub, GitHubError } from '../../github/service';
import type { Hub } from '../../hub';
import { Plugins } from '../../plugins/registry';
import type { Store } from '../../store';
import { errorMessage } from '../../util';
import { type GitFailed, type QaChat, type Recordings, type Renderer, retryServerErrors, SHIP_RETRIES, type Sessions, type Triage, Workspace } from '../services';
import { Inbox } from '../inbox';
import type { RunFact } from '../runJournal';
import type { AgentSession } from '../types';
import type { CloudMoves } from './cloudMoves';
import type { Comms } from './comms';
import type { Conflicts } from './conflicts';
import type { Delivery } from './delivery';
import type { GoalTools } from './goalTools';
import type { Leads } from './leads';
import type { Ledger } from './ledger';
import type { Merges } from './merges';
import type { PlanLimit } from './planLimit';
import type { Reviews } from './reviews';
import type { Seating } from './seating';
import type { AgentSessions } from './sessions';
import type { Checkouts } from './checkouts';
import type { GoalPrs } from './goalPrs';
import type { Triages } from './triages';

/** What the manager's work needs: GitHub, the agents' checkouts, Claude Code sessions and the operations officer. */
export type ManagerServices = GitHub | Workspace | Sessions | Triage | Renderer | Recordings | QaChat;

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

/** Ops won't do what was asked, and says why (a taken station, a busy agent, a goal that isn't one). */
export class Refused extends Data.TaggedError('Refused')<{ message: string }> {}

/** What can stop an agent's work, each with a message for their terminal. */
export type WorkError = GitHubError | GitFailed | EmptyRepository | NothingToCheckOut | ReportGone | Refused;

export interface Runtime {
  session?: AgentSession;
  /** The turn `session` is in, as their run journal knows it. */
  turn?: string;
  /** Messages from the manager that arrived while no session could take them, and a lead's notes that wait for the end of their turn: kept in their run journal. */
  inbox: Inbox;
  /** Where each of a lead's workflows (by task id) has Claude Code write its agents' transcripts. */
  workflowTranscripts?: Map<string, string>;
  /** Each of a lead's workflows' script (by task id): its source, when the call carried it, and where Claude Code saved it. */
  workflowScripts?: Map<string, { source?: string; path?: string }>;
  /** Where each of a lead's background commands and monitors (by task id) writes its output. */
  backgroundOutputs?: Map<string, string>;
  /** The manager's notes folded into the task when it was handed out, kept in case it has to be told again. */
  notes: string[];
  permission?: { req: PermissionRequest; resolve: (ok: boolean) => void; resume: AgentStatus };
  /** The lead's question (by its id) their session waits on the answer to, asked with Claude Code's AskUserQuestion. */
  asking?: { questionId: string; resolve: (answer: string | undefined) => void };
  nudged: boolean;
  busy: boolean;
  /** A goal's lead's QA fail, noted mid-turn: the note, and the captain's toast if the turn ends with it unheard. */
  failNoted?: { note: string; toast: string };
  /** The conversation Ops couldn't compact before a lead's turn: it doesn't try again in that one. */
  compactFailed?: string;
  /** Queued to pick its conversation back up (the inbox is what it hears), rather than to start its task. */
  resume?: boolean;
  /** The QA officer's instructions for the review in hand (they depend on the PR). */
  qaSystem?: string;
  /** The files the review in hand's pull request changes, which its report accounts for, and whether QA has been sent back once for leaving some out. */
  qaFiles?: { changed: string[]; askedAgain: boolean; sentBack?: number };
  /** The screenshots the QA officer took on purpose this review: how many, and the last MAX_SCREENSHOTS of them. */
  shots?: { taken: number; frames: BrowserFrame[] };
  /** Attaching to a cloud session the captain started: how often it was still busy, and the hand-over to go back to if it fails. */
  attaching?: { tries: number; handover: CloudHandover };
}

/** The statuses that are a phase of the run's own, as the fact its journal records. */
const PHASE_FACTS: Partial<Record<AgentStatus, RunFact>> = { queued: { kind: 'waiting' }, 'setting-up': { kind: 'setting-up' } };

export function withNotes(prompt: string, notes: string[]): string {
  return notes.length ? `${prompt}\n\nNotes from your manager:\n${notes.map((m) => `- ${m}`).join('\n')}` : prompt;
}

/**
 * What the manager's parts share: the store and hub, the one runtime and each agent's fiber (`runs`), each agent's
 * runtime state, and the parts themselves, so each concern reaches another through it (`core.reviews.requestReview`).
 */
export class Core {
  readonly runtimes = new Map<string, Runtime>();
  /** Focus is shutting down: turns it stops are left open in their journals, to carry on when it starts again. */
  closing = false;
  readonly runtime: ManagedRuntime.ManagedRuntime<ManagerServices, never>;
  readonly scope = Scope.makeUnsafe();
  /** Each agent's work in hand, by agent id: their launch, a turn and what follows it, or a compaction. */
  readonly runs: FiberMap.FiberMap<string, void, never>;
  seating!: Seating;
  sessions!: AgentSessions;
  delivery!: Delivery;
  conflicts!: Conflicts;
  leads!: Leads;
  checkouts!: Checkouts;
  goalPrs!: GoalPrs;
  goalTools!: GoalTools;
  comms!: Comms;
  reviews!: Reviews;
  triages!: Triages;
  cloud!: CloudMoves;
  ledger!: Ledger;
  merges!: Merges;
  planLimit!: PlanLimit;
  /** The plugins switched on (docs/plugins.md): the parts reach them only through here. */
  readonly plugins: Plugins;

  constructor(
    readonly store: Store,
    readonly hub: Hub,
    services: Layer.Layer<ManagerServices>,
    readonly boardChanged: (projectId: string) => void,
    /** The commit this Focus is running (`currentVersion`), for what the crew's results are stamped with. */
    readonly version = 'unknown',
  ) {
    this.plugins = new Plugins(() => store.plugins);
    store.journaled = (agent) => this.hub.send({ type: 'agent', agent });
    store.stepped = (machine, key) => this.plugins.machineStepped(machine, key);
    this.runtime = ManagedRuntime.make(services);
    this.runs = this.runtime.runSync(FiberMap.make<string, void, never>().pipe(Scope.provide(this.scope)));
  }

  rt(id: string): Runtime {
    let rt = this.runtimes.get(id);
    if (!rt) {
      rt = { inbox: this.inbox(id), notes: [], nudged: false, busy: false };
      this.runtimes.set(id, rt);
    }
    return rt;
  }

  /** A new start for the agent's runtime (newly seated on work): nothing waiting from before, `first` to hear first. */
  freshRuntime(id: string, first?: string): Runtime {
    const rt: Runtime = { inbox: this.inbox(id), notes: [], nudged: false, busy: false };
    rt.inbox.clear();
    if (first) rt.inbox.push(first);
    this.runtimes.set(id, rt);
    return rt;
  }

  private inbox(id: string): Inbox {
    return new Inbox((fact) => this.store.journal(id, fact), () => this.store.run(id));
  }

  update(agent: Agent, patch: Partial<Agent>): void {
    // a helper that's gone on its way takes its transcript with it
    if ('helpers' in patch) for (const h of agent.helpers ?? []) if (!patch.helpers?.some((x) => x.id === h.id)) this.store.dropLines(h.id);
    const was = agent.status;
    const wasHeld = agent.held?.until;
    Object.assign(agent, patch);
    if (!this.store.agents.has(agent.id)) return; // dismissed meanwhile
    // on hold for your plan's limit, or off it: a phase of their run, in its journal (before any status that follows)
    if ('held' in patch && patch.held?.until !== wasHeld) this.store.journal(agent.id, patch.held ? { kind: 'held', until: patch.held.until } : { kind: 'unheld' });
    // queued for a slot, or setting up: a phase of their run, in its journal
    const fact = patch.status && patch.status !== was ? PHASE_FACTS[patch.status] : undefined;
    if (fact) this.store.journal(agent.id, fact);
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
  }

  /** A lead's helper's lines: its own transcript, which goes when it does. */
  printHelper(agent: Agent, id: string, lines: Omit<TermLine, 't'>[]): void {
    // one we don't know of (Claude Code never said it started) keeps to the lead's own lines
    if (!agent.helpers?.some((h) => h.id === id)) return this.print(agent, lines.map((l) => ({ ...l, text: `    ${l.text}` })));
    if (!lines.length || !this.store.agents.has(agent.id)) return;
    const t = Date.now();
    const stamped = lines.map((l) => ({ t, ...l }));
    this.store.appendLines(id, stamped, false);
    this.hub.send({ type: 'lines', id, lines: stamped });
  }

  print(agent: Agent, lines: Omit<TermLine, 't'>[]): void {
    if (!lines.length || !this.store.agents.has(agent.id)) return;
    const t = Date.now();
    const stamped = lines.map((l) => ({ t, ...l }));
    this.store.appendLines(agent.id, stamped);
    this.hub.send({ type: 'lines', id: agent.id, lines: stamped });
  }

  /** Something to do in the background, after the current step: a timer, a follow-up, a check. */
  background(effect: Effect.Effect<void, never, ManagerServices>): void {
    this.runtime.runFork(effect);
  }

  /**
   * Runs `work` as the agent's one fiber. When they're already at work, nothing new starts. When it ends, whoever is
   * queued gets a look in (the agent themselves included, once their fiber has gone).
   */
  runFor(id: string, work: Effect.Effect<void, never, ManagerServices>): Fiber.Fiber<void> {
    const after = Effect.sync(() => {
      // a reviewer's work over, done or failed, with their review still under test: it ends without a verdict
      const agent = this.store.agents.get(id);
      if (agent) this.reviews.sessionOver(agent);
      this.background(Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => this.seating.schedule()))));
    });
    return this.runtime.runSync(FiberMap.run(this.runs, id, work.pipe(Effect.ensuring(after)), { onlyIfMissing: true }));
  }

  /** Whatever went wrong in an agent's work: in their terminal, and in a toast. A bug fails them too, rather than leaving them stuck. */
  orFail(agent: Agent) {
    return (work: Effect.Effect<void, WorkError, ManagerServices>): Effect.Effect<void, never, ManagerServices> =>
      work.pipe(
        Effect.catch((err) => Effect.sync(() => this.sessions.fail(agent, err))),
        Effect.catchDefect((defect) => Effect.sync(() => this.sessions.fail(agent, errorMessage(defect)))),
      );
  }

  /** `effect`, tried again while GitHub answers with a 5xx (pushing or opening a PR), saying so in the agent's terminal. */
  retrying<A, E, R>(agent: Agent, what: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return retryServerErrors(effect, (status, attempt) =>
      this.print(agent, [{ kind: 'system', text: `✻ GitHub answered ${what} with ${status}: trying again (${attempt} of ${SHIP_RETRIES})` }]),
    );
  }
}

/**
 * One concern of the manager's (QA reviews, triage, …). Its code reads as it did inside the manager: `this.store`,
 * `this.update`, `this.print` and the rest go to the core; anything of another concern's goes through `this.core`.
 */
export abstract class Part {
  constructor(protected readonly core: Core) {}

  protected get store(): Store {
    return this.core.store;
  }

  protected get hub(): Hub {
    return this.core.hub;
  }

  protected get runtime(): ManagedRuntime.ManagedRuntime<ManagerServices, never> {
    return this.core.runtime;
  }

  protected get runs(): FiberMap.FiberMap<string, void, never> {
    return this.core.runs;
  }

  /** The projects changed (a goal filed, the queue): saved, and sent out. */
  protected projectsChanged(): void {
    this.store.save();
    this.hub.send({ type: 'projects', projects: this.store.projects });
  }

  protected boardChanged(projectId: string): void {
    this.core.boardChanged(projectId);
  }

  protected rt(id: string): Runtime {
    return this.core.rt(id);
  }

  protected update(agent: Agent, patch: Partial<Agent>): void {
    this.core.update(agent, patch);
  }

  protected print(agent: Agent, lines: Omit<TermLine, 't'>[]): void {
    this.core.print(agent, lines);
  }

  protected printHelper(agent: Agent, id: string, lines: Omit<TermLine, 't'>[]): void {
    this.core.printHelper(agent, id, lines);
  }

  protected background(effect: Effect.Effect<void, never, ManagerServices>): void {
    this.core.background(effect);
  }

  protected runFor(id: string, work: Effect.Effect<void, never, ManagerServices>): Fiber.Fiber<void> {
    return this.core.runFor(id, work);
  }

  protected orFail(agent: Agent) {
    return this.core.orFail(agent);
  }

  protected retrying<A, E, R>(agent: Agent, what: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return this.core.retrying(agent, what, effect);
  }

  /**
   * Installs the dependencies in `dir`, a checkout `agent` is about to work in. If that fails, they hear why with what
   * they hear next (after the turn they're in, if they're in one), rather than from their first failing check.
   */
  protected install(agent: Agent, dir: string): Effect.Effect<void, never, Workspace> {
    return Effect.gen({ self: this }, function* () {
      this.update(agent, { activity: 'Installing the dependencies' });
      const failed = yield* (yield* Workspace).install(dir);
      if (!failed) return;
      this.print(agent, [{ kind: 'system', text: `✻ ${failed}` }]);
      const rt = this.rt(agent.id);
      if (rt.busy) rt.inbox.later(failed);
      else rt.inbox.push(failed);
    });
  }
}
