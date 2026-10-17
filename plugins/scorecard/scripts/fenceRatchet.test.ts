import { describe, expect, it } from 'vitest';
import { fenceCounts, readBaseline } from './fenceFiles';
import { driftMessage, fenceDrift, lowered } from './fenceRatchet';

describe('fenceDrift', () => {
  it('finds a file over its baseline, and a new file with any at all', () => {
    const { over, under } = fenceDrift({ 'a.ts': 2 }, { 'a.ts': 3, 'new.ts': 1 });
    expect(over).toEqual([{ file: 'a.ts', count: 3, baseline: 2 }, { file: 'new.ts', count: 1, baseline: 0 }]);
    expect(under).toEqual([]);
  });

  it('finds a file below its baseline, and a deleted or cleaned file as 0', () => {
    const { over, under } = fenceDrift({ 'a.ts': 2, 'gone.ts': 1 }, { 'a.ts': 1 });
    expect(over).toEqual([]);
    expect(under).toEqual([{ file: 'a.ts', count: 1, baseline: 2 }, { file: 'gone.ts', count: 0, baseline: 1 }]);
  });

  it("doesn't let a cast removed in one file pay for one added in another", () => {
    const { over, under } = fenceDrift({ 'a.ts': 2, 'b.ts': 2 }, { 'a.ts': 1, 'b.ts': 3 });
    expect(over.map((d) => d.file)).toEqual(['b.ts']);
    expect(under.map((d) => d.file)).toEqual(['a.ts']);
  });
});

describe('lowered', () => {
  it('lowers to the counts, drops files at 0, and never raises or adds one', () => {
    expect(lowered({ 'a.ts': 3, 'b.ts': 1, 'c.ts': 2 }, { 'a.ts': 2, 'c.ts': 5, 'new.ts': 4 })).toEqual({ 'a.ts': 2, 'c.ts': 2 });
  });
});

describe('driftMessage', () => {
  it('says nothing when every file matches', () => {
    expect(driftMessage(fenceDrift({ 'a.ts': 1 }, { 'a.ts': 1 }))).toBeUndefined();
  });

  it('tells a file over to narrow instead, and one under to lower the baseline', () => {
    const text = driftMessage(fenceDrift({ 'a.ts': 2, 'b.ts': 2 }, { 'a.ts': 1, 'b.ts': 3 }));
    expect(text).toContain("Narrow instead: a type guard, `in`/`typeof`, an Effect Schema decode, or a type that says what the value is. Don't raise the baseline to pass.\n  b.ts: 3, baseline 2");
    expect(text).toContain('lock the gain in with `pnpm run fence:lower`');
    expect(text).toContain('  a.ts: 1, baseline 2');
  });
});

describe('the fence ratchet', () => {
  it("holds every file's type assertions at its baseline", () => {
    expect(driftMessage(fenceDrift(readBaseline(), fenceCounts()))).toBeUndefined();
  });
});
