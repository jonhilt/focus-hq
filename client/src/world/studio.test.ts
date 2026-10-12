import { describe, expect, it } from 'vitest';
import type { StudioTake } from '../../../shared/types';
import { ENTRANCE_X } from './hallLayout';
import { beatsFrom, keepsHallCollider, type Lit, placeLights, shownTakes, spotCorners, STUDIO_HALL, STUDIO_SPAN, STUDIO_WALL, studioWalls, TAKE_PLOT, takeSpots, threadLights } from './studio';

const lit = (n: number, settled?: Lit['settled']): Lit => ({ id: `t${n}`, text: `Thread ${n}?`, label: `Thread t${n}`, ...(settled ? { settled } : {}) });

describe('threadLights', () => {
  it('lights open threads, and sends answered ones up and dropped ones down', () => {
    const lits = threadLights([
      { id: 't1', text: 'Open?', at: 1 },
      { id: 't2', text: 'Answered?', at: 2, closed: { as: 'answered', answer: 'Yes', at: 3 } },
      { id: 't3', text: 'Dropped?', at: 2, closed: { as: 'dropped', at: 3 } },
    ]);
    expect(lits).toEqual([{ id: 't1', text: 'Open?', label: 'Thread t1' }, { id: 't2', text: 'Answered?', label: 'Thread t2', settled: 'up' }, { id: 't3', text: 'Dropped?', label: 'Thread t3', settled: 'down' }]);
  });
});

describe('placeLights', () => {
  it('lights new questions in the first free places', () => {
    expect(placeLights([lit(1), lit(2)], new Map(), 8).slots).toEqual(new Map([['t1', 0], ['t2', 1]]));
  });

  it('keeps a lit question in its place while others settle, and keeps a new one out of a place one is going from', () => {
    const held = new Map([['t1', 0], ['t2', 1], ['t3', 2]]);
    const { slots, settled } = placeLights([lit(1), lit(2, 'up'), lit(3), lit(4)], held, 8);
    expect(slots).toEqual(new Map([['t1', 0], ['t3', 2], ['t4', 3]]));
    expect(settled).toEqual([{ id: 't2', way: 'up' }]);
    // one still going from an earlier change, too
    expect(placeLights([lit(1), lit(3), lit(5)], new Map([['t1', 0], ['t3', 2]]), 4, new Set([1])).slots).toEqual(new Map([['t1', 0], ['t3', 2], ['t5', 3]]));
  });

  it('takes a place one is going from when there’s no other', () => {
    expect(placeLights([lit(1, 'down'), lit(2), lit(3)], new Map([['t1', 0], ['t2', 1]]), 2).slots).toEqual(new Map([['t2', 1], ['t3', 0]]));
  });

  it('sends a lit question that’s gone from the list down, and leaves one unlit while every place is taken', () => {
    expect(placeLights([], new Map([['t7', 3]]), 8).settled).toEqual([{ id: 't7', way: 'down' }]);
    const held = new Map([['t1', 0], ['t2', 1]]);
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

describe('the takes on the floor', () => {
  const take = (id: string, beat?: number): StudioTake => ({ id, label: id, seconds: 5, script: '', version: 1, at: 0, ...(beat !== undefined && { beat }) });

  it('shows every take, in beat order, each beat’s as first staged, any for no beat last', () => {
    expect(shownTakes([take('a', 2), take('b'), take('c', 0), take('d', 2), take('e', 1)]).map((t) => t.id)).toEqual(['c', 'e', 'a', 'd', 'b']);
  });

  it('stands them round the room inside its walls, apart, facing the middle, full size while they fit', () => {
    for (let n = 1; n <= 12; n++) {
      const spots = takeSpots(n);
      expect(spots).toHaveLength(n);
      for (const c of spots.flatMap(spotCorners)) {
        expect(Math.hypot(c.x, c.z)).toBeLessThanOrEqual(STUDIO_HALL.radius - 0.29);
        expect(c.x).toBeGreaterThan(ENTRANCE_X);
      }
      // neighbours a floor's width or more apart, round from your left to your right as you face the far wall (−z is your left)
      for (let i = 1; i < n; i++) {
        const [a, b] = [spots[i - 1], spots[i]];
        expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThanOrEqual(TAKE_PLOT.width * a.scale);
        expect(Math.atan2(b.z, b.x)).toBeGreaterThan(Math.atan2(a.z, a.x));
      }
      // each one's front (+z, turned by face) points at the middle of the room
      for (const s of spots) expect(Math.sin(s.face) * s.x + Math.cos(s.face) * s.z).toBeLessThan(0);
    }
    expect(takeSpots(4)[0].scale).toBe(1);
    expect(takeSpots(12)[0].scale).toBeLessThan(1);
  });
});

describe('the studio hall', () => {
  it('walls in its round wall and its entrance wall out to it, leaving the doorway clear', () => {
    const walls = studioWalls();
    const r = walls.map((w) => Math.hypot(w.x, w.z));
    expect(Math.max(...r)).toBeLessThan(STUDIO_HALL.radius + 0.6);
    // nothing in the middle of the floor, and nothing in the doorway
    expect(walls.filter((w) => Math.hypot(w.x, w.z) < STUDIO_HALL.radius - 0.5 && w.x > ENTRANCE_X + 0.5)).toEqual([]);
    expect(walls.filter((w) => w.x < ENTRANCE_X + 1 && Math.abs(w.z) < 2.3)).toEqual([]);
    // the entrance wall reaches the round wall on both sides
    const wide = STUDIO_HALL.radius * Math.sin(STUDIO_SPAN);
    for (const side of [-1, 1]) expect(walls.some((w) => w.x < ENTRANCE_X && side * w.z > wide - 0.3)).toBe(true);
  });

  it('keeps only the hall\'s own colliders round its doorway', () => {
    expect(keepsHallCollider(ENTRANCE_X - 0.2, 1.5)).toBe(true);
    expect(keepsHallCollider(1.3, -1.5)).toBe(false); // the moving boxes
    expect(keepsHallCollider(10.9, 0)).toBe(false); // the hall's round wall
    expect(keepsHallCollider(ENTRANCE_X + 0.2, 4)).toBe(false);
  });
});
