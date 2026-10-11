import { describe, expect, it } from 'vitest';
import { sessionId, spread } from './frameSamples';

describe('spread', () => {
  it('gives the typical frame, the slowest but one in twenty, and the slowest', () => {
    const ms = [...Array.from({ length: 95 }, () => 16.66), 30, 31, 32, 33, 120];
    expect(spread(ms)).toEqual({ median: 16.7, p95: 30, max: 120 });
  });

  it('copes with a single frame, and none', () => {
    expect(spread([42.04])).toEqual({ median: 42, p95: 42, max: 42 });
    expect(spread([])).toEqual({ median: 0, p95: 0, max: 0 });
  });
});

describe('sessionId', () => {
  it('names a log for when the page opened, in a form a file can have', () => {
    expect(sessionId(new Date('2026-10-11T20:01:02.345Z'), 'ab12')).toBe('2026-10-11T20-01-02-345Z-ab12');
  });
});
