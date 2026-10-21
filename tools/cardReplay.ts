// Card replay: the life of every card the captain was owed, replayed from Focus's own history (the ledger, each
// goal lead's run journal, state.json), and how each ended: the captain answered, the chief of staff's words went, or
// something else woke the lead first and wiped a card nobody had answered. The rules are in
// server/agents/cardReplay.ts; this reads the files and prints. Read-only, free: no model is called.
//
//   pnpm run card-replay                    every card, summed up, and the ones the captain needed that were wiped
//   pnpm run card-replay --since 3          cards opened in the last 3 days
//   pnpm run card-replay --project <id>     one project's
//   pnpm run card-replay --json <file>      every card's timeline, written to <file>

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type Card, type DecisionFact, itemAgent, type LeadInfo, leadCards, type MergeFact, missed, OUTCOMES, summarize, type VerdictFact } from '../server/agents/cardReplay';
import { paths } from '../server/config';
import { readJournal } from '../server/agents/runJournal';
import { checkLedger, type LedgerEvent } from '../shared/ledger';
import { isRecord } from '../shared/records';

const args = process.argv.slice(2);
/** A flag's value: undefined without the flag, and an error with the flag but no value after it. */
function after(flag: string): string | undefined {
  if (!args.includes(flag)) return undefined;
  const value = args[args.indexOf(flag) + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
  return value;
}
const project = after('--project');
const json = after('--json');
const sinceArg = after('--since');
const sinceDays = sinceArg === undefined ? undefined : Number(sinceArg);
if (sinceDays !== undefined && !(sinceDays > 0)) throw new Error(`--since takes a number of days, not "${sinceArg}"`);
const since = sinceDays ? Date.now() - sinceDays * 86_400_000 : 0;

/** state.json, or nothing when it's missing or can't be read (Focus mid-write): the ledger names the closed goals' leads. */
function readState(): unknown {
  try {
    return JSON.parse(readFileSync(paths.state, 'utf8'));
  } catch {
    return {};
  }
}

const ledger = existsSync(paths.ledger) ? checkLedger(readFileSync(paths.ledger, 'utf8')).events : [];

/** Each lead's name and goal: from state.json for the ones aboard, the ledger's closed goals for the rest. */
function leadNames(events: LedgerEvent[]): Map<string, { name?: string; goal?: string }> {
  const names = new Map<string, { name?: string; goal?: string }>();
  for (const e of events) if (e.kind === 'goal-closed') names.set(e.goal.id, { name: e.goal.leadName, goal: e.goal.title });
  const state = readState();
  const agents = isRecord(state) && Array.isArray(state.agents) ? state.agents : [];
  for (const a of agents.filter(isRecord)) {
    const title = isRecord(a.lead) && typeof a.lead.title === 'string' ? a.lead.title : undefined;
    if (a.task === 'lead' && typeof a.id === 'string') names.set(a.id, { name: typeof a.name === 'string' ? a.name : undefined, goal: title });
  }
  return names;
}

const verdicts: VerdictFact[] = ledger.flatMap((e) => (e.kind === 'cos-verdict' ? [{ sessionId: e.sessionId, route: e.route, why: e.why, ...(e.message && { message: e.message }), at: e.at }] : []));

const merges: MergeFact[] = ledger.flatMap((e) => (e.kind === 'merged' ? [{ repo: e.repo, pr: e.pr, by: e.by }] : []));

/** The captain's inbox answers for each agent, by the agent id in the item's id (by name where it has none). */
function decisionsFor(id: string, name: string | undefined): DecisionFact[] {
  return ledger.flatMap((e) => {
    if (e.kind !== 'captain-decision') return [];
    const agent = itemAgent(e.item.id);
    return (agent ? agent === id : e.agent === name) ? [{ kind: e.item.kind, answer: e.answer, via: e.via, at: e.at }] : [];
  });
}

function allCards(): Card[] {
  const names = leadNames(ledger);
  const files = existsSync(paths.runs) ? readdirSync(paths.runs).filter((f) => /^lead_.+\.jsonl$/.test(f)) : [];
  return files.flatMap((file) => {
    const id = file.replace(/\.jsonl$/, '');
    const lead: LeadInfo = { id, projectId: /^lead_(proj_[^_]+)_/.exec(id)?.[1] ?? '?', ...names.get(id) };
    if (project && lead.projectId !== project) return [];
    const { entries } = readJournal(readFileSync(path.join(paths.runs, file), 'utf8'));
    return leadCards(lead, entries, { verdicts, decisions: decisionsFor(id, lead.name), merges }).filter((c) => c.openedAt >= since);
  }).sort((a, b) => a.openedAt - b.openedAt);
}

const mins = (ms: number | undefined) => (ms === undefined ? '—' : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`);
const when = (t: number) => new Date(t).toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const ROUTE_NAMES: Record<string, string> = { 1: '1 carry-on', 2: '2 card', 3: '3 interrupt', 4: '4 back-to-lead', unjudged: 'unjudged', all: 'all' };

function printSummary(cards: Card[]): void {
  console.log(`\n${cards.length} cards from ${new Set(cards.map((c) => c.agentId)).size} goal leads${project ? ` in ${project}` : ''}${since ? ` since ${when(since)}` : ''}\n`);
  console.log(`${pad('route', 16)}${OUTCOMES.map((o) => pad(o, 12)).join('')}${pad('total', 8)}median wait`);
  for (const row of summarize(cards)) console.log(`${pad(ROUTE_NAMES[row.route], 16)}${OUTCOMES.map((o) => pad(row.counts[o], 12)).join('')}${pad(row.total, 8)}${mins(row.medianWaitMs)}`);
  const by = new Map<string, number>();
  for (const c of cards.filter((x) => x.outcome === 'superseded')) by.set(String(c.by), (by.get(String(c.by)) ?? 0) + 1);
  console.log(`\nsuperseded by: ${[...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'nothing'}`);
  const mergers = new Map<string, number>();
  for (const c of cards.filter((x) => x.outcome === 'superseded' && x.by === 'slice-landed')) mergers.set(c.mergedBy ?? '?', (mergers.get(c.mergedBy ?? '?') ?? 0) + 1);
  console.log(`slices landed, merged by: ${[...mergers].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
}

function printMissed(cards: Card[]): void {
  const wiped = missed(cards);
  console.log(`\n${wiped.length} cards the captain needed (route 2 or 3), wiped by something else before they answered:\n`);
  for (const c of wiped) {
    console.log(`${when(c.openedAt)}  ${c.lead ?? c.agentId} · ${c.goal ?? '?'}  [route ${c.route}]`);
    console.log(`    why: ${(c.why ?? '').slice(0, 140)}`);
    const merged = c.mergedBy ? ` (merged by ${c.mergedBy})` : '';
    console.log(`    wiped by ${c.by}${merged} after ${mins(c.waitMs)}${c.captainSpoke ? ' (the captain had said something)' : ''}: ${c.waker?.text ?? '(no message: Ops started the turn)'}`);
  }
}

const cards = allCards();
printSummary(cards);
printMissed(cards);
if (json) {
  writeFileSync(json, `${JSON.stringify(cards, null, 2)}\n`);
  console.log(`\nWrote ${cards.length} cards to ${json}`);
}
