import { describe, expect, it } from 'vitest';
import { nextLine } from './speechRules';

describe('nextLine', () => {
  it('says a line wanted now before lines fetched ahead of time, however long they have waited', () => {
    expect(nextLine([{ urgency: 'ahead' }, { urgency: 'ahead' }, { urgency: 'now' }, { urgency: 'now' }])).toBe(2);
  });

  it('otherwise takes them in the order they came', () => {
    expect(nextLine([{ urgency: 'ahead' }, { urgency: 'ahead' }])).toBe(0);
  });

  it('has none when nothing is waiting', () => {
    expect(nextLine([])).toBe(-1);
  });
});
