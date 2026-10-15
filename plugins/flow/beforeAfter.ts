// Before and after a change to how agents are steered (a CLAUDE.md, a prompt): the same window of the ledger either side
// of a moment, per session, so a change can be judged by what agents did rather than by feel. Pure; scripts/beforeAfter.ts
// reads the ledger.
import { type AgentTask, FRICTION_KINDS, frictionsByDigest, type FrictionKind, type LedgerEvent, type SessionFacts } from '../../plugin-api/shared';

const DAY = 24 * 60 * 60 * 1000;
/** Fewer sessions than this on either side and a difference is more likely luck than the change. */
export const FEW_SESSIONS = 20;

type Digest = Extract<LedgerEvent, { kind: 'session-digest' }>;
const PER_SESSION = ['turns', 'toolCalls', 'wastedCalls', 'refusedCalls', 'captainMessages', 'nudges', 'compactions', 'costUsd'] as const;
type PerSession = (typeof PER_SESSION)[number];

export interface WindowStats {
  from: number;
  to: number;
  sessions: number;
  /** Each fact's mean over the window's sessions (cost over those that know theirs). */
  perSession: Record<PerSession, number>;
  /** Sessions read for frictions, and how many of them hit each kind at least once. */
  read: number;
  frictions: Record<FrictionKind, number>;
  verdicts: number;
  passed: number;
  merged: number;
  mergedFirstTime: number;
}

export interface Filter {
  projectId?: string;
  task?: AgentTask;
}

/** The ledger between `from` and `to` (from included), summed up per session. */
export function windowStats(events: LedgerEvent[], from: number, to: number, filter: Filter = {}): WindowStats {
  const inWindow = events.filter((e) => e.at >= from && e.at < to && (!filter.projectId || e.projectId === filter.projectId));
  const digests = inWindow.filter((e): e is Digest => e.kind === 'session-digest' && (!filter.task || e.task === filter.task));
  const mean = (fact: keyof SessionFacts) => {
    const known = digests.map((d) => d.facts[fact]).filter((v): v is number => typeof v === 'number');
    return known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  };
  const found = frictionsByDigest(events);
  const read = digests.filter((d) => found.has(d.key));
  const frictions = Object.fromEntries(Object.keys(FRICTION_KINDS).map((k) => [k, read.filter((d) => found.get(d.key)?.some((f) => f.kind === k)).length])) as Record<FrictionKind, number>;
  // QA and merges belong to pull requests, not sessions: a task filter leaves them as they are.
  const verdicts = inWindow.filter((e) => e.kind === 'qa-verdict');
  const merged = inWindow.filter((e) => e.kind === 'merged');
  return {
    from,
    to,
    sessions: digests.length,
    perSession: Object.fromEntries(PER_SESSION.map((f) => [f, mean(f)])) as Record<PerSession, number>,
    read: read.length,
    frictions,
    verdicts: verdicts.length,
    passed: verdicts.filter((e) => e.verdict === 'pass').length,
    merged: merged.length,
    mergedFirstTime: merged.filter((e) => e.qa === 'passed' && e.failedRounds === 0).length,
  };
}

/** The `days` before `at` against the `days` after it, the after side ending at `now` if that's sooner. */
export function beforeAfter(events: LedgerEvent[], at: number, days: number, now: number, filter: Filter = {}): { before: WindowStats; after: WindowStats } {
  return { before: windowStats(events, at - days * DAY, at, filter), after: windowStats(events, at, Math.min(at + days * DAY, now), filter) };
}

const LABELS: Record<PerSession, string> = {
  turns: 'turns',
  toolCalls: 'tool calls',
  wastedCalls: 'wasted calls',
  refusedCalls: 'refused calls',
  captainMessages: 'captain messages',
  nudges: 'captain nudges',
  compactions: 'compactions',
  costUsd: 'cost ($)',
};

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');
const change = (b: number, a: number) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : a ? 'new' : '');
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The two windows side by side, as the terminal prints them. Lower is better on every line but QA's. */
export function beforeAfterLines({ before, after }: { before: WindowStats; after: WindowStats }): string[] {
  const row = (label: string, b: string, a: string, d = '') => `${label.padEnd(28)}${b.padStart(14)}${a.padStart(14)}${d.padStart(8)}`;
  const lines = [
    row('', 'before', 'after'),
    row('', day(before.from), day(after.from)),
    row('', `to ${day(before.to)}`, `to ${day(after.to)}`),
    row('sessions', String(before.sessions), String(after.sessions)),
    '',
    'Per session',
    ...Object.entries(LABELS).map(([k, label]) => {
      const [b, a] = [before.perSession[k as PerSession], after.perSession[k as PerSession]];
      return row(`  ${label}`, num(b), num(a), change(b, a));
    }),
    '',
    `Sessions hitting each friction (of those read: ${before.read} before, ${after.read} after)`,
    ...(Object.keys(FRICTION_KINDS) as FrictionKind[])
      .filter((k) => before.frictions[k] || after.frictions[k])
      .map((k) => row(`  ${k}`, pct(before.frictions[k], before.read), pct(after.frictions[k], after.read))),
    '',
    'Pull requests',
    row('  QA passed', pct(before.passed, before.verdicts), pct(after.passed, after.verdicts)),
    row('  merged first time', pct(before.mergedFirstTime, before.merged), pct(after.mergedFirstTime, after.merged)),
  ];
  const few = Math.min(before.sessions, after.sessions);
  if (few < FEW_SESSIONS) lines.push('', `⚠ Only ${few} sessions on one side: a difference this small a sample shows is likely luck. Wait for more.`);
  return lines;
}
