import { describe, expect, it } from 'vitest';
import type { Agent, Studio } from '../../../shared/types';
import { beatsFrom, gapLights, type Lit, placeLights, STUDIO_WALL, studioOf } from './studio';

const lit = (n: number, settled?: Lit['settled']): Lit => ({ id: `g${n}`, text: `Gap ${n}?`, label: `Gap g${n}`, ...(settled ? { settled } : {}) });
const lead = (id: string, studio?: Partial<Studio>) => ({ id, lead: { studio: studio && { premise: id, beats: [], gaps: [], at: 0, ...studio } } }) as Agent;

describe('studioOf', () => {
  it('is the goal whose lead last changed its studio, or none', () => {
    expect(studioOf([lead('a'), lead('b')])).toBeUndefined();
    expect(studioOf([lead('a', { at: 5 }), lead('b', { at: 9 }), lead('c')])?.lead.id).toBe('b');
  });
});

describe('gapLights', () => {
  it('lights open gaps, and sends answered ones up and dropped ones down', () => {
    const lits = gapLights([
      { id: 'g1', text: 'Open?', at: 1 },
      { id: 'g2', text: 'Answered?', at: 2, closed: { as: 'answered', answer: 'Yes', at: 3 } },
      { id: 'g3', text: 'Dropped?', at: 2, closed: { as: 'dropped', at: 3 } },
    ]);
    expect(lits).toEqual([{ id: 'g1', text: 'Open?', label: 'Gap g1' }, { id: 'g2', text: 'Answered?', label: 'Gap g2', settled: 'up' }, { id: 'g3', text: 'Dropped?', label: 'Gap g3', settled: 'down' }]);
  });
});

describe('placeLights', () => {
  it('lights new questions in the first free places', () => {
    expect(placeLights([lit(1), lit(2)], new Map(), 8).slots).toEqual(new Map([['g1', 0], ['g2', 1]]));
  });

  it('keeps a lit question in its place while others settle, and keeps a new one out of a place one is going from', () => {
    const held = new Map([['g1', 0], ['g2', 1], ['g3', 2]]);
    const { slots, settled } = placeLights([lit(1), lit(2, 'up'), lit(3), lit(4)], held, 8);
    expect(slots).toEqual(new Map([['g1', 0], ['g3', 2], ['g4', 3]]));
    expect(settled).toEqual([{ id: 'g2', way: 'up' }]);
    // one still going from an earlier change, too
    expect(placeLights([lit(1), lit(3), lit(5)], new Map([['g1', 0], ['g3', 2]]), 4, new Set([1])).slots).toEqual(new Map([['g1', 0], ['g3', 2], ['g5', 3]]));
  });

  it('takes a place one is going from when there’s no other', () => {
    expect(placeLights([lit(1, 'down'), lit(2), lit(3)], new Map([['g1', 0], ['g2', 1]]), 2).slots).toEqual(new Map([['g2', 1], ['g3', 0]]));
  });

  it('sends a lit question that’s gone from the list down, and leaves one unlit while every place is taken', () => {
    expect(placeLights([], new Map([['g7', 3]]), 8).settled).toEqual([{ id: 'g7', way: 'down' }]);
    const held = new Map([['g1', 0], ['g2', 1]]);
    expect(placeLights([lit(1), lit(2), lit(3)], held, 2).slots).toEqual(held);
  });
});

describe('beatsFrom', () => {
  it('centres the row of cards on straight ahead', () => {
    const { card, gap, cardR } = STUDIO_WALL;
    expect(beatsFrom(1)).toBeCloseTo(-card / 2 / cardR);
    expect(beatsFrom(4) * -2 * cardR).toBeCloseTo(4 * card + 3 * gap);
  });
});
