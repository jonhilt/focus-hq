// Issue drafts from the planner at a room's New issue stand.

import type { Avatar } from './agents';

/** The crew member at a room's ＋ New issue stand who turns a rough idea into a well-specified issue. One per project. */
export interface Planner {
  name: string;
  avatar: Avatar;
}

export type DraftStatus = 'drafting' | 'ready' | 'failed';

/**
 * An issue the planner is writing, or has written, for a project. Lives in memory until it's filed or discarded, so it
 * waits at the stand if you walk away. One per project at a time.
 */
export interface IssueDraft {
  projectId: string;
  status: DraftStatus;
  /** The manager's rough idea, as they typed it. */
  idea: string;
  /** What the planner is doing right now ("Reading src/cart.ts"). */
  activity: string;
  /** The project repository the planner thinks the issue belongs in. */
  repo?: string;
  title?: string;
  /** Markdown: context, what to build, acceptance criteria, out of scope, assumptions. */
  body?: string;
  /** Why the planner thinks the idea is too big or too vague for one issue, when they do: the card offers to start it as a goal. */
  tooBig?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  costUsd?: number;
}
