// The Jev backtest's fresh check (README.md#backtesting-jev): a sample of lead turns since the backtest's own, for
// the captain to label, and then Jev's routes on them scored against those labels beside the live judge's. Its
// rules are in ../jevFresh.ts; this reads the ledger and the captain's labels, and writes and prints.
//
//   pnpm run jev-fresh                      picks the sample → <data>/chief-of-staff/fresh/ (sample.json, turns.jsonl, cards.html)
//   pnpm run jev-fresh --since 2026-10-20 --count 30 --per-goal 3
//   pnpm run jev-backtest --set fresh       asks Jev about them (needs TYPESAFE_API_KEY)
//   pnpm run jev-fresh --score              scores Jev and the live judge against fresh/captain.txt
//
// A sample already there isn't replaced (the captain's labels are numbered into it) unless --force.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { focusLedger } from '../../../plugin-api/server';
import { answersById, freshTurns, labelCards, liveRoutes, pickSample } from '../jevFresh';
import { JEV_QUESTIONS_VERSION, jevRoute, PROPOSED_POLICY, type RoutePolicy, scoreBlind } from '../jevRoute';
import { parseJsonLines } from '../jevRun';
import type { CosRoute } from '../shared';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? fallback) : fallback);
const data = path.resolve(process.env.FOCUS_DATA_DIR ?? path.join(os.homedir(), '.focus'));
const fresh = path.join(data, 'chief-of-staff', 'fresh');
const file = (name: string) => path.join(fresh, name);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Picks the sample from the ledger and writes it, with its turns and its labelling page. */
function sample() {
  if (existsSync(file('sample.json')) && !args.includes('--force')) throw new Error(`${file('sample.json')} is there already: --force to replace it (and its labels)`);
  const events = focusLedger().events ?? [];
  // This goal's own turns are about Jev, so they're left out.
  const turns = freshTurns(events, flag('--since', '2026-10-20'), (goal) => /\bjev\b/i.test(goal ?? ''));
  const rank = (id: string) => createHash('sha256').update(id).digest('hex');
  const picked = pickSample(turns, Number(flag('--count', '30')), Number(flag('--per-goal', '3')), rank);
  mkdirSync(fresh, { recursive: true });
  writeFileSync(file('sample.json'), `${JSON.stringify(picked.map((t) => t.id), null, 1)}\n`);
  writeFileSync(file('turns.jsonl'), picked.map((t) => `${JSON.stringify(t)}\n`).join(''));
  writeFileSync(file('cards.html'), labelCards(picked));
  const live = picked.filter((t) => t.live).length;
  console.log(`${turns.length} turns since then; picked ${picked.length} from ${new Set(picked.map((t) => t.goal)).size} goals, ${live} with a live verdict`);
  console.log(`label them at ${file('cards.html')}, then put the line it gives you in ${file('captain.txt')}`);
}

/** One row of the fresh table. */
function row(name: string, routes: ReadonlyMap<string, CosRoute>, ids: string[], captain: string): string {
  const s = scoreBlind(routes, ids, captain);
  const cells = [`${s.agree}/${s.judged}`, `${s.agreeMapped}/${s.judged}`, `${s.caught}/${s.captainsInterrupts}`, String(s.silent), String(s.interrupts)];
  return [name.padEnd(34), ...cells.map((c) => c.padStart(9))].join(' ');
}

/** Scores Jev's routes (at the proposed policy and a few bars around it) and the live judge's against the captain's labels. */
function score() {
  if (!existsSync(file('captain.txt'))) throw new Error(`no labels yet: label ${file('cards.html')} and put its line in ${file('captain.txt')}`);
  const captain = readFileSync(file('captain.txt'), 'utf8');
  const ids = strings(JSON.parse(readFileSync(file('sample.json'), 'utf8')));
  const read = (name: string) => (existsSync(file(name)) ? parseJsonLines(readFileSync(file(name), 'utf8')) : []);
  const live = liveRoutes(read('turns.jsonl'));
  const answers = answersById(read(`${JEV_QUESTIONS_VERSION}-raw.jsonl`));
  const jev = (policy: RoutePolicy) => new Map([...answers].map(([id, a]) => [id, jevRoute(a, policy)]));
  console.log(`${ids.length} turns, ${answers.size} answered by Jev, ${live.size} read by the live judge. "agree 4~1" counts back-to-the-lead as bucket 1.\n`);
  console.log(['run'.padEnd(34), ...['agree', 'agree 4~1', '3s caught', 'silent', 'interrupt'].map((h) => h.padStart(9))].join(' '));
  console.log(row('live judge (Haiku, its version then)', live, ids, captain));
  console.log(row('jev, PROPOSED_POLICY', jev(PROPOSED_POLICY), ids, captain));
  for (const threshold of [0.2, 0.25, 0.35, 0.4, 0.5]) console.log(row(`  jev, bar ${threshold.toFixed(2)}`, jev({ ...PROPOSED_POLICY, threshold }), ids, captain));
}

if (args.includes('--score')) score();
else sample();
