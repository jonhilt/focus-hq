// The chief engineer's retros.

/** The cheapest kind of fix that would do: a check the office runs, a rule for QA, a pointer in a prompt or doc, or taking something out. */
export const FIX_KINDS = ['check', 'qa-rule', 'pointer', 'delete'] as const;
export type FixKind = (typeof FIX_KINDS)[number];

/** One moment a proposal rests on: which session (its file under sessions/), when, and what was said or done. */
export interface RetroEvidence {
  session: string;
  at?: string;
  quote: string;
}

/** One improvement the chief engineer proposes to how the office works, with the moments it rests on. */
export interface RetroProposal {
  title: string;
  /** What keeps happening, and why it matters. */
  problem: string;
  evidence: RetroEvidence[];
  /** What to change. */
  fix: string;
  kind: FixKind;
  /** How the next retro can tell whether it worked: a number to watch, with today's value. */
  measure: string;
}

export type RetroStatus = 'idle' | 'gathering' | 'thinking' | 'done' | 'failed';

/** A look back over the office's recent sessions by the chief engineer at the engineering station. */
export interface Retro {
  status: RetroStatus;
  /** What they're doing right now. */
  activity: string;
  /** How many days back it looks. */
  days: number;
  /** Sessions it read. */
  sessions: number;
  startedAt?: number;
  finishedAt?: number;
  /** A few lines on how things have gone. */
  summary?: string;
  /** Most worth doing first. */
  proposals: RetroProposal[];
  wentWell: string[];
  /** One-offs to keep an eye on: not patterns yet. */
  watch: string[];
  costUsd: number;
  error?: string;
}
