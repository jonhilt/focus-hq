// The Jev backtest's scoring (README.md#backtesting-jev): routes Jev's raw answers (`jev-backtest`) at every interrupt
// bar, scores each against the captain's labels beside the Haiku and Sonnet runs, and writes the routes at one bar
// in the shape `backtest/score.py` reads. Free and offline: no model is called.
//
//   pnpm run jev-sweep                     the curves, and the routes under PROPOSED_POLICY → backtest/jev-v1.jsonl and jev-v1-blind.jsonl
//   pnpm run jev-sweep --threshold 0.4     the routes at another bar
//   pnpm run jev-sweep --captains-call     the always-the-captain's check counts towards interrupting at the bar too
//   pnpm run jev-sweep --silent-carry-on   a carry-on stays a carry-on (the proposal sends it back to the lead)
//
// Then `python3 score.py jev-v1.jsonl` in the backtest folder scores the held-out turns as Haiku's were, and
// `jev-v1-blind.jsonl` the whole blind sample as Sonnet's was.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isRecord } from '../../../plugin-api/shared';
import { answersOf, JEV_QUESTIONS_VERSION, jevRoute, type Label, PROPOSED_POLICY, type RoutePolicy, scoreBlind, scoreRoutes } from '../jevRoute';
import { parseJsonLines, routesOf, scoreLine } from '../jevRunRules';
import type { CosRoute } from '../shared';

const args = process.argv.slice(2);
const thresholdAt = args.indexOf('--threshold');
const threshold = thresholdAt < 0 ? PROPOSED_POLICY.threshold : Number(args[thresholdAt + 1]);
if (!(threshold >= 0 && threshold <= 1)) throw new Error('--threshold takes a probability, 0 to 1');
const chosen: RoutePolicy = {
  threshold,
  captainsCall: args.includes('--captains-call') || PROPOSED_POLICY.captainsCall,
  noSilentCarryOn: !args.includes('--silent-carry-on') && PROPOSED_POLICY.noSilentCarryOn,
};

const data = path.resolve(process.env.FOCUS_DATA_DIR ?? path.join(os.homedir(), '.focus'));
const cos = path.join(data, 'chief-of-staff');
const backtest = path.join(cos, 'backtest');
const readLines = (file: string): unknown[] => parseJsonLines(readFileSync(file, 'utf8'));
const str = (v: unknown, key: string): string => (isRecord(v) && typeof v[key] === 'string' ? v[key] : '');
const num = (v: unknown, key: string): number => (isRecord(v) && typeof v[key] === 'number' ? v[key] : 0);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const labels = new Map<string, Label>();
for (const l of readLines(path.join(cos, 'labels.jsonl'))) {
  const bucket = num(l, 'bucket');
  if (bucket === 1 || bucket === 2 || bucket === 3) labels.set(str(l, 'id'), { bucket, miss: isRecord(l) && l.miss === true });
}
const days = new Set(readLines(path.join(cos, 'replies.jsonl')).filter((r) => labels.has(str(r, 'id'))).map((r) => str(r, 'at').slice(0, 10))).size;
const test = new Set(strings(JSON.parse(readFileSync(path.join(backtest, 'test.json'), 'utf8'))));
const sample = strings(JSON.parse(readFileSync(path.join(cos, 'blind-sample.json'), 'utf8')));
const captain = readFileSync(path.join(cos, 'captain-blind.txt'), 'utf8');

const raw = path.join(backtest, `${JEV_QUESTIONS_VERSION}-raw.jsonl`);
if (!existsSync(raw)) throw new Error(`no answers yet at ${raw}: run pnpm run jev-backtest first`);
const jev = new Map(readLines(raw).map((r) => [str(r, 'id'), { answers: answersOf(isRecord(r) ? r.answers : undefined), cost: num(r, 'cost'), ms: num(r, 'ms') }]));

/** An earlier run's routes, from its score.py file; with `heldOut`, on the held-out turns alone. */
const earlier = (file: string, heldOut: boolean) =>
  existsSync(path.join(backtest, file)) ? routesOf(readLines(path.join(backtest, file)), heldOut ? (id) => test.has(id) : undefined) : new Map<string, CosRoute>();

const routed = (policy: RoutePolicy) => new Map([...jev].filter(([id]) => test.has(id)).map(([id, j]) => [id, jevRoute(j.answers, policy)]));
const routedBlind = (policy: RoutePolicy) => new Map([...jev].map(([id, j]) => [id, jevRoute(j.answers, policy)]));
const pct = (n: number, of: number) => `${n}/${of}`;

/** One row of the table: the held-out turns' score, and the blind sample's (all of it, and the turns Haiku judged too). */
function row(name: string, routes: Map<string, CosRoute>, blind: Map<string, CosRoute>): string {
  const s = scoreRoutes(routes, labels, days);
  const all = scoreBlind(blind, sample, captain);
  const heldOut = scoreBlind(blind, sample, captain, test);
  return [
    name.padEnd(22),
    pct(s.interruptsCaught, s.interruptsLabelled).padStart(8),
    String(s.silentMisses).padStart(7),
    String(s.interruptsPerDay).padStart(7),
    String(s.cardsPerDay).padStart(6),
    pct(s.agree, s.turns).padStart(8),
    pct(heldOut.agree, heldOut.judged).padStart(7),
    pct(heldOut.caught, heldOut.captainsInterrupts).padStart(6),
    pct(all.agree, all.judged).padStart(7),
    pct(all.caught, all.captainsInterrupts).padStart(6),
  ].join('  ');
}

const header = ['run'.padEnd(22), '3 caught', 'silent', 'int/day', 'cards', 'agree', 'blind13', 'b13 3s', 'blind28', 'b28 3s'].map((h, i) => (i ? h.padStart([8, 7, 7, 6, 8, 7, 6, 7, 6][i - 1]) : h)).join('  ');
const costs = [...jev.values()];
const ms = costs.map((c) => c.ms).sort((a, b) => a - b);
console.log(`${jev.size} turns answered, $${costs.reduce((n, c) => n + c.cost, 0).toFixed(4)}, median ${ms[Math.floor(ms.length / 2)] ?? 0} ms, over ${days} days`);
console.log('"agree" counts route 4 as bucket 1 (LABEL_ROUTES); score.py counts it wrong. blind13 is the blind turns in test.json, the ones Haiku v6b judged.\n');
console.log(header);
for (const [name, file] of [['haiku v6b', 'v6b-haiku.jsonl'], ['sonnet v1', 'v1-sonnet.jsonl']]) {
  const routes = earlier(file, true);
  if (routes.size) console.log(row(name, routes, earlier(file, false)));
}
const curves: [string, Omit<RoutePolicy, 'threshold'>][] = [
  ['the route’s interrupt probability alone', { captainsCall: false }],
  ['the captain’s-call check counting towards interrupting', { captainsCall: true }],
  ['interrupt probability alone, a carry-on sent back to the lead (the proposal)', { captainsCall: false, noSilentCarryOn: true }],
];
for (const [name, curve] of curves) {
  console.log(`\njev, ${name}:`);
  for (let t = 0.05; t < 0.96; t += 0.05) {
    const policy = { ...curve, threshold: Math.round(t * 100) / 100 };
    console.log(row(`  bar ${policy.threshold.toFixed(2)}`, routed(policy), routedBlind(policy)));
  }
}

// Two files, so score.py counts each as it counted Haiku's: the held-out turns alone, and with the blind sample too.
const write = (file: string, ids: (id: string) => boolean) => {
  const lines = [...jev].filter(([id]) => ids(id)).map(([id, j]) => scoreLine(id, j.answers, j.cost, chosen));
  writeFileSync(path.join(backtest, file), `${lines.join('\n')}\n`);
  return file;
};
const files = [write(`${JEV_QUESTIONS_VERSION}.jsonl`, (id) => test.has(id)), write(`${JEV_QUESTIONS_VERSION}-blind.jsonl`, () => true)];
const how = [chosen.captainsCall && 'with the captain’s-call check', chosen.noSilentCarryOn && 'no silent carry-on'].filter(Boolean).join(', ');
console.log(`\nroutes at a bar of ${chosen.threshold}${how ? ` (${how})` : ''} → ${files.join(', ')} in ${backtest}`);
