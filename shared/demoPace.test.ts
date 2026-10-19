import { describe, expect, it } from 'vitest';
import { clampSpeed, nextSpeed, paceLabel } from './demoPace';

describe('the demo pace', () => {
  it('steps slower and faster along the ladder, from a rung or between them', () => {
    expect(nextSpeed(0.5, -1)).toBe(0.25);
    expect(nextSpeed(0.5, 1)).toBe(0.75);
    expect(nextSpeed(0.6, -1)).toBe(0.5);
    expect(nextSpeed(0.6, 1)).toBe(0.75);
  });

  it('stops at the ends, and keeps an asked-for pace in range', () => {
    expect(nextSpeed(0.1, -1)).toBe(0.1);
    expect(nextSpeed(3, 1)).toBe(3);
    expect(clampSpeed(0.01)).toBe(0.1);
    expect(clampSpeed(9)).toBe(3);
    expect(clampSpeed('fast')).toBe(1);
  });

  it('reads as a multiple', () => {
    expect(paceLabel(1)).toBe('1×');
    expect(paceLabel(0.25)).toBe('0.25×');
    expect(paceLabel(1 / 3)).toBe('0.33×');
  });
});
