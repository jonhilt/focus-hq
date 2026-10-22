import { describe, expect, it } from 'vitest';
import { agreesWithLabel, answersOf, scoreBlind, interruptSignal, type JevAnswer, jevRoute, type Label, routeQuestions, scoreRoutes, splitOrders } from './jevRoute';
import type { CosRoute } from './shared';

const ORDERS = `STANDING ORDERS
When a lead offers follow-ups, do them together.

ALWAYS THE CAPTAIN'S
Spending real money on runs.
What clients see.`;

const answers = (route: Record<string, number>, nouls: Partial<Record<'spends_money' | 'captains_call' | 'new_slice', number>> = {}): Record<string, JevAnswer> => ({
  route: { probabilities: route },
  ...Object.fromEntries(Object.entries(nouls).map(([k, noul]) => [k, { noul }])),
});
const policy = { threshold: 0.4, captainsCall: false };

describe('splitOrders', () => {
  it('splits the orders from what is always the captain’s, leaving out the headings and blank lines', () => {
    expect(splitOrders(ORDERS)).toEqual({ orders: ['When a lead offers follow-ups, do them together.'], always: ['Spending real money on runs.', 'What clients see.'] });
  });

  it('takes a file without the heading as orders alone, and no file as none', () => {
    expect(splitOrders('Do this.')).toEqual({ orders: ['Do this.'], always: [] });
    expect(splitOrders(undefined)).toEqual({ orders: [], always: [] });
    expect(splitOrders('Standing orders\nDo this.')).toEqual({ orders: ['Do this.'], always: [] });
  });
});

describe('routeQuestions', () => {
  it('asks the route as a choice of the four, with the orders folded into the criteria they bear on', () => {
    const q = routeQuestions(ORDERS);
    expect(q.route.type).toBe('choice');
    const criteria = q.route.type === 'choice' ? q.route.criteria : {};
    expect(Object.keys(criteria).sort()).toEqual(['back_to_lead', 'card', 'carry_on', 'interrupt']);
    expect(criteria.back_to_lead).toContain('do them together');
    expect(criteria.interrupt).toContain('What clients see.');
    expect(q.captains_call.instructions).toContain('Spending real money on runs.');
  });

  it('asks the three checks as yes or no', () => {
    const q = routeQuestions(undefined);
    expect([q.spends_money.type, q.captains_call.type, q.new_slice.type]).toEqual(['noul', 'noul', 'noul']);
  });
});

describe('jevRoute', () => {
  it('interrupts at the bar, and goes with the likeliest of the rest under it', () => {
    expect(jevRoute(answers({ interrupt: 0.4, card: 0.6 }), policy)).toBe(3);
    expect(jevRoute(answers({ interrupt: 0.39, card: 0.2, back_to_lead: 0.41 }), policy)).toBe(4);
  });

  it('interrupts on spending money whatever the route says', () => {
    expect(jevRoute(answers({ carry_on: 0.9 }, { spends_money: 0.5 }), policy)).toBe(3);
  });

  it('never leaves a new slice or the captain’s own call with the lead: it’s a card', () => {
    expect(jevRoute(answers({ carry_on: 0.9 }, { new_slice: 0.6 }), policy)).toBe(2);
    expect(jevRoute(answers({ back_to_lead: 0.9 }, { captains_call: 0.6 }), policy)).toBe(2);
  });

  it('counts the captain’s-call check towards interrupting only when the policy says so', () => {
    const a = answers({ card: 0.9, interrupt: 0.1 }, { captains_call: 0.7 });
    expect(interruptSignal(a, false)).toBe(0.1);
    expect(jevRoute(a, { threshold: 0.6, captainsCall: true })).toBe(3);
    expect(jevRoute(a, { threshold: 0.6, captainsCall: false })).toBe(2);
  });

  it('sends a carry-on back to the lead when the policy allows no silent carry-on', () => {
    const a = answers({ carry_on: 0.8, card: 0.1, interrupt: 0.1 });
    expect(jevRoute(a, policy)).toBe(1);
    expect(jevRoute(a, { ...policy, noSilentCarryOn: true })).toBe(4);
  });

  it('falls back on the choice alone when Jev sends no probabilities', () => {
    expect(jevRoute({ route: { choice: 'back_to_lead' } }, policy)).toBe(4);
  });
});

describe('scoring', () => {
  it('counts route 4 as the label’s bucket 1, and nothing else across buckets', () => {
    expect(agreesWithLabel(1, 4)).toBe(true);
    expect(agreesWithLabel(1, 1)).toBe(true);
    expect(agreesWithLabel(3, 2)).toBe(false);
  });

  it('scores the turns both have, as score.py does', () => {
    const routes = new Map<string, CosRoute>([['a', 3], ['b', 1], ['c', 2], ['d', 4], ['x', 3]]);
    const labels = new Map<string, Label>([['a', { bucket: 3 }], ['b', { bucket: 3 }], ['c', { bucket: 2 }], ['d', { bucket: 1 }]]);
    expect(scoreRoutes(routes, labels, 2)).toEqual({
      turns: 4, interruptsCaught: 1, interruptsLabelled: 2, silentMisses: 1, interruptsPerDay: 0.5, cardsPerDay: 0.5, agree: 3,
    });
  });
});

describe('scoreBlind', () => {
  const routes = new Map<string, CosRoute>([['a', 3], ['b', 2], ['c', 1]]);
  it('counts the same bucket and the captain’s 3s caught, over the sample’s turns that were judged', () => {
    expect(scoreBlind(routes, ['a', 'b', 'c', 'd'], '1:3 2:3 3:1 4:3')).toEqual({ judged: 3, agree: 2, caught: 1, captainsInterrupts: 2, agreeMapped: 2, silent: 0, interrupts: 1 });
  });
  it('counts route 4 as bucket 1, and a captain’s 3 carried on as a silent miss', () => {
    const r = new Map<string, CosRoute>([['a', 4], ['b', 1]]);
    expect(scoreBlind(r, ['a', 'b'], '1:1 2:3')).toMatchObject({ agree: 0, agreeMapped: 1, silent: 1, interrupts: 0 });
  });
  it('skips a label with no bucket', () => {
    expect(scoreBlind(routes, ['a', 'b'], '1:3 2:')).toEqual({ judged: 1, agree: 1, caught: 1, captainsInterrupts: 1, agreeMapped: 1, silent: 0, interrupts: 1 });
  });
  it('narrows to the turns asked for', () => {
    expect(scoreBlind(routes, ['a', 'b', 'c'], '1:3 2:3 3:1', new Set(['b']))).toEqual({ judged: 1, agree: 0, caught: 0, captainsInterrupts: 1, agreeMapped: 0, silent: 0, interrupts: 0 });
  });
});

describe('answersOf', () => {
  it('keeps the fields that read right, and drops the rest', () => {
    expect(answersOf({ route: { type: 'choice', choice: 'card', probabilities: { card: 0.7, interrupt: 'x' }, confidence: 0.8 }, spends_money: { noul: 0.1 }, junk: 3 })).toEqual({
      route: { choice: 'card', probabilities: { card: 0.7 }, confidence: 0.8 },
      spends_money: { noul: 0.1 },
    });
    expect(answersOf(null)).toEqual({});
  });
});
