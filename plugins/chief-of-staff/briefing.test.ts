import { describe, expect, it } from 'vitest';
import { focusIndex, keptOrder } from './briefing';

describe('focusIndex', () => {
  it('is nothing with nothing left', () => {
    expect(focusIndex([], 'a', 0)).toBe(-1);
  });

  it('stays on the item it showed while it’s there, wherever it moved', () => {
    expect(focusIndex(['x', 'a', 'b'], 'a', 0)).toBe(1);
  });

  it('moves on to what took an answered item’s place', () => {
    expect(focusIndex(['a', 'c'], 'b', 1)).toBe(1);
  });

  it('falls back to the last when the answered item was last', () => {
    expect(focusIndex(['a', 'b'], 'c', 2)).toBe(1);
  });

  it('starts at the top', () => {
    expect(focusIndex(['a', 'b'], null, 0)).toBe(0);
  });
});

describe('keptOrder', () => {
  it('keeps what it had where it was, though it moved', () => {
    // a lead's turn, read, goes from the hails to the end of the needs
    expect(keptOrder(['turn', 'hand', 'pick'], ['hand', 'pick', 'turn'])).toEqual(['turn', 'hand', 'pick']);
  });

  it('adds what’s new at the end, in the order it came', () => {
    expect(keptOrder(['a', 'b'], ['c', 'a', 'd', 'b'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('drops what’s gone', () => {
    expect(keptOrder(['a', 'b', 'c'], ['c', 'a'])).toEqual(['a', 'c']);
  });

  it('is the order it came in, to start', () => {
    expect(keptOrder([], ['b', 'a'])).toEqual(['b', 'a']);
  });
});
