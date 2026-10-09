import { describe, expect, it } from 'vitest';
import { canMove, clearToward } from './collision';

const wall = { minX: 1, maxX: 2, minZ: -5, maxZ: 5 };
const R = 0.3;

describe('canMove', () => {
  it('lets the player walk in the open', () => {
    expect(canMove([wall], 0, 0, 0.1, 0, R)).toBe(true);
  });

  it('stops the player at a wall', () => {
    expect(canMove([wall], 0.6, 0, 0.75, 0, R)).toBe(false);
  });

  it('lets someone put inside a wall walk out of it, every way', () => {
    expect(canMove([wall], 0.8, 0, 0.7, 0, R)).toBe(true);
    expect(canMove([wall], 0.8, 0, 0.8, 0.1, R)).toBe(true);
    expect(canMove([wall], 0.8, 0, 0.9, 0, R)).toBe(true);
  });

  it('still stops them at a box they were not touching', () => {
    const post = { minX: -1, maxX: 0.6, minZ: 0.5, maxZ: 1 };
    expect(canMove([wall, post], 0.8, 0, 0.8, 0.3, R)).toBe(false);
  });
});

describe('clearToward', () => {
  it('leaves a clear spot as it is', () => {
    expect(clearToward([wall], 0, 0, -1, 0, R)).toEqual({ x: 0, z: 0 });
  });

  it('slides someone in a wall to the nearest clear spot on the way', () => {
    const at = clearToward([wall], 0.9, 0, 0, 0, R, 0.01)!;
    expect(at.z).toBe(0);
    expect(at.x).toBeLessThan(0.701);
    expect(at.x).toBeGreaterThan(0.68);
  });

  it('gives up when nowhere on the way is clear', () => {
    expect(clearToward([wall], 1.5, 0, 1.4, 0, R)).toBeNull();
  });
});
