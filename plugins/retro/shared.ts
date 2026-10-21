// The chief engineer's retros: the plugin's state, as its server part saves it and the browser shows it.

import type { AgentStatus } from '../../plugin-api/shared';

/** The plugin's id: in FOCUS_PLUGINS, its state's key and its routes' prefix. */
export const RETRO = 'retro';

/** The cheapest kind of fix that would do: a check Ops runs, a rule for QA, a pointer in a prompt or doc, or taking something out. */
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

/** A look back over the ship's recent sessions by the chief engineer at the engineering station. */
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

/** What the retro's card beside the overview says (view.ts): whether one's under way or waiting on the captain, and its button. */
export function retroCardLine(retro: Retro | undefined): { line: string; open: string } {
  const drafts = waiting(retro);
  const open = drafts ? 'Review drafts →' : 'Open →';
  if (retro && running(retro)) return { line: retro.activity, open };
  if (drafts) return { line: `${drafts} ${drafts === 1 ? 'draft waits' : 'drafts wait'} for you to accept or reject`, open };
  if (retro?.status === 'failed') return { line: `The last retro failed: ${retro.error ?? retro.activity}`, open };
  return { line: 'Drafts an issue for each friction that keeps coming back', open };
}

/** What the retro's own view shows (view.ts): Start or Stop, what it's cost, how the latest stands and what a finished one found. */
export interface RetroPage {
  startLabel: string;
  running: boolean;
  cost: string | null;
  /** The latest retro, once one has started. */
  standing: Retro | null;
  /** The latest retro, once it's finished. */
  found: Retro | null;
}

export function retroPage(retro: Retro | undefined): RetroPage {
  return {
    startLabel: retro?.status === 'done' ? 'Start a new retro' : 'Start a retro',
    running: running(retro),
    cost: retro?.costUsd ? `$${retro.costUsd.toFixed(2)}` : null,
    standing: retro && retro.status !== 'idle' ? retro : null,
    found: retro?.status === 'done' ? retro : null,
  };
}

/** How the latest retro stands on its own view (view.ts): its status's tone, what it's doing (or why it failed), and its window and start. */
export function retroStanding(retro: Retro, ago: (at: number) => string): { tone: 'bad' | 'ok' | 'warn'; headline: string; line: string } {
  const failed = retro.status === 'failed';
  return {
    tone: failed ? 'bad' : retro.status === 'done' ? 'ok' : 'warn',
    headline: failed ? (retro.error ?? retro.activity) : retro.activity,
    line: [
      retro.sessions ? `${retro.sessions} sessions over ${retro.days} days` : `the last ${retro.days} days`,
      retro.startedAt ? `started ${ago(retro.startedAt)}` : '',
    ].filter(Boolean).join(' · '),
  };
}

/** The window input on the retro's view, and the retro it was started from (by its `startedAt`). */
export interface WindowInput<I> {
  input: I;
  seededFrom: number | undefined;
}

/**
 * The window input to show: the one `kept`, so re-renders don't reset what the captain typed, or a new one `make`s
 * from the retro's own window (14 days before there's one) once a new retro has been saved since it was started.
 */
export function windowInput<I>(kept: WindowInput<I> | undefined, retro: Retro | undefined, make: (days: number) => I): WindowInput<I> {
  return kept && kept.seededFrom === retro?.startedAt ? kept : { input: make(retro?.days ?? 14), seededFrom: retro?.startedAt };
}

/** What starting a retro over the last `days` reads first, for the captain to confirm: the sessions no one's read yet, and roughly what that costs. */
export function startReading(engineer: string, days: number, unread: number, costUsd: number): string {
  return unread
    ? `${engineer} first reads the ${unread} sessions of the last ${days} days no one has read yet, for their frictions: roughly $${costUsd.toFixed(2)} of Claude usage, a batch at a time with a pause between. Sessions read before aren’t read again.`
    : `Every session of the last ${days} days has been read already, so this only drafts.`;
}
