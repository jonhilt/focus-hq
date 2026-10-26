import { describe, expect, it } from 'vitest';
import { routingOf } from './jevRouterRules';

describe('routingOf', () => {
  it('routes by the proposed policy: interrupting at 0.30, and a carry-on sent back to the lead', () => {
    expect(routingOf({ route: { probabilities: { interrupt: 0.3, card: 0.7 } } }, 0).route).toBe(3);
    expect(routingOf({ route: { probabilities: { interrupt: 0.1, carry_on: 0.9 } } }, 0).route).toBe(4);
  });

  it('keeps what the verdict needs of how it got there, and what it cost', () => {
    const { route, how } = routingOf({ route: { choice: 'card', probabilities: { card: 0.8, interrupt: 0.2 }, confidence: 0.7 } }, 2000);
    const { costUsd, ...rest } = how;
    expect(route).toBe(2);
    expect(rest).toEqual({ model: 'jev-1.14.0', version: 'jev-v1', interrupt: 0.2, choice: 'card', confidence: 0.7 });
    expect(costUsd).toBeCloseTo(0.000084, 9);
  });
});
