// What a plugin is to the office (docs/plugins.md): the office's core lends it what it needs, and it adds briefs (work
// handed to agents in place of issues), routes, and hooks into how pull requests open, close and merge. A plugin is a
// folder under plugins/ (or anywhere, by path) whose server.ts default-exports a FocusPlugin.
import type { Effect } from 'effect';
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
  /** A pull request in any project merged or closed. */
  prClosed?(repo: string, number: number, merged: boolean): void;
  /** Whether only the captain merges this pull request, whatever QA says. By its branch, since a pull request outlives its agent. */
  captainMerges?(pr: { branch: string }): boolean;
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
