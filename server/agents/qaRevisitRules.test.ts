import { describe, expect, it } from 'vitest';
import { parseQaReport } from './qa';
import { filesToRevisit, skimmed, unaccounted } from './qaRevisitRules';

describe('unaccounted and skimmed', () => {
  it('reads the report’s files, and finds the changed ones it leaves out', () => {
    const parsed = parseQaReport({ verdict: 'pass', summary: '', checks: [], commands: [], files: [{ file: './src/cart.ts', tests: 'cart.test.ts', checked: 'read' }, { tests: 'none' }] });
    expect(parsed?.files).toEqual([{ file: './src/cart.ts', tests: 'cart.test.ts', checked: 'read' }]);
    expect(parsed && unaccounted(parsed, ['src/cart.ts', 'scripts/sync.ts', 'web/src/cart.ts'])).toEqual(['scripts/sync.ts']);
    expect(parseQaReport({ verdict: 'pass', summary: '', checks: [], commands: [] })?.files).toBeUndefined();
  });

  it('takes QA at its word on the files it only skimmed or didn’t read', () => {
    const file = (f: string, checked: string) => ({ file: f, tests: 'none', checked });
    const report = parseQaReport({ verdict: 'pass', summary: '', checks: [], commands: [], files: [file('a.ts', 'Scene tools; skimmed.'), file('b.ts', 'Read every changed line'), file('c.ts', "Didn't read: generated"), file('d.ts', 'glanced at the diff'), file('e.ts', 'Not reviewed in depth')] });
    expect(report && skimmed(report)).toEqual(['a.ts', 'c.ts', 'd.ts', 'e.ts']);
  });
});

describe('filesToRevisit', () => {
  const report = parseQaReport({ verdict: 'pass', summary: '', checks: [], commands: [], files: [{ file: 'a.ts', tests: 'none', checked: 'skimmed' }, { file: 'b.ts', tests: 'none', checked: 'read every line' }] });
  it('names what to go back to once a review, and nothing when there’s nothing or it was asked already', () => {
    if (!report) throw new Error('no report');
    expect(filesToRevisit(report, { changed: ['a.ts', 'b.ts', 'c.ts'], askedAgain: false })).toEqual({ missing: ['c.ts'], unread: ['a.ts'], unopened: [] });
    // the evidence: b.ts was never opened, whatever the report says; a.ts and c.ts are already named
    expect(filesToRevisit(report, { changed: ['a.ts', 'b.ts', 'c.ts'], askedAgain: false }, new Set())).toEqual({ missing: ['c.ts'], unread: ['a.ts'], unopened: ['b.ts'] });
    expect(filesToRevisit(report, { changed: ['a.ts', 'b.ts', 'c.ts'], askedAgain: true })).toBeUndefined();
    expect(filesToRevisit(report, undefined)).toBeUndefined();
    const clean = parseQaReport({ verdict: 'pass', summary: '', checks: [], commands: [], files: [{ file: 'b.ts', tests: 'none', checked: 'read' }] });
    expect(clean && filesToRevisit(clean, { changed: ['b.ts'], askedAgain: false })).toBeUndefined();
  });
});
