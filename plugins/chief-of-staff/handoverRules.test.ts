import { describe, expect, it } from 'vitest';
import { movesOpen, routeWithMoves } from './handoverRules';
import { type Move, NEW_GOAL, type Verdict } from './shared';

const move = (to: string): Move => ({ what: 'the retry build', to, brief: 'Retries are built on lindqvist/retries.', pick: 'move' });
const verdict = (route: Verdict['route'], ...moves: Move[]): Verdict => ({
  route, why: 'w', message: 'm',
  asks: [{ ask: 'Carry on to the settings page' }, ...moves.map((m) => ({ ask: `Move ${m.what}?`, move: m }))],
});

describe('work that belongs in another goal', () => {
  it('is the captain’s to move: a turn with a move goes to them as a card, a card or an interrupt stays one', () => {
    expect([1, 2, 3, 4].map((r) => routeWithMoves(r as Verdict['route'], true))).toEqual([2, 2, 3, 2]);
    expect([1, 2, 3, 4].map((r) => routeWithMoves(r as Verdict['route'], false))).toEqual([1, 2, 3, 4]);
  });

  it('moves only to an open goal other than the lead’s own, or to a new one', () => {
    const v = movesOpen(verdict(2, move('lead_b'), move('lead_a'), move('lead_gone'), move(NEW_GOAL)), new Set(['lead_a', 'lead_b']), 'lead_a');
    expect(v.asks.map((a) => a.move?.to)).toEqual([undefined, 'lead_b', undefined, undefined, NEW_GOAL]);
    // the asks stay, so the captain still sees what the judge raised
    expect(v.asks).toHaveLength(5);
  });

  it('carries a turn on as it would have, with its one ask, when none of its moves can be made', () => {
    expect(movesOpen(verdict(1, move('lead_gone')), new Set(), 'lead_a')).toEqual({ route: 1, why: 'w', message: 'm', asks: [{ ask: 'Carry on to the settings page' }] });
    expect(movesOpen(verdict(4, move('lead_b')), new Set(['lead_b']), 'lead_a')).toMatchObject({ route: 2, asks: [{}, { move: { to: 'lead_b' } }] });
  });
});
