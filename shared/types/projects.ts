// Projects (each a holodeck room) and the office's settings.

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
}

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
  /** The QA officer tests every PR the office opens or updates (missing = on). */
  autoQa?: boolean;
  /** A PR the office opened that fails QA goes back to a developer to fix (missing = on). */
  autoSendBack?: boolean;
  /** PRs the office opened merge by themselves once QA passed their head commit and checks are green (missing = off). */
  autoMerge?: boolean;
  /** What QA must check on every PR of this project, on top of the usual review. Goes into the QA officer's prompt. */
  qaBrief?: string;
  /**
   * Kept out of sight, say while demoing the office: the holodeck keeps its place behind locked doors with an "in use"
   * sign, and the project's name, board and crew show nowhere aboard. Its crew keep working. Missing = shown.
   */
  hidden?: boolean;
  /** How hard the room's QA (its officer, and each goal's reviewer) thinks. Missing = the model's default. */
  qaEffort?: Effort;
  /** Goals waiting for a free team station, first up first. They never start by themselves. */
  goalQueue?: QueuedGoal[];
  /** Goals that have been closed, newest first (a few dozen at most). */
  goals?: GoalRecord[];
  createdAt: number;
}
