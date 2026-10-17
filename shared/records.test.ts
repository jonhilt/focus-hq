import { describe, expect, it } from 'vitest';
import { hasEvery, keysOf, recordOf } from './records';

type Tone = 'good' | 'bad' | 'off';

describe('keysOf', () => {
  it('gives a written-out record’s keys, in the order they were written', () => {
    const LABELS: Record<Tone, string> = { good: 'Good', bad: 'Bad', off: 'Off' };
    expect(keysOf(LABELS)).toEqual(['good', 'bad', 'off']);
  });

  it('gives nothing for an empty record', () => {
    expect(keysOf({})).toEqual([]);
  });
});

describe('recordOf', () => {
  it('has a value for each key, from that key', () => {
    expect(recordOf<Tone, number>(['good', 'bad', 'off'], (t) => t.length)).toEqual({ good: 4, bad: 3, off: 3 });
  });

  it('keeps the keys’ order', () => {
    expect(Object.keys(recordOf<Tone, boolean>(['off', 'good', 'bad'], () => true))).toEqual(['off', 'good', 'bad']);
  });

  it('has nothing for no keys', () => {
    expect(recordOf<Tone, number>([], () => 1)).toEqual({});
  });
});

describe('hasEvery', () => {
  it('holds when the record has each key, even one whose value is undefined, and not when one is missing', () => {
    expect(hasEvery<Tone, number | undefined>({ good: 1, bad: 2, off: undefined }, ['good', 'bad', 'off'])).toBe(true);
    expect(hasEvery<Tone, number>({ good: 1, off: 3 }, ['good', 'bad', 'off'])).toBe(false);
  });
});
