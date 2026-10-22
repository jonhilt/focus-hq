// Projects (each a holodeck room) and Focus's settings.

import type { Effort } from './agents';
import type { GoalRecord, QueuedGoal } from './goals';
import type { PreviewConfig } from './previews';

export type Autonomy = 'ask' | 'auto' | 'full';

export const MERGE_METHODS = ['squash', 'merge', 'rebase'] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export interface Settings {
  /** Max agents running at once across every project (protects your subscription limits). */
  maxConcurrent: number;
  /**
   * ask  - edits and common dev commands run freely, anything else makes the agent raise its hand.
   * auto - Claude Code's auto mode classifier decides.
   * full - bypass all permission checks.
   */
  autonomy: Autonomy;
  /** Claude model for agents. Empty = Claude Code's default for your account. */
  model: string;
  /** Claude model for agents seated to resolve a pull request's merge conflicts. Empty = the `model` setting. */
  conflictsModel: string;
  /** How hard those conflict-resolving agents think. Missing = the model's default. */
  conflictsEffort?: Effort;
  /** Claude model for each room's QA officer and every goal's reviewer. Empty = the `model` setting. */
  qaModel: string;
  /** How the board's Merge button, and auto-merge, merge a pull request, unless its project picks another for its repo. */
  mergeMethod: MergeMethod;
  /** Pull requests and QA reports on GitHub name the agent who did the work and mention Focus. */
  attribution: boolean;
  /** Agents read your own ~/.claude/CLAUDE.md (and ~/.claude/rules) as well as Focus's instructions and the repo's CLAUDE.md. */
  userClaudeMd: boolean;
  /** The effort a new goal's lead starts at, unless the captain picks another when starting it. */
  leadEffort: Effort;
  /** A goal lead's conversation is compacted before their next turn once it holds this many tokens. 0 = only when the captain asks. */
  leadCompactAt: number;
  /**
   * The plugins the captain switched on for the whole ship in the ready room's Plugins tab, by id, from Focus's next start
   * (shared/shipPlugins.ts). Missing until they first choose. FOCUS_PLUGINS, where it's set, overrides it.
   */
  plugins?: string[];
  /** Pull, rebuild and restart when Focus's checkout's upstream branch moves (server/updater.ts). Missing = on. */
  autoUpdate?: boolean;
  /** The command that opens a terminal for a cloud session (e.g. "kitty -e"), the script's path after it. Missing = the usual ones, in turn. */
  terminal?: string;
  /** The browser agents drive (its executable's path). Missing = Playwright's Chromium, else Chrome, else Edge. */
  browserPath?: string;
  /** Focus's address as a bot speaking for the captain reaches it (server/bot.ts), unless FOCUS_PUBLIC_URL is set. Missing = none. */
  publicUrl?: string;
}

/** The settings an environment variable can set, each with its name: where it's set, it wins over the captain's. */
export const SETTINGS_ENV = { autoUpdate: 'FOCUS_AUTO_UPDATE', terminal: 'FOCUS_TERMINAL', browserPath: 'FOCUS_BROWSER_PATH' } as const satisfies Partial<Record<keyof Settings, string>>;
export type PinnedSettings = Partial<Record<keyof typeof SETTINGS_ENV, (typeof SETTINGS_ENV)[keyof typeof SETTINGS_ENV]>>;

/**
 * What a room's walls show. Every theme but 'office' turns the walls and ceiling into a window on a
 * landscape built around the room, so the desks look like they sit in the middle of it.
 */
export const ROOM_THEMES = ['beach', 'forest', 'desert', 'moon', 'city', 'library', 'office'] as const;
export type RoomTheme = (typeof ROOM_THEMES)[number];

export interface Project {
  id: string;
  name: string;
  color: string;
  /** Scenery around the room. Missing on projects made before themes existed; the client then picks one from the id. */
  theme?: RoomTheme;
  /** GitHub repositories as "owner/name". */
  repos: string[];
  /** How each repo's pull requests merge, overriding Settings' mergeMethod (a repo missing here follows Settings). */
  mergeMethods?: Record<string, MergeMethod>;
  /** How many agents may work on this project at the same time (the room always has DESKS_PER_ROOM desks). */
  maxAgents: number;
  /** Automatically hire agents for open issues when desks are free. */
  autoAssign: boolean;
  /** When auto-assigning, only pick issues carrying this label (empty = any issue). */
  autoLabel: string;
  /** Board shows only PRs you (the gh account) or your agents opened, hiding teammates' PRs. */
  onlyMyPrs?: boolean;
  /** How ▶ Preview runs this project's pull requests. */
  preview?: PreviewConfig;
  /** The QA officer tests every PR Ops opens or updates (missing = on; a new project starts off). */
  autoQa?: boolean;
  /** A PR Ops opened that fails QA goes back to a developer to fix (missing = on; a new project starts off). */
  autoSendBack?: boolean;
  /** PRs Ops opened merge by themselves once QA passed their head commit and checks are green (missing = off). */
  autoMerge?: boolean;
  /**
   * The package.json scripts the merge check runs on a PR merged onto its base before Ops merges it
   * (docs/merging.md): missing = typecheck, lint and test; empty = none (only conflicts stop a merge). A repo with a
   * `merge-check` script runs that instead.
   */
  mergeChecks?: string[];
  /**
   * Ops runs the merge check before each merge it makes (missing = on). Off, a merge goes straight to GitHub: no trial,
   * and no wait in the repo's line (docs/merging.md#switching-it-off). QA still runs the `mergeChecks` scripts itself.
   */
  checkMerges?: boolean;
  /**
   * QA blocks a pull request only with proof: a test that fails when Ops runs it, a failing check, or a screenshot
   * of a failure in the browser. A fail without one goes up as advice and the verdict is a pass (missing = on).
   */
  qaProof?: boolean;
  /** What QA must check on every PR of this project, on top of the usual review. Goes into the QA officer's prompt. */
  qaBrief?: string;
  /**
   * Kept out of sight, say while demoing the ship: the holodeck keeps its place behind locked doors with an "in use"
   * sign, and the project's name, board and crew show nowhere aboard. Its crew keep working. Missing = shown.
   */
  hidden?: boolean;
  /** How hard the room's QA (its officer, and each goal's reviewer) thinks. Missing = the model's default. */
  qaEffort?: Effort;
  /**
   * The plugins switched on for this project, by id (shared/projectPlugins.ts): a plugin that works per project, like
   * cartography, does nothing for it otherwise. Missing = none.
   */
  plugins?: string[];
  /** Goals waiting for a free team station, first up first. They never start by themselves. */
  goalQueue?: QueuedGoal[];
  /** Goals that have been closed, newest first (a few dozen at most). */
  goals?: GoalRecord[];
  createdAt: number;
}
