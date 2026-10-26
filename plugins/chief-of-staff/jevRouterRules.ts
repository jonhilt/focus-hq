import { JEV_BACKTEST_MODEL, JEV_QUESTIONS_VERSION, JEV_USD_PER_INPUT_TOKEN, type JevAnswer, jevRoute, PROPOSED_POLICY, interruptSignal, type RoutePolicy } from './jevRoute';
import type { JevRouting } from './jevRouter';

// Jev's route for a lead's turn from its answers (README.md#how-it-judges-a-turn): the backtest's proposed policy, and
// what the verdict keeps of how it got there. jevRouter.ts asks Jev. Pure, so it's tested (jevRouterRules.test.ts).

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
