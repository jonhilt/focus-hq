import { describe, expect, it } from 'vitest';
import { seatHelpers } from './helperSeats';

describe('seatHelpers', () => {
  it('seats newcomers in the free seats, in the order they started', () => {
    expect(seatHelpers([undefined, undefined, undefined], ['a', 'b'])).toEqual(['a', 'b', undefined]);
  });

  it('keeps everyone in the seat they took, and frees the seats of those who left', () => {
    expect(seatHelpers(['a', 'b', 'c'], ['b', 'd'])).toEqual(['d', 'b', undefined]);
    expect(seatHelpers(['a', undefined, 'c'], ['c', 'a'])).toEqual(['a', undefined, 'c']);
  });

  it('leaves helpers beyond the seats waiting for one', () => {
    expect(seatHelpers([undefined, undefined, undefined], ['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
    expect(seatHelpers(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['d', 'b', 'c']);
  });
});
