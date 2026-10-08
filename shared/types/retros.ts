// The chief engineer's retros.

/** The cheapest kind of fix that would do: a check the office runs, a rule for QA, a pointer in a prompt or doc, or taking something out. */
export const FIX_KINDS = ['check', 'qa-rule', 'pointer', 'delete'] as const;
export type FixKind = (typeof FIX_KINDS)[number];

/**
 * An issue the chief engineer drafts from frictions that came up in three or more sessions, for the captain to accept
 * (it's filed) or reject. Either way the decision goes in the ledger with the frictions' signatures, so a later retro
 * leaves them be and the report card can tell whether an accepted fix stopped them recurring.
 */
export interface RetroDraft {
  id: string;
  title: string;
  /** The issue's body as it would be filed: the engineer's words, then the quoted evidence code adds. */
  body: string;
  kind: FixKind;
  /** The number the next retro should watch, with its value today. */
  measure: string;
  /** The friction groups it rests on (`<kind>: <signature>`), and how many sessions they came up in. */
  signatures: string[];
  sessions: number;
  decision?: { accepted: boolean; at: number; issue?: { repo: string; number: number; url: string } };
}

export type RetroStatus = 'idle' | 'gathering' | 'thinking' | 'done' | 'failed';

/** A look back over the office's recent sessions by the chief engineer at the engineering station. */
export interface Retro {
  status: RetroStatus;
  /** What they're doing right now. */
  activity: string;
  /** How many days back it looks. */
  days: number;
  /** Session digests it looked over. */
  sessions: number;
  startedAt?: number;
  finishedAt?: number;
  /** A few lines on how things have gone. */
  summary?: string;
  /** Most worth doing first. */
  drafts: RetroDraft[];
  /** Frictions seen in two sessions: not a pattern yet, worth keeping an eye on. */
  watch: string[];
  costUsd: number;
  error?: string;
}
