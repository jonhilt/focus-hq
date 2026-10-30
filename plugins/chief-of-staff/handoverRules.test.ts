import { describe, expect, it } from 'vitest';
import { closeHold, goneWords, handoverKey, moveStep, movesOpen, receivedWords, routeWithMoves } from './handoverRules';
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

describe('moving the work, as the captain approves', () => {
  const read = { at: 100, judged: verdict(2, move('lead_b')) };

  it('moves the work an ask names once, to a goal still open, by the turn and the ask it came from', () => {
    expect(moveStep(read, 1, 'lead_a', new Set(), new Set(['lead_b']))).toEqual({ kind: 'move', move: move('lead_b'), key: 'lead_a:100:1' });
    expect(moveStep(read, 1, 'lead_a', new Set([handoverKey('lead_a', 100, 1)]), new Set(['lead_b']))).toEqual({ kind: 'refuse', why: 'the retry build has moved already' });
    expect(moveStep(read, 1, 'lead_a', new Set(), new Set())).toMatchObject({ kind: 'refuse', why: expect.stringMatching(/closed/) });
    expect(moveStep({ at: 100, judged: verdict(2, move(NEW_GOAL)) }, 1, 'lead_a', new Set(), new Set())).toMatchObject({ kind: 'move' });
  });

  it('refuses an ask that moves nothing, or a turn it hasn’t read', () => {
    expect(moveStep(read, 0, 'lead_a', new Set(), new Set(['lead_b']))).toMatchObject({ kind: 'refuse', why: expect.stringMatching(/moves no work/) });
    expect(moveStep(undefined, 1, 'lead_a', new Set(), new Set(['lead_b']))).toMatchObject({ kind: 'refuse' });
  });

  it('tells the receiving lead where it came from, and the sender where it went', () => {
    expect(receivedWords({ name: 'Lt. Lindqvist', title: 'Research' }, move('lead_b'))).toBe(
      "The captain has moved work to your goal from Lt. Lindqvist's goal “Research”: the retry build.\n\nRetries are built on lindqvist/retries.\n\nIt's yours now: Lt. Lindqvist has been told it's gone.",
    );
    expect(goneWords(move('lead_b'), { name: 'Lt. Tanaka', title: 'Comms is home' }, false)).toBe("Moved to Lt. Tanaka's goal “Comms is home”: the retry build. It's theirs now, so leave it to them.");
    expect(goneWords(move(NEW_GOAL), { name: 'Lt. Rhee' }, true)).toBe("A new goal was started for the retry build, led by Lt. Rhee. It's theirs now, so leave it to them.");
  });
});

describe('a goal that handed work on, proposed for closing', () => {
  const moved = [{ from: 'lead_a', to: 'lead_b', at: 100, what: 'the retry build' }, { from: 'lead_c', to: 'lead_b', at: 100, what: 'the docs' }];
  const tanaka = (r: { finishedAt?: number; turnStarted?: number }) => (id: string) => (id === 'lead_b' ? { name: 'Lt. Tanaka', ...(r.finishedAt && { finishedAt: r.finishedAt }), lead: { ...(r.turnStarted && { turnStarted: r.turnStarted }) } } : undefined);

  it('waits until the receiving lead has picked it up: a turn of theirs started or ended since it moved', () => {
    expect(closeHold('lead_a', moved, tanaka({ turnStarted: 50, finishedAt: 90 }))).toBe(
      "Not yet: work this goal handed on hasn't been picked up: the retry build (Lt. Tanaka). Propose closing it once they've taken it up.",
    );
    // at work when it came, so it reached them mid-turn: picked up once that turn ends
    expect(closeHold('lead_a', moved, tanaka({ turnStarted: 50 }))).toMatch(/^Not yet/);
    expect(closeHold('lead_a', moved, tanaka({ turnStarted: 50, finishedAt: 120 }))).toBeUndefined();
    // woken by it
    expect(closeHold('lead_a', moved, tanaka({ turnStarted: 110 }))).toBeUndefined();
  });

  it('holds nothing for a goal that handed nothing on, or whose receiving goal has closed since', () => {
    expect(closeHold('lead_x', moved, tanaka({}))).toBeUndefined();
    expect(closeHold('lead_a', moved, () => undefined)).toBeUndefined();
  });
});

