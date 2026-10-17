import { describe, expect, it } from 'vitest';
import type { QaReport } from '../../shared/types';
import { changesCode, pickControls, replayLines, scoreReplay, sitesOf } from './bugReplay';

const report = (over: Partial<QaReport>): QaReport => ({ verdict: 'fail', summary: '', checks: [], commands: [], captions: [], ...over });
const sites = [{ file: 'server/agents/comms.ts', line: 40 }];

describe('scoreReplay', () => {
  it("is missed when QA passed the change that brought the bug in", () => {
    expect(scoreReplay(report({ verdict: 'pass', fixInstructions: 'comms.ts' }), sites)).toBe('missed');
  });

  it('is caught when a failed check or the fix instructions name one of the bug\'s files', () => {
    expect(scoreReplay(report({ checks: [{ name: 'restart', result: 'fail', details: 'comms.ts clears the hold on shutdown' }] }), sites)).toBe('caught');
    expect(scoreReplay(report({ fixInstructions: 'In server/agents/comms.ts keep the hold' }), sites)).toBe('caught');
  });

  it("doesn't count a passing check that names the file", () => {
    expect(scoreReplay(report({ checks: [{ name: 'shutdown', result: 'pass', details: 'comms.ts' }] }), sites)).toBe('failed-elsewhere');
  });

  it('is caught by a spot-check within 5 lines of the bug, not further off', () => {
    expect(scoreReplay(report({ spotChecks: [{ file: 'server/agents/comms.ts', line: 44, why: '' }] }), sites)).toBe('caught');
    expect(scoreReplay(report({ spotChecks: [{ file: 'server/agents/comms.ts', line: 60, why: '' }] }), sites)).toBe('failed-elsewhere');
  });

  it('takes a spot-check anywhere in the file when only the file is known', () => {
    expect(scoreReplay(report({ spotChecks: [{ file: 'server/agents/comms.ts', line: 300, why: '' }] }), sitesOf([], ['server/agents/comms.ts']))).toBe('caught');
  });
});

describe('sitesOf', () => {
  it("uses the bug's lines when they're known, its files otherwise", () => {
    expect(sitesOf(sites, ['x.ts'])).toBe(sites);
    expect(sitesOf([], ['x.ts'])).toEqual([{ file: 'x.ts' }]);
  });
});

describe('pickControls', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ sha: `c${i}`, subject: `commit ${i}` }));

  it('spreads its picks evenly over history, leaving out the excluded', () => {
    const picks = pickControls(history, new Set(['c2', 'c7']), 4).map((c) => c.sha);
    expect(picks).toHaveLength(4);
    expect(picks).not.toContain('c2');
    expect(picks).not.toContain('c7');
    expect(new Set(picks).size).toBe(4);
    expect(picks).toEqual(pickControls(history, new Set(['c2', 'c7']), 4).map((c) => c.sha));
  });

  it('gives what there is when asked for more, and nothing when asked for none', () => {
    expect(pickControls(history.slice(0, 3), new Set(), 10)).toHaveLength(3);
    expect(pickControls(history, new Set(), 0)).toEqual([]);
  });
});

describe('replayLines', () => {
  it('says how many real bugs QA caught, then the controls, then each bug', () => {
    const lines = replayLines(
      [
        { fix: 'f1aaaaaa', kind: 'race', introducedBy: 'i1bbbbbb', pr: 12, outcome: 'caught', summary: '', costUsd: 0.5 },
        { fix: 'f2aaaaaa', kind: 'lifecycle', introducedBy: 'i2bbbbbb', outcome: 'missed', summary: '', costUsd: 0.5 },
        { fix: 'f3aaaaaa', kind: 'race', introducedBy: 'i3bbbbbb', outcome: 'error', summary: 'timed out' },
      ],
      [{ sha: 'c1cccccc', outcome: 'false-alarm', summary: '', costUsd: 0.25 }],
    );
    expect(lines[0]).toBe('QA caught 1 of 2 real bugs in the commits that brought them in · 0 failed for something else · 1 missed · 1 without a verdict · $1.25');
    expect(lines[1]).toBe('Controls: QA failed 1 of 1 commits no listed bug came from: c1ccccc');
    expect(lines[2]).toContain('i1bbbbb #12 → fixed in f1aaaaa');
  });
});

describe('changesCode', () => {
  it("counts a commit that changed the office's code, not one that only changed tests, docs or assets", () => {
    expect(changesCode(['docs/x.md', 'server/agents/lead.ts'])).toBe(true);
    expect(changesCode(['client/src/main.ts'])).toBe(true);
    expect(changesCode(['server/agents/lead.test.ts', 'docs/x.md', 'client/public/ship/deck.glb'])).toBe(false);
  });
});
