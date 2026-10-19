import { describe, expect, it } from 'vitest';
import { seededRandom } from './random';

describe('seededRandom', () => {
  it('rolls the same from the same seed, and differently from another', () => {
    const roll = (seed: number) => { const r = seededRandom(seed); return [r(), r(), r()]; };
    expect(roll(7)).toEqual(roll(7));
    expect(roll(7)).not.toEqual(roll(8));
    expect(roll(7).every((x) => x >= 0 && x < 1)).toBe(true);
  });
});
