// The captain's log: what happened across the ship, from every journal (each agent's run, each QA review, each goal's
// slices) and the ledger, on one timeline (built by log.ts). What's here is what both halves need of it: a line's
// shape, how far back the log reads, and what happened while you were away, in a sentence or two.

/** The plugin's id: in FOCUS_PLUGINS, and its routes' prefix. */
export const CAPTAINS_LOG = 'captains-log';

export type LogTone = 'ok' | 'bad' | 'warn' | 'info';

/** Where a line of the log comes from: an agent's run journal, a PR's review journal, a goal's slice journal, or the ledger. */
export type LogSource = 'run' | 'review' | 'slice' | 'ledger';

/** What a line is, for counting what happened while you were away. */
export type LogKind =
  | 'shipped'
  | 'ship-failed'
  | 'moved'
  | 'started'
  | 'pr'
  | 'merged'
  | 'closed'
  | 'pass'
  | 'fail'
  | 'held'
  | 'unheld'
  | 'interrupted'
  | 'restarted'
  | 'failed'
  | 'stopped'
  | 'asked'
  | 'answered'
  | 'mismatch'
  | 'testing'
  | 'other';

export interface LogLine {
  t: number;
  /** Who it's about: a crew member, QA, the office. */
  who: string;
  source: LogSource;
  kind: LogKind;
  /** A word or two on its pill. */
  tag: string;
  tone: LogTone;
  text: string;
  /** Words quoted in full under the line: what the chief of staff would have said, and to whom. */
  quotes?: string[];
  /** The room, the goal (its title) and the crew member it's about, for the log's filters. */
  projectId?: string;
  goal?: string;
  agentId?: string;
}

const DAY = 24 * 60 * 60_000;

/** How far back the log reads: from `asked` (a time), within the last week, or the last day when it's not one. */
export function logSince(now: number, asked: number): number {
  if (!Number.isFinite(asked) || asked <= 0) return now - DAY;
  return Math.max(asked, now - 7 * DAY);
}

/** What happened while you were away, counted: each kind of line, and how many times Focus restarted. */
export interface AwaySummary {
  since: number;
  lines: number;
  counts: Partial<Record<LogKind, number>>;
  /** Restarts, told by the turns and reviews they cut off: one per minute they fell in. */
  restarts: number;
}

/** The lines since `since`, counted. */
export function awaySummary(lines: readonly LogLine[], since: number): AwaySummary {
  const counts: Partial<Record<LogKind, number>> = {};
  const restarts = new Set<number>();
  let n = 0;
  for (const line of lines) {
    if (line.t <= since) continue;
    n++;
    counts[line.kind] = (counts[line.kind] ?? 0) + 1;
    if (line.kind === 'interrupted' || line.kind === 'restarted') restarts.add(Math.floor(line.t / 60_000));
  }
  return { since, lines: n, counts, restarts: restarts.size };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The summary in a few phrases, the ones with something in them: "2 slices shipped · 1 merged · QA passed 3, failed 1". */
export function awayPhrases(s: AwaySummary): string[] {
  const c = (k: LogKind) => s.counts[k] ?? 0;
  const qa = [c('pass') ? `passed ${c('pass')}` : '', c('fail') ? `failed ${c('fail')}` : ''].filter(Boolean).join(', ');
  return [
    c('shipped') ? `${plural(c('shipped'), 'slice')} shipped` : '',
    c('merged') ? `${c('merged')} merged` : '',
    qa ? `QA ${qa}` : '',
    c('held') ? `${plural(c('held'), 'hold')} for your plan's limit` : '',
    s.restarts ? `Focus restarted ${s.restarts === 1 ? 'once' : `${s.restarts} times`}` : '',
    c('failed') + c('ship-failed') ? `${plural(c('failed') + c('ship-failed'), 'failure')}` : '',
    c('asked') ? `${plural(c('asked'), 'hand')} up` : '',
  ].filter(Boolean);
}
