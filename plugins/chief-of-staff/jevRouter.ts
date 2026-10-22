import { JEV_BACKTEST_MODEL, JEV_QUESTIONS_VERSION, JEV_USD_PER_INPUT_TOKEN, type JevAnswer, jevRoute, PROPOSED_POLICY, interruptSignal, routeQuestions, type RoutePolicy } from './jevRoute';
import { readReply } from './jevRun';
import type { CosRoute } from './shared';

// The live judge's route from Jev (README.md#how-it-judges-a-turn), in a project the captain has switched Route with Jev
// on for: the backtest's questions and its proposed policy, asked of TypeSafe's API. Haiku still writes the words, for
// the route Jev picked; when Jev can't answer, Haiku routes as it always has.

export const JEV_URL = process.env.FOCUS_JEV_URL || 'https://api.typesafe.ai/v1/systemone';

/** Long enough for a busy moment (Jev answers in well under a second), short of the turn's hold (`JUDGING_MS`). */
const TIMEOUT_MS = 10_000;

/** What a verdict keeps of how Jev got to its route (its `router`, less who). */
export interface JevHow {
  model: string;
  /** The questions' version, so verdicts from different questions aren't read as one. */
  version: string;
  /** What interrupting rested on (`interruptSignal`). */
  interrupt: number;
  choice?: string;
  confidence?: number;
  costUsd: number;
}

/** Jev's route for a turn, and how it got there. */
export interface JevRouting {
  route: CosRoute;
  how: JevHow;
}

/** Who routes a turn before Haiku writes its words: Jev, or a fake in a test. */
export interface Router {
  route(state: string, standingOrders: string | undefined): Promise<JevRouting>;
}

/** Jev's answers made a route under `policy`, with what the verdict keeps of them. */
export function routingOf(answers: Readonly<Record<string, JevAnswer>>, inputTokens: number, policy: RoutePolicy = PROPOSED_POLICY): JevRouting {
  const route = answers.route;
  return {
    route: jevRoute(answers, policy),
    how: {
      model: JEV_BACKTEST_MODEL,
      version: JEV_QUESTIONS_VERSION,
      interrupt: interruptSignal(answers, policy.captainsCall),
      ...(route?.choice !== undefined && { choice: route.choice }),
      ...(route?.confidence !== undefined && { confidence: route.confidence }),
      costUsd: inputTokens * JEV_USD_PER_INPUT_TOKEN,
    },
  };
}

type Fetch = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

/** Jev over HTTP, with the TypeSafe key as it is when asked (none: it fails, and Haiku routes). */
export class JevRouter implements Router {
  constructor(
    private readonly key: () => string | undefined,
    private readonly fetcher: Fetch = (url, init) => fetch(url, init),
  ) {}

  async route(state: string, standingOrders: string | undefined): Promise<JevRouting> {
    const key = this.key();
    if (!key) throw new Error('no TypeSafe key: set TYPESAFE_API_KEY, or put it in typesafe.key in the plugin’s folder');
    const res = await this.fetcher(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JEV_BACKTEST_MODEL, state, questions: routeQuestions(standingOrders) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Jev answered HTTP ${res.status}: ${text.slice(0, 200)}`);
    const reply = readReply(JSON.parse(text));
    if (!reply) throw new Error(`Jev's reply had no answers: ${text.slice(0, 200)}`);
    return routingOf(reply.answers, reply.inputTokens);
  }
}
