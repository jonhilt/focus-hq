// The captain's chat with Number One.

/** Work Number One suggests a chat turn into: the captain sends it to the project's Ops station or to its lead. */
export interface WorkSuggestion {
  projectId: string;
  idea: string;
}

export interface NumberOneMessage {
  from: 'manager' | 'number-one';
  text: string;
  /** Number One's reply in a line or two, without paths or code. */
  spoken?: string;
  suggest?: WorkSuggestion;
  at: number;
}

/** thinking - Number One is reading or composing a reply; waiting - your turn; failed - the last turn went wrong (say something to try again). */
export type NumberOneStatus = 'thinking' | 'waiting' | 'failed';

/**
 * The captain's chat with Number One, the ship's first officer: questions about any project's code, the ship's live
 * state, or anything else. Read-only: it never turns into work by itself. One conversation, saved across restarts.
 */
export interface NumberOneChat {
  status: NumberOneStatus;
  /** What Number One is doing right now. */
  activity: string;
  messages: NumberOneMessage[];
  updatedAt: number;
  costUsd: number;
  error?: string;
}
