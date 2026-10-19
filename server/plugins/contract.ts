// What a plugin is to the office (docs/plugins.md): the office's core lends it what it needs, and it adds briefs (work
// handed to agents in place of issues), routes, and hooks into how pull requests open, close and merge. A plugin is a
// folder under plugins/ (or anywhere, by path) whose server.ts default-exports a FocusPlugin.
import type { Effect } from 'effect';
import type { ZodType } from 'zod';
import type { LedgerEntry, LedgerEvent } from '../../shared/ledger';
import type { PersonalEntry } from '../../shared/personalLog';
import type { MachineGraph, MachineRun } from '../../shared/machines';
import type { Agent, Issue, MessageReply, Planner, Project, QueuedGoal, ResumeHow, Settings, Snapshot, SystemModel, TermLine } from '../../shared/types';
import type { ShipStatus } from '../agents/shipStatus';
import type { GitHub } from '../github/service';
import type { ReadOnlyResult, ReadOnlyRun, ShipSessionRun } from '../agents/claudeCrew';

export interface FocusPlugin {
  /** Its name in FOCUS_PLUGINS: also its state's key in state.json, and its routes' prefix (`/api/plugins/<id>`). */
  id: string;
  /**
   * The plugins it can't work without, by id. It starts only when every one of them is switched on and started (after
   * them), and reaches what each provides through `host.uses`; otherwise it's left out, saying why.
   */
  requires?: string[];
  /** Called once as the office starts, with what the office lends it; returns what it adds. */
  start(host: PluginHost): PluginParts;
}

/** What a plugin adds to the office: every part is optional. */
export interface PluginParts {
  /** What it lends the plugins that require it (`host.uses(id)` gives them this): the scorecard's scorecards, say. */
  provides?: object;
  /** Kinds of work it hands agents in place of an issue, by kind. */
  briefs?: Record<string, BriefSpec>;
  /** Its REST routes, mounted under `/api/plugins/<id>`. */
  routes?: PluginRoute[];
  /** A project's board was read from GitHub again (about once a minute): a moment to look at how the plugin's work stands. */
  boardRefreshed?(projectId: string): void;
  /** The office opened, or updated, the pull request of an agent on one of this plugin's briefs. */
  prOpened?(agent: Readonly<Agent>, pr: { number: number; url: string }): void;
  /** A project's settings changed: a plugin switched on or off for it, say (`host.on`). */
  projectChanged?(projectId: string): void;
  /** A pull request in any project merged or closed, a goal's too (after the goal has heard). */
  prClosed?(repo: string, number: number, merged: boolean): void;
  /**
   * An agent's turn started (they're at work) or ended (they're waiting, or stopped), any agent's: filter for the ones
   * the plugin cares about. A turn can start and end more than once in what looks like one (carrying on, a retry, a
   * new session), and a turn that's interrupted still ends, so take each as how they stand now. 'end' is heard as the
   * turn stops, before the office acts on how it went: the agent's status still says 'working' then (it becomes 'done',
   * failed or a review's verdict just after), so judge by the phase, not the status.
   */
  turn?(agent: Readonly<Agent>, phase: 'start' | 'end'): void;
  /**
   * A line went in the ship's log (any kind: filter for the ones that matter). It's heard as it's written, before the
   * office has acted on what it says (a goal's pull request merging is logged before the goal knows), so read the
   * office afresh a moment later rather than straight away.
   */
  ledgerRecorded?(event: Readonly<LedgerEvent>): void;
  /**
   * A goal's lead drew a model of how the code works (their `model` tool), checked against their checkout: the id and
   * title they gave it, the model as the check left it, the page drawn of it, and its picture when one was taken.
   */
  modelShown?(agent: Readonly<Agent>, shown: ModelShown): void;
  /**
   * One of the office's state machines stepped (`host.machines`): a journal took a fact, so a run of `machine` (`key`,
   * an agent's id or a pull request's key) may be in another state. Heard as it's written: read `host.machines()` for
   * where it is now.
   */
  machineStepped?(machine: string, key: string): void;
  /** Whether only the captain merges this pull request, whatever QA says. By its branch, since a pull request outlives its agent. */
  captainMerges?(pr: { branch: string }): boolean;
  /** Tools it adds to the office of every goal lead whose project it's switched on for, beside ship, note and show (`mcp__office__<name>`). */
  leadTools?: LeadTool[];
}

/** A model a lead drew, as the plugins hear of it (`modelShown`). */
export interface ModelShown {
  id: string;
  title: string;
  model: SystemModel;
  html: string;
  image?: Uint8Array;
}

/** A tool a plugin adds to every goal lead's office (`mcp__office__<name>`), answered in words, and pictures if it likes. */
export interface LeadTool {
  /** Lowercase letters, digits and underscores; a name the office's own tools have is left out. */
  name: string;
  /** What it's for and when to reach for it, as the lead reads it. */
  description: string;
  /** Its input's fields, as zod types (the SDK's tool boundary takes zod). */
  input: Record<string, ZodType>;
  /** Its answer to the lead, in words (with JPEGs for them to look at); a throw is said back to them as the tool failing, in its message. */
  run(lead: LeadToolContext, input: Record<string, unknown>): Promise<string | LeadToolReply>;
  /**
   * The input the demo office's scripted lead calls it with, for the demo's repos' `folders`; `again` when the captain
   * asked them for more on it. Without one, the scripted lead leaves the tool be.
   */
  demo?(ask: { folders: readonly string[]; again: boolean }): Record<string, unknown>;
}

/** A lead tool's answer with pictures: the words, then JPEGs for the lead to look at. */
export interface LeadToolReply {
  text: string;
  images: Uint8Array[];
}

/**
 * Moments of a page to take a picture of besides how it rests (`LeadToolContext.showFrames`): the page jumps to each
 * through its `window.kitSeek(at)`, the picture is clipped to `clip` (CSS pixels on its 1280 × 800), and the page's
 * `window.kitSeen(jpeg)` (given the picture as base64 JPEG, and may return a promise) says what it sees in it.
 */
export interface PageFrames {
  at: readonly number[];
  clip: { x: number; y: number; width: number; height: number };
}

/** What a plugin's lead tool gets: whose lead it is, their checkouts, and their station's screen. */
export interface LeadToolContext {
  agent: Agent;
  /** The lead's checkout of each of the goal's repos, as it stands in their workspace (their branch, uncommitted work and all). */
  checkouts: { repo: string; dir: string }[];
  /** Puts a page on the lead's station's screen as their show tool does (the same id again replaces it); says where it went. */
  show(page: { id: string; title: string; html: string }): Promise<string>;
  /**
   * `show`, with a picture of the page at each of `frames` too, and what the page saw in each (`seen`: whatever its
   * `kitSeen` returned, to narrow; null without one). No frames when the office couldn't take its picture.
   */
  showFrames(page: { id: string; title: string; html: string }, frames: PageFrames): Promise<{ text: string; frames: { at: number; image: Uint8Array; seen: unknown }[] }>;
}

/**
 * A kind of work a plugin hands an agent in place of an issue (task `brief`). Like an issue's, it starts a new branch
 * from the repo's default one and ends in a pull request the office opens.
 */
export interface BriefSpec {
  /** A word for the agent's name tag and panels, like `Climb`. */
  label: string;
  icon: string;
  /** They work away from the room's desks (`AWAY_DESK`), and don't count against its limit. */
  away?: boolean;
  /** Their system prompt's assignment: who they are, and what the work is. */
  assignment: string;
  /** What their final message must be: the office opens their pull request from it (`pullRequest`). */
  summary: string;
  /** Their first message. GitHub failing should cost the brief some detail, not the work. */
  brief(agent: Agent): Effect.Effect<string, never, GitHub>;
  /** Their pull request's title and body, from their final message. A brief has no issue, so no `Closes #…` is added. */
  pullRequest(summary: string): { title: string; body: string };
  /** What the demo office's scripted stand-in writes up for it. */
  demo?: { title: string; summary: string };
}

export interface PluginRoute {
  method: 'get' | 'post';
  /** Under `/api/plugins/<id>`, like `/keep-climbing`. */
  path: string;
  /** Its answer, sent as JSON; a throw becomes a 400 with the error's message. `body` is a POST's JSON body, `query` the query string. */
  handle(req: { body: Record<string, unknown>; query: Record<string, unknown> }): unknown;
}

/**
 * What the office lends a plugin. What it reads of the office (its agents, projects, settings, ledger, snapshot, and
 * the agents and lines its hooks hear of) is a copy of its own, marked read-only: changing it never changes the office.
 */
export interface PluginHost {
  /** The demo office: fake GitHub and scripted agents. */
  readonly demo: boolean;
  /**
   * The plugin's own state, `fresh()` until it's first set: setting it tells every browser. It's saved in state.json
   * unless `saved` is false (state that's read again as the office starts, like main engineering's scorecards).
   */
  state<S extends object>(fresh: () => S, how?: { saved?: boolean }): PluginState<S>;
  projects(): Readonly<Project>[];
  /**
   * Whether this plugin is switched on for project `projectId`, in its settings (`Project.plugins`). A plugin that works
   * per project does nothing for a project it's off for; the office already keeps its lead tools and holodeck screens
   * away from one.
   */
  on(projectId: string): boolean;
  agent(id: string): Readonly<Agent> | undefined;
  /** An agent's last `count` terminal lines, oldest first. */
  recentLines(agentId: string, count: number): readonly Readonly<TermLine>[];
  /** A file a goal's lead put on their station's screen (`<id>.html`, its picture `<id>.jpg`): undefined when there's none. */
  artifact(leadId: string, file: string): Promise<Uint8Array | undefined>;
  /** Every agent in the office now, of every project. */
  agents(): Readonly<Agent>[];
  /**
   * An agent session's Claude Code transcript (its JSONL) by session id: undefined when it isn't on this machine (a
   * cloud session's). In the demo, the scripted agents' stand-ins.
   */
  transcript(sessionId: string): Promise<string | undefined>;
  /** The ship's log of how work went, oldest first. */
  ledger(): Readonly<LedgerEvent>[];
  /**
   * The office's state machines (`server/agents/machines.ts`), each as data to draw it from, in the order they're shown,
   * and where every run of each is now: each agent's run and what followed their last turn, each goal's slices, each
   * review on the boards.
   */
  machines(): { graphs: readonly Readonly<MachineGraph>[]; runs: readonly Readonly<MachineRun>[] };
  /**
   * Writes a line in the ship's log for `projectId` (at `at`, or now), and sends the new report card. Every plugin
   * hears it on `ledgerRecorded`, the one writing it too.
   */
  record(projectId: string, entry: LedgerEntry, at?: number): void;
  /** The captain's settings (the model read-only sessions run on, say), as they are now. */
  settings(): Readonly<Settings>;
  /**
   * The whole office as a browser gets it when it connects: projects, every agent with their recent terminal lines,
   * boards, QA's reviews, the Ops stations' drafts and every plugin's state. It's a lot: ask when it's needed (an
   * answer to the captain), not on a timer, and only read it.
   */
  snapshot(): Promise<Readonly<Snapshot>>;
  /**
   * The ship as the crew's `ship_status` tool tells it (`server/agents/shipStatus.ts`): per project, who's on what and
   * where their worktree is, the open pull requests, what needs the captain, and each closed goal's pull requests as
   * they stand on GitHub now. Hidden projects are left out.
   */
  shipStatus(): Promise<ShipStatus>;
  /**
   * The captain's personal log (docs/personal-log.md): what they've jotted down to come back to, oldest first, done and
   * dropped included; and `note`, which jots a thought down for them, `via` whoever did (a crew member's name). Jot one
   * down only when the captain asks.
   */
  readonly personalLog: {
    entries(): Readonly<PersonalEntry>[];
    note(text: string, via: string): PersonalEntry;
  };
  /** The captain's goals, to act on for the captain once they've said so. */
  readonly goals: PluginGoals;
  /**
   * Files an issue on GitHub in `repo`, which has to be one of `projectId`'s repos (it throws, in words, for any
   * other), and puts it on the project's board straight away.
   */
  fileIssue(projectId: string, repo: string, title: string, body: string): Promise<Issue>;
  /** The office's own repo (`owner/repo`, from its checkout's remote): none in the demo. */
  ownRepo(): string | undefined;
  /** The office's own checkout (its root folder): a real repo on this machine, in the demo too. */
  readonly officeDir: string;
  /**
   * The plugin's own folder for files it keeps (`<data dir>/plugins/<id>`), made when it's first asked for. `movedFrom`
   * is a folder it kept in the office's data dir before it was a plugin: what's in it moves in.
   */
  dataDir(how?: { movedFrom?: string }): string;
  /**
   * A read-only Claude Code session, as the office's own crew run them: only the built-in tools it's given (Read,
   * Glob, Grep, WebSearch, WebFetch), all pre-approved, none of the captain's settings or hooks, and its answer.
   */
  readOnlySession(run: ReadOnlyRun): Promise<ReadOnlyResult>;
  /**
   * A read-only session with the run of the ship, as Number One's: from the office's planning folder (where it checks
   * out a project's code on demand), the agents' worktrees readable, and the ship tools (`ship_status`,
   * `open_project`) as `mcp__<plugin id>__…`. Neither tool changes anything aboard.
   */
  shipSession(run: ShipSessionRun): Promise<ReadOnlyResult>;
  /**
   * A model of how the code answers `question`, drawn afresh by a read-only session reading `dirs` (each a checkout,
   * as `checkout` gives them), then checked and drawn by the office as a lead's model tool does: the model as the check
   * left it (and what didn't check out), its page, and its picture. A session costs, so draw only when asked to. The
   * demo's stand-in draws one model of the office's own code, whatever's asked.
   */
  drawModel(ask: { question: string; title: string; dirs: string[] }): Promise<ModelShown & { problems: string[] }>;
  /**
   * Checks out `repo`'s default branch as it is on GitHub now, detached, in a folder of the plugin's own (in its
   * `dataDir`), and says where. `repo` has to be one of the office's projects' repos: it throws, in words, for any other.
   */
  checkout(repo: string): Promise<string>;
  /**
   * A goal lead's checkouts, as their work stands in their workspace: each repo, where it is, and the branch it ships
   * into. Only to read: the lead's at work in them. Empty for anyone who isn't a goal's lead.
   */
  leadCheckouts(agentId: string): { repo: string; dir: string; baseBranch: string }[];
  /** Hands one of the plugin's briefs to an agent: `crew` sits down when it's always the same person, else someone's hired. Throws, in words, when it can't. */
  seat(projectId: string, repo: string, work: BriefWork, crew?: Planner): Agent;
  /** Forgets what the office keeps of an agent's last session (what waited to be said, their notes), so their next brief starts afresh. */
  forget(agentId: string): void;
  /** A line in an agent's terminal, from the office. */
  print(agent: Pick<Agent, 'id'>, text: string): void;
  toast(level: 'info' | 'success' | 'error', text: string, agentId?: string): void;
  /**
   * What the plugin `id` provides: one of this plugin's `requires`, so it's on and started already. `T` is that
   * plugin's own type for it (a type-only import, so no code is shared). Throws, in words, for a plugin not required.
   */
  uses<T extends object>(id: string): T;
}

/** What a plugin can do with the captain's goals, as the captain would from the goals panel; each throws, in words, when it can't. */
export interface PluginGoals {
  /**
   * Starts a goal in the project with a lead of its own at a free team station, or queues it when every station has
   * one. `from` says where it came from (`a call`), for the goal's record and its lead.
   */
  start(projectId: string, text: string, how: { from: string }): { agent: Agent } | { queued: QueuedGoal };
  /** Starts a queued goal at team station `station` (from 0). */
  startQueued(projectId: string, queueId: string, station: number): Agent;
  /**
   * Passes a goal's lead (or any agent) a message, as the captain's, or as `from`'s (a crew member's name). On your API
   * key, picking a long conversation back up can cost: then it comes back `costly`, for the captain to say `how`.
   */
  message(agentId: string, text: string, opts?: { from?: string; how?: ResumeHow }): MessageReply;
}

export interface PluginState<S> {
  get(): S;
  /** Applies the patch (saving it, for saved state), and sends the new state to every browser. */
  set(patch: Partial<S>): void;
}

/** One of a plugin's briefs, for an agent to start on. */
export interface BriefWork {
  /** Their agent id: the same one every time keeps one record (and terminal) for someone who comes back. */
  id: string;
  /** Which of the plugin's briefs. */
  kind: string;
  /** What they're doing, until their pull request names it. */
  title: string;
  branch: string;
  baseBranch: string;
}
