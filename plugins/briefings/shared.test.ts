import { describe, expect, it } from 'vitest';
import { firstChangedBeat } from './shared';

describe('firstChangedBeat', () => {
  const v1 = { lines: ['Save.', 'Pass it on.', 'It waits.'], titles: ['Save', 'Pass', 'Outage'] };

  it('finds the first beat whose line changed', () => {
    expect(firstChangedBeat(v1, { ...v1, lines: ['Save.', 'Pass it on.', 'It retries three times, then says so.'] })).toBe(2);
  });

  it('counts a changed title, or a beat added on the end', () => {
    expect(firstChangedBeat(v1, { ...v1, titles: ['Save', 'Hand over', 'Outage'] })).toBe(1);
    expect(firstChangedBeat(v1, { lines: [...v1.lines, 'And then?'], titles: [...v1.titles, 'After'] })).toBe(3);
  });

  it('has none when every beat reads the same, or there was no earlier version', () => {
    expect(firstChangedBeat(v1, { ...v1 })).toBe(-1);
    expect(firstChangedBeat(undefined, v1)).toBe(-1);
  });
});
