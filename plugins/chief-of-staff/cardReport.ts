import type { LedgerEvent } from '../../plugin-api/server';
import { isRecord } from '../../plugin-api/server';
import { type Card, missed, OUTCOMES, summarize } from './cardReplay';

// What card replay (scripts/cardReplay.ts) prints, as lines: who the leads were, the cards summed up per route, and the
// ones the captain needed that were wiped. Pure, so it's tested (cardReport.test.ts); the script reads and prints.

/** Each lead's name and goal: from Focus's saved state for the ones aboard, the ledger's closed goals for the rest. */
export function leadNames(events: readonly LedgerEvent[], saved: unknown): Map<string, { name?: string; goal?: string }> {
  const names = new Map<string, { name?: string; goal?: string }>();
  for (const e of events) if (e.kind === 'goal-closed') names.set(e.goal.id, { name: e.goal.leadName, goal: e.goal.title });
  const agents = isRecord(saved) && Array.isArray(saved.agents) ? saved.agents.filter(isRecord) : [];
  for (const a of agents) if (a.task === 'lead' && typeof a.id === 'string') names.set(a.id, savedLead(a));
  return names;
}

const savedLead = (a: Record<string, unknown>): { name?: string; goal?: string } => ({
  name: typeof a.name === 'string' ? a.name : undefined,
  goal: isRecord(a.lead) && typeof a.lead.title === 'string' ? a.lead.title : undefined,
});

/** A wait, in minutes under an hour and hours past it; a dash for none. */
export const mins = (ms: number | undefined): string => (ms === undefined ? '—' : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`);
const when = (t: number) => new Date(t).toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const ROUTE_NAMES: Record<string, string> = { 1: '1 carry-on', 2: '2 card', 3: '3 interrupt', 4: '4 back-to-lead', unjudged: 'unjudged', all: 'all' };

/** How many of `keys` there are of each, most first, as `a 2, b 1`; `none` when there are none. */
export function tally(keys: readonly string[], none: string): string {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || none;
}

/** The cards summed up: how many, a row per route of how they ended, and what wiped the ones something else did. */
export function summaryLines(cards: readonly Card[], { project, since }: { project?: string; since?: number }): string[] {
  const superseded = cards.filter((c) => c.outcome === 'superseded');
  return [
    '',
    `${cards.length} cards from ${new Set(cards.map((c) => c.agentId)).size} goal leads${project ? ` in ${project}` : ''}${since ? ` since ${when(since)}` : ''}`,
    '',
    `${pad('route', 16)}${OUTCOMES.map((o) => pad(o, 12)).join('')}${pad('total', 8)}median wait`,
    ...summarize(cards).map((row) => `${pad(ROUTE_NAMES[row.route], 16)}${OUTCOMES.map((o) => pad(row.counts[o], 12)).join('')}${pad(row.total, 8)}${mins(row.medianWaitMs)}`),
    '',
    `superseded by: ${tally(superseded.map((c) => String(c.by)), 'nothing')}`,
    `slices landed, merged by: ${tally(superseded.filter((c) => c.by === 'slice-landed').map((c) => c.mergedBy ?? '?'), 'none')}`,
  ];
}

/** The cards the captain needed (route 2 or 3) that something else wiped, three lines each. */
export function missedLines(cards: readonly Card[]): string[] {
  const wiped = missed(cards);
  return ['', `${wiped.length} cards the captain needed (route 2 or 3), wiped by something else before they answered:`, '', ...wiped.flatMap(wipedLines)];
}

function wipedLines(c: Card): string[] {
  const merged = c.mergedBy ? ` (merged by ${c.mergedBy})` : '';
  const spoke = c.captainSpoke ? ' (the captain had said something)' : '';
  return [
    `${when(c.openedAt)}  ${c.lead ?? c.agentId} · ${c.goal ?? '?'}  [route ${c.route}]`,
    `    why: ${(c.why ?? '').slice(0, 140)}`,
    `    wiped by ${c.by}${merged} after ${mins(c.waitMs)}${spoke}: ${c.waker?.text ?? '(no message: Ops started the turn)'}`,
  ];
}
