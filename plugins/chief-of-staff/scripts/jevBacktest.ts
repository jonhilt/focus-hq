// The Jev backtest (README.md#backtesting-jev): asks TypeSafe's Jev where each held-out lead turn goes, one request
// per turn with all its questions, and keeps Jev's raw answers, so routing them at any bar (`jev-sweep`) is free.
// The turns, labels and standing orders are the captain's, in the data folder, never in the repo. The questions
// and the routing rules are in ../jevRoute.ts; this reads the files, calls Jev and writes.
//
//   pnpm run jev-backtest --dry-run        what it would send: the call count, one request in full, the cost
//   pnpm run jev-backtest                  every turn of backtest/test.json and the blind sample (needs TYPESAFE_API_KEY)
//   pnpm run jev-backtest --limit 5        the first five not yet answered
//   pnpm run jev-backtest --set fresh      the fresh sample (`jev-fresh`), into fresh/ instead
//
// Answers go to `<data>/chief-of-staff/backtest/<questions version>-raw.jsonl`, a line a turn; a rerun skips the
// turns already there. It stops before it would spend more than $1.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isRecord } from '../../../plugin-api/shared';
import { judgePrompt } from '../judge';
import { JEV_BACKTEST_MODEL, JEV_QUESTIONS_VERSION, JEV_USD_PER_INPUT_TOKEN, routeQuestions } from '../jevRoute';
import { type JevReply, parseJsonLines, readReply, retryDelay, stopReason } from '../jevRunRules';

const JEV_URL = process.env.FOCUS_JEV_URL || 'https://api.typesafe.ai/v1/systemone';
const BUDGET_USD = 1;
const PARALLEL = 4;
const TIMEOUT_MS = 20_000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitAt = args.indexOf('--limit');
const limit = limitAt < 0 ? Infinity : Number(args[limitAt + 1]);
if (!(limit > 0)) throw new Error('--limit takes a number of turns');

const data = path.resolve(process.env.FOCUS_DATA_DIR ?? path.join(os.homedir(), '.focus'));
const cos = path.join(data, 'chief-of-staff');
// The backtest's held-out turns and blind sample, or with --set fresh the fresh sample `jev-fresh` picked.
const freshSet = args.includes('--set') && args[args.indexOf('--set') + 1] === 'fresh';
const folder = path.join(cos, freshSet ? 'fresh' : 'backtest');
const out = path.join(folder, `${JEV_QUESTIONS_VERSION}-raw.jsonl`);
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const readLines = (file: string): unknown[] => parseJsonLines(readFileSync(file, 'utf8'));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const field = (v: unknown, key: string): string | undefined => {
  const value = isRecord(v) ? v[key] : undefined;
  return typeof value === 'string' ? value : undefined;
};

const ordersFile = path.join(data, 'plugins', 'chief-of-staff', 'standing-orders.txt');
const orders = existsSync(ordersFile) ? readFileSync(ordersFile, 'utf8') : undefined;
const questions = routeQuestions(orders);

const wanted = freshSet
  ? strings(readJson(path.join(folder, 'sample.json')))
  : [...new Set([...strings(readJson(path.join(cos, 'backtest', 'test.json'))), ...strings(readJson(path.join(cos, 'blind-sample.json')))])];
const turnsFile = freshSet ? path.join(folder, 'turns.jsonl') : path.join(cos, 'replies.jsonl');
const turns = new Map(readLines(turnsFile).map((r) => [field(r, 'id') ?? '', { goal: field(r, 'goal'), lead: field(r, 'lead') ?? '' }]));
const done = new Set(existsSync(out) ? readLines(out).map((r) => field(r, 'id')) : []);
const todo = wanted.filter((id) => turns.has(id) && !done.has(id)).slice(0, limit);
const missing = wanted.filter((id) => !turns.has(id));
if (missing.length) console.warn(`${missing.length} turns aren't in replies.jsonl: skipped`);

const body = (id: string) => {
  const t = turns.get(id) ?? { goal: undefined, lead: '' };
  return { model: JEV_BACKTEST_MODEL, state: judgePrompt(t.goal, t.lead), questions };
};

console.log(`${wanted.length} turns, ${done.size} answered already, ${todo.length} to ask (${JEV_BACKTEST_MODEL}, ${JEV_QUESTIONS_VERSION})`);
console.log(`standing orders: ${orders ? ordersFile : 'none'}`);

if (dryRun) {
  const chars = todo.reduce((n, id) => n + JSON.stringify(body(id)).length, 0);
  const tokens = Math.round(chars / 4);
  console.log(`\none request in full:\n${JSON.stringify(body(todo[0] ?? wanted[0] ?? ''), null, 2)}`);
  console.log(`\nabout ${tokens.toLocaleString()} input tokens (a token per 4 characters): about $${(tokens * JEV_USD_PER_INPUT_TOKEN).toFixed(3)}`);
  process.exit(0);
}

const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error('TYPESAFE_API_KEY isn’t set: run with --dry-run to see what it would send');

/** Asks Jev about one turn, asking again while `retryDelay` says to. */
async function ask(id: string, attempt = 1): Promise<{ reply: JevReply; ms: number }> {
  const started = Date.now();
  const res = await fetch(JEV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body(id)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  const wait = retryDelay(res.status, attempt);
  if (wait !== undefined) {
    await new Promise((r) => setTimeout(r, wait));
    return ask(id, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  const reply = readReply(JSON.parse(text));
  if (!reply) throw new Error(`no answers in the reply: ${text.slice(0, 300)}`);
  return { reply, ms: Date.now() - started };
}

/** Asks about one turn and keeps its answers, counting what it cost or that it failed. */
async function answer(run: { spent: number; failed: number }, id: string) {
  try {
    const { reply, ms } = await ask(id);
    const cost = reply.inputTokens * JEV_USD_PER_INPUT_TOKEN;
    run.spent += cost;
    const line = { id, version: JEV_QUESTIONS_VERSION, model: reply.model ?? JEV_BACKTEST_MODEL, answers: reply.answers, inputTokens: reply.inputTokens, cost, ms };
    appendFileSync(out, `${JSON.stringify(line)}\n`);
  } catch (err) {
    run.failed++;
    console.error(`${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const run: { spent: number; failed: number; asked: number; budget: number; stopped?: ReturnType<typeof stopReason> } = { spent: 0, failed: 0, asked: 0, budget: BUDGET_USD };
async function worker() {
  while (run.asked < todo.length && !run.stopped) {
    await answer(run, todo[run.asked++]);
    run.stopped = stopReason(run);
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
const why = { budget: ': stopped at the budget', failing: ': stopped, more than half the calls failing' };
console.log(`asked ${run.asked}, ${run.failed} failed, $${run.spent.toFixed(4)}${run.stopped ? why[run.stopped] : ''} → ${out}`);
if (run.stopped === 'failing') process.exitCode = 1;
