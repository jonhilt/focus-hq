// The chief engineer's retros (README.md): the plugin's state, as its server part saves it and the browser shows it.

import type { AgentStatus } from '../../plugin-api/shared';

/** The plugin's id: in FOCUS_PLUGINS, its state's key and its routes' prefix. */
export const RETRO = 'retro';

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

export const freshRetro = (): Retro => ({ status: 'idle', activity: '', days: 14, sessions: 0, drafts: [], watch: [], costUsd: 0 });

/** The latest retro as it picks up after a restart: one under way when Focus shut down ends, so another can start. */
export function retroAfterRestart(saved: Retro): Retro {
  // a retro saved before drafts replaced proposals has none
  saved = { ...saved, drafts: saved.drafts ?? [], watch: saved.watch ?? [] };
  if (saved.status !== 'gathering' && saved.status !== 'thinking') return saved;
  return { ...saved, status: 'failed', activity: 'Interrupted', error: 'Interrupted when Focus shut down. Start it again.' };
}

/** Whether the retro is under way: reading sessions, or drafting. */
export const running = (retro: Retro | undefined): boolean => retro?.status === 'gathering' || retro?.status === 'thinking';

/** The drafts of a finished retro the captain hasn't decided on yet. */
export const waiting = (retro: Retro | undefined): number => (retro?.status === 'done' ? retro.drafts.filter((d) => !d.decision).length : 0);

/** What the chief engineer says at the engineering station while a retro runs or waits on the captain: nothing when idle. */
export function stationLine(retro: Retro | undefined): { status: AgentStatus; line: string } | null {
  if (!retro || retro.status === 'idle') return null;
  if (retro.status === 'failed') return { status: 'error', line: `Retro: ${retro.error ?? 'didn’t finish'}` };
  if (retro.status !== 'done') return { status: 'working', line: `Retro: ${retro.activity}` };
  const drafts = waiting(retro);
  const line = drafts ? `Retro: ${drafts} draft${drafts === 1 ? '' : 's'} waiting` : retro.drafts.length ? 'Retro: all drafts decided' : 'Retro: nothing keeps coming back';
  return { status: 'done', line };
}
