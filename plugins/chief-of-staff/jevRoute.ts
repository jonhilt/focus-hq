import { isRecord } from '../../plugin-api/shared';
import type { CosRoute } from './shared';

// The Jev backtest's rules (README.md#backtesting-jev): what TypeSafe's System One model is asked about a lead's
// ended turn, how its answers become one of the four routes, and how a run is scored against the captain's labels.
// Offline only: the live judge doesn't use any of it.

/** The model the backtest asks: pinned, since `jev-latest` lags the newest release. */
export const JEV_BACKTEST_MODEL = 'jev-1.14.0';

/** Kept on every answer, so runs with different questions aren't scored as one. */
export const JEV_QUESTIONS_VERSION = 'jev-v1';

/** TypeSafe's price for Jev's input; its output is free. */
export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

/** A question for Jev: yes or no (a probability of yes), or one of a few named options. */
export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> };

/** One answer, as Jev sends it: `noul` for yes or no, `choice` and its `probabilities` for a choice. */
export interface JevAnswer {
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

const numberOr = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Jev's answers, as far as they're answers: each kept by its question's key, with only the fields that read right. */
export function answersOf(v: unknown): Record<string, JevAnswer> {
  if (!isRecord(v)) return {};
  return Object.fromEntries(Object.entries(v).flatMap(([key, a]) => {
    if (!isRecord(a)) return [];
    const probabilities = isRecord(a.probabilities)
      ? Object.fromEntries(Object.entries(a.probabilities).flatMap(([k, p]) => (numberOr(p) === undefined ? [] : [[k, Number(p)]])))
      : undefined;
    const answer: JevAnswer = {
      ...(numberOr(a.noul) !== undefined && { noul: numberOr(a.noul) }),
      ...(typeof a.choice === 'string' && { choice: a.choice }),
      ...(probabilities && { probabilities }),
      ...(numberOr(a.confidence) !== undefined && { confidence: numberOr(a.confidence) }),
    };
    return [[key, answer]];
  }));
}

/** The route question's options, each a route. */
export const ROUTE_OPTIONS = { carry_on: 1, card: 2, interrupt: 3, back_to_lead: 4 } as const satisfies Record<string, CosRoute>;
type RouteOption = keyof typeof ROUTE_OPTIONS;

const ALWAYS_HEADING = "ALWAYS THE CAPTAIN'S";

/**
 * The standing orders file in its two parts: what the captain has wanted in turns like this (`orders`), and what's
 * always theirs to decide (`always`, under its heading). Each a list of lines, the headings left out.
 */
export function splitOrders(text: string | undefined): { orders: string[]; always: string[] } {
  const lines = (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const at = lines.findIndex((l) => l.toUpperCase() === ALWAYS_HEADING);
  const heading = (l: string) => l.toUpperCase() === 'STANDING ORDERS';
  const orders = (at < 0 ? lines : lines.slice(0, at)).filter((l) => !heading(l));
  return { orders, always: at < 0 ? [] : lines.slice(at + 1) };
}

const bullets = (lines: string[]) => lines.map((l) => `- ${l}`).join('\n');

/**
 * The questions for one turn, asked in one request: the route as a choice of the four (the live judge's rules,
 * `judge.ts`, as each option's criterion), and three yes-or-no checks the rules hang on. The standing orders go
 * into the criteria they bear on: the orders on how to work into going back to the lead, and what's always the
 * captain's into interrupting and its own check.
 */
export function routeQuestions(standingOrders: string | undefined): Record<string, JevQuestion> {
  const { orders, always } = splitOrders(standingOrders);
  const alwaysList = always.length ? `\nAlways the captain's:\n${bullets(always)}` : '';
  const ordersList = orders.length ? `\nThe captain's standing orders, learned from their past replies:\n${bullets(orders)}` : '';
  const criteria: Record<RouteOption, string> = {
    carry_on:
      'Nothing is being decided: progress within the slice already under way with the next step stated, or waiting on something that is not the captain. Starting a new slice is never this.',
    card:
      "A real decision of the captain's with a clear recommendation from the lead: design, scope or next-slice choices, a slice shipping, or the goal being proposed for closing. A standing order never turns this into carrying on.",
    interrupt:
      `The captain must be told now: facts only the captain has; options with no recommendation; production data, permissions, money, licences, security, or anything outward-facing not already approved; the lead contradicting a decision of the captain's; the goal's direction in question. Spending money is always this.${alwaysList}`,
    back_to_lead:
      `The lead can sort it out itself: information it can find in the code, docs or by testing; a message that is unclear or missing a recommendation; being stuck on something it can unblock (merging its own PRs, re-running checks); or a standing order covers how to work (not what to build).${ordersList}`,
  };
  return {
    route: {
      type: 'choice',
      instructions:
        "A software goal's lead (an AI coding agent) has just ended its turn; the state is the goal and the end of what it said. Where should this turn go?",
      criteria,
    },
    spends_money: {
      type: 'noul',
      instructions: 'Does the lead ask to spend real money (paid API or agent runs, paid services, subscriptions, anything bought) that the captain has not already approved?',
    },
    captains_call: {
      type: 'noul',
      instructions: `Does the lead's turn ask for something that is always the captain's to decide?${alwaysList || "\nAlways the captain's: production, permissions, money, licences, security, and what users see."}`,
    },
    new_slice: {
      type: 'noul',
      instructions: 'Does the lead propose starting a new slice of work, shipping one, or closing the goal, and wait for a go-ahead?',
    },
  };
}

/** How answers become a route: the interrupt bar, and whether the always-the-captain's check counts towards it. */
export interface RoutePolicy {
  /** The least probability of interrupting that interrupts. */
  threshold: number;
  /** Interrupt on the always-the-captain's check too, at the same bar. */
  captainsCall: boolean;
  /**
   * Send a carry-on back to the lead instead, where the captain sees it in the log: in the first run, Jev's
   * carry-on was a turn the captain had something to add to on 18 of its 25 picks.
   */
  noSilentCarryOn?: boolean;
}

/**
 * What the first run (jev-1.14.0, jev-v1) argued for: 37 of 160 labelled interrupts caught to Haiku v6b's 25, none
 * silently missed to its 9, at 3.5 interrupts a day to its 2.8. Picked on those same turns, so it's to be checked
 * on fresh ones before the live judge goes by it.
 */
export const PROPOSED_POLICY: RoutePolicy = { threshold: 0.3, captainsCall: false, noSilentCarryOn: true };

/** The yes-or-no checks' bar: at or above it, the check says yes. */
const YES = 0.5;

const probabilityOf = (a: JevAnswer | undefined, option: RouteOption): number =>
  a?.probabilities?.[option] ?? (a?.choice === option ? 1 : 0);

/** What interrupting rests on, from the answers: the route's probability, or with `captainsCall` the check's if higher. */
export function interruptSignal(answers: Readonly<Record<string, JevAnswer>>, captainsCall: boolean): number {
  const p = probabilityOf(answers.route, 'interrupt');
  return captainsCall ? Math.max(p, answers.captains_call?.noul ?? 0) : p;
}

/**
 * The route for a turn, from Jev's answers: spending money interrupts whatever the route says (the live judge's
 * rule); so does an interrupt signal at the policy's bar. Under it, the likeliest of the other three, and a new
 * slice or the captain's own call is never left with the lead (1 or 4): it's a card. With `noSilentCarryOn`, a
 * carry-on goes back to the lead.
 */
export function jevRoute(answers: Readonly<Record<string, JevAnswer>>, policy: RoutePolicy): CosRoute {
  if ((answers.spends_money?.noul ?? 0) >= YES) return 3;
  if (interruptSignal(answers, policy.captainsCall) >= policy.threshold) return 3;
  const rest: RouteOption[] = ['card', 'back_to_lead', 'carry_on'];
  const best = rest.reduce((a, b) => (probabilityOf(answers.route, b) > probabilityOf(answers.route, a) ? b : a));
  const captains = (answers.new_slice?.noul ?? 0) >= YES || (answers.captains_call?.noul ?? 0) >= YES;
  if (best !== 'card' && captains) return 2;
  return best === 'carry_on' && policy.noSilentCarryOn ? 4 : ROUTE_OPTIONS[best];
}

// The captain's labels (`labels.jsonl`) have three buckets, from what they actually did with the turn: 1 they needed
// nothing (it could have carried on, or been sent back), 2 they took the lead's default, 3 they brought something
// the lead couldn't have had (a redirect, a new idea, a fact of theirs: an interrupt). So bucket 1 is routes 1 and
// 4, bucket 2 route 2, and bucket 3 route 3. `score.py` compares a route to the bucket as a number, so it counts
// route 4 on a bucket-1 turn as wrong, for every judge alike; `agreesWithLabel` counts it right.

/** The routes a label's bucket stands for. */
export const LABEL_ROUTES: Readonly<Record<1 | 2 | 3, readonly CosRoute[]>> = { 1: [1, 4], 2: [2], 3: [3] };

export const agreesWithLabel = (bucket: 1 | 2 | 3, route: CosRoute): boolean => LABEL_ROUTES[bucket].includes(route);

/** A labelled turn: its bucket, and whether the lead's words gave no sign it was the captain's (`miss`). */
export interface Label {
  bucket: 1 | 2 | 3;
  miss?: boolean;
}

/** How a run of routes scores, as `score.py` counts it (and with route 4 counted as bucket 1, `agree`). */
export interface Score {
  turns: number;
  interruptsCaught: number;
  interruptsLabelled: number;
  /** Labelled-3 turns routed to carry on: missed silently, the worst miss. */
  silentMisses: number;
  interruptsPerDay: number;
  cardsPerDay: number;
  /** Routes that are the label's own bucket, route 4 counting as bucket 1. */
  agree: number;
}

/** Scores routes against labels over `days` days; only turns with both count. */
export function scoreRoutes(routes: ReadonlyMap<string, CosRoute>, labels: ReadonlyMap<string, Label>, days: number): Score {
  const common = [...routes.keys()].filter((id) => labels.has(id));
  const route = (id: string) => routes.get(id) ?? 1;
  const label = (id: string) => labels.get(id)?.bucket ?? 1;
  const b3 = common.filter((id) => label(id) === 3);
  const count = (ids: string[], r: CosRoute) => ids.filter((id) => route(id) === r).length;
  const perDay = (n: number) => (days ? Math.round((n / days) * 10) / 10 : 0);
  return {
    turns: common.length,
    interruptsCaught: count(b3, 3),
    interruptsLabelled: b3.length,
    silentMisses: count(b3, 1),
    interruptsPerDay: perDay(count(common, 3)),
    cardsPerDay: perDay(count(common, 2)),
    agree: common.filter((id) => agreesWithLabel(label(id), route(id))).length,
  };
}

/** How a run of routes does on the captain's blind sample, as `score.py` counts it: the same bucket, and their 3s caught. */
export interface BlindScore {
  judged: number;
  agree: number;
  caught: number;
  captainsInterrupts: number;
}

/**
 * Scores routes against the captain's blind labels (`captain-blind.txt`: "n:bucket", n counting from 1 into the
 * sample's ids). Only the sample's turns in `routes` count, and `only` narrows them further (to compare with a run
 * that judged fewer).
 */
export function scoreBlind(routes: ReadonlyMap<string, CosRoute>, sample: readonly string[], captain: string, only?: ReadonlySet<string>): BlindScore {
  const pairs = captain.split(/\s+/).filter(Boolean).flatMap((pair) => {
    const [n, bucket] = pair.split(':').map(Number);
    const id = sample[n - 1];
    const route = id === undefined ? undefined : routes.get(id);
    return route === undefined || ![1, 2, 3].includes(bucket) || (only && !only.has(id)) ? [] : [{ bucket, route }];
  });
  return {
    judged: pairs.length,
    agree: pairs.filter((p) => p.bucket === p.route).length,
    caught: pairs.filter((p) => p.bucket === 3 && p.route === 3).length,
    captainsInterrupts: pairs.filter((p) => p.bucket === 3).length,
  };
}
