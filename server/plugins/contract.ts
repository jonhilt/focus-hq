// What a plugin is to the office (docs/plugins.md): the office's core lends it what it needs, and it adds briefs (work
// handed to agents in place of issues), routes, and hooks into how pull requests open, close and merge. A plugin is a
// folder under plugins/ (or anywhere, by path) whose server.ts default-exports a FocusPlugin.
import type { Effect } from 'effect';
import type { ZodType } from 'zod';
import type { LedgerEvent } from '../../shared/ledger';
import type { Agent, Planner, Project } from '../../shared/types';
import type { GitHub } from '../github/service';

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
  prOpened?(agent: Agent, pr: { number: number; url: string }): void;
  /** A pull request in any project merged or closed, a goal's too (after the goal has heard). */
  prClosed?(repo: string, number: number, merged: boolean): void;
  /**
   * An agent's turn started (they're at work) or ended (they're waiting, or stopped), any agent's: filter for the ones
   * the plugin cares about. A turn can start and end more than once in what looks like one (carrying on, a retry, a
   * new session), and a turn that's interrupted still ends, so take each as how they stand now. 'end' is heard as the
   * turn stops, before the office acts on how it went: the agent's status still says 'working' then (it becomes 'done',
   * failed or a review's verdict just after), so judge by the phase, not the status.
   */
  turn?(agent: Agent, phase: 'start' | 'end'): void;
  /**
   * A line went in the ship's log (any kind: filter for the ones that matter). It's heard as it's written, before the
   * office has acted on what it says (a goal's pull request merging is logged before the goal knows), so read the
   * office afresh a moment later rather than straight away.
   */
  ledgerRecorded?(event: LedgerEvent): void;
  /** Whether only the captain merges this pull request, whatever QA says. By its branch, since a pull request outlives its agent. */
  captainMerges?(pr: { branch: string }): boolean;
  /** Tools it adds to every goal lead's office, beside ship, note and show (`mcp__office__<name>`). */
  leadTools?: LeadTool[];
}

/** A tool a plugin adds to every goal lead's office (`mcp__office__<name>`), answered in words. */
export interface LeadTool {
  /** Lowercase letters, digits and underscores; a name the office's own tools have is left out. */
  name: string;
  /** What it's for and when to reach for it, as the lead reads it. */
  description: string;
  /** Its input's fields, as zod types (the SDK's tool boundary takes zod). */
  input: Record<string, ZodType>;
  /** Its answer to the lead, in words; a throw is said back to them as the tool failing, in its message. */
  run(lead: LeadToolContext, input: Record<string, unknown>): Promise<string>;
}

/** What a plugin's lead tool gets: whose lead it is, their checkouts, and their station's screen. */
export interface LeadToolContext {
  agent: Agent;
  /** The lead's checkout of each of the goal's repos, as it stands in their workspace (their branch, uncommitted work and all). */
  checkouts: { repo: string; dir: string }[];
  /** Puts a page on the lead's station's screen as their show tool does (the same id again replaces it); says where it went. */
  show(page: { id: string; title: string; html: string }): Promise<string>;
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

/** What the office lends a plugin. */
export interface PluginHost {
  /** The demo office: fake GitHub and scripted agents. */
  readonly demo: boolean;
  /**
   * The plugin's own state, `fresh()` until it's first set: setting it tells every browser. It's saved in state.json
   * unless `saved` is false (state that's read again as the office starts, like main engineering's scorecards).
   */
  state<S extends object>(fresh: () => S, how?: { saved?: boolean }): PluginState<S>;
  projects(): Project[];
  agent(id: string): Agent | undefined;
  /** Every agent in the office now, of every project. */
  agents(): Agent[];
  /**
   * An agent session's Claude Code transcript (its JSONL) by session id: undefined when it isn't on this machine (a
   * cloud session's). In the demo, the scripted agents' stand-ins.
   */
  transcript(sessionId: string): Promise<string | undefined>;
  /** The ship's log of how work went, oldest first. */
  ledger(): LedgerEvent[];
  /** The office's own repo (`owner/repo`, from its checkout's remote): none in the demo. */
  ownRepo(): string | undefined;
  /** Hands one of the plugin's briefs to an agent: `crew` sits down when it's always the same person, else someone's hired. Throws, in words, when it can't. */
  seat(projectId: string, repo: string, work: BriefWork, crew?: Planner): Agent;
  /** Forgets what the office keeps of an agent's last session (what waited to be said, their notes), so their next brief starts afresh. */
  forget(agentId: string): void;
  /** A line in an agent's terminal, from the office. */
  print(agent: Agent, text: string): void;
  toast(level: 'info' | 'success' | 'error', text: string, agentId?: string): void;
  /**
   * What the plugin `id` provides: one of this plugin's `requires`, so it's on and started already. `T` is that
   * plugin's own type for it (a type-only import, so no code is shared). Throws, in words, for a plugin not required.
   */
  uses<T extends object>(id: string): T;
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
