import { describe, expect, it } from 'vitest';
import type { QaReport } from '../../shared/types';
import { changesCode, judgePrompt, pickControls, pointsAt, replayLines, scoreReplay, sitesOf } from './bugReplay';

const report = (over: Partial<QaReport>): QaReport => ({ verdict: 'fail', summary: '', checks: [], commands: [], captions: [], ...over });
const sites = [{ file: 'server/agents/comms.ts', line: 40 }];

describe('pointsAt', () => {
  it("points at the bug when a failed check or the fix instructions name one of the bug's files", () => {
    expect(pointsAt(report({ checks: [{ name: 'restart', result: 'fail', details: 'comms.ts clears the hold on shutdown' }] }), sites)).toBe(true);
    expect(pointsAt(report({ fixInstructions: 'In server/agents/comms.ts keep the hold' }), sites)).toBe(true);
  });

  it("doesn't count a passing check that names the file", () => {
    expect(pointsAt(report({ checks: [{ name: 'shutdown', result: 'pass', details: 'comms.ts' }] }), sites)).toBe(false);
  });

  it('counts a spot-check within 5 lines of the bug, not further off, or anywhere in the file when only the file is known', () => {
    expect(pointsAt(report({ spotChecks: [{ file: 'server/agents/comms.ts', line: 44, why: '' }] }), sites)).toBe(true);
    expect(pointsAt(report({ spotChecks: [{ file: 'server/agents/comms.ts', line: 60, why: '' }] }), sites)).toBe(false);
    expect(pointsAt(report({ spotChecks: [{ file: 'server/agents/comms.ts', line: 300, why: '' }] }), sitesOf([], ['server/agents/comms.ts']))).toBe(true);
  });
});

describe('scoreReplay', () => {
  it('is caught only when the change was stopped and the judge says the finding is the bug', () => {
    expect(scoreReplay(true, true)).toBe('caught');
    expect(scoreReplay(true, false)).toBe('failed-elsewhere');
    expect(scoreReplay(false, true)).toBe('missed');
  });
});

describe('judgePrompt', () => {
  it('gives the fix as the answer key, then only what the review found', () => {
    const prompt = judgePrompt(
      { subject: 'A clean shutdown keeps a hold', diff: '-  agent.held = false;' },
      report({
        checks: [{ name: 'shutdown', result: 'fail', details: 'stop() clears held' }, { name: 'lint', result: 'pass', details: 'fine' }],
        fixInstructions: 'keep held on shutdown',
        proofs: [
          { kind: 'test', finding: 'survives restart', file: 'c.proof.test.ts', command: 'vitest run c.proof.test.ts', outcome: 'failed', note: 'AssertionError' },
          { kind: 'test', finding: 'a probe that passed', file: 'd.proof.test.ts', command: 'vitest run d.proof.test.ts', outcome: 'passed' },
        ],
      }),
    );
    expect(prompt).toContain('agent.held = false');
    expect(prompt).toContain('- shutdown: stop() clears held');
    expect(prompt).not.toContain('lint');
    expect(prompt).toContain('- c.proof.test.ts: survives restart (AssertionError)');
    expect(prompt).not.toContain('d.proof.test.ts');
  });

  it('cuts a long diff', () => {
    expect(judgePrompt({ subject: 's', diff: 'x'.repeat(50) }, report({}), 10)).toContain('… (cut)');
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
  it('says how many real bugs the review caught, then the controls, then each bug with the finding the judge matched', () => {
    const lines = replayLines(
      'hunt',
      [
        { fix: 'f1aaaaaa', kind: 'race', introducedBy: 'i1bbbbbb', pr: 12, outcome: 'caught', summary: '', pointed: true, judged: { sameBug: true, finding: 'accepting twice files twice', why: '' }, costUsd: 0.5 },
        { fix: 'f2aaaaaa', kind: 'lifecycle', introducedBy: 'i2bbbbbb', outcome: 'failed-elsewhere', summary: '', pointed: true, costUsd: 0.5 },
        { fix: 'f3aaaaaa', kind: 'race', introducedBy: 'i3bbbbbb', outcome: 'error', summary: 'timed out' },
      ],
      [{ sha: 'c1cccccc', outcome: 'false-alarm', summary: '', costUsd: 0.25 }],
    );
    expect(lines[0]).toBe("The hunting review caught 1 of 2 real bugs in the commits that brought them in · stopped 1 more for another bug · missed 0 · 1 without a verdict · (pointed at the bug's file: 2) · $1.25");
    expect(lines[1]).toBe('Controls: stopped 1 of 1 commits no listed bug came from: c1ccccc');
    expect(lines[2]).toContain('i1bbbbb #12 → fixed in f1aaaaa: accepting twice files twice');
  });
});

describe('changesCode', () => {
  it("counts a commit that changed Focus's code, not one that only changed tests, docs or assets", () => {
    expect(changesCode(['docs/x.md', 'server/agents/lead.ts'])).toBe(true);
    expect(changesCode(['client/src/main.ts'])).toBe(true);
    expect(changesCode(['server/agents/lead.test.ts', 'docs/x.md', 'client/public/ship/deck.glb'])).toBe(false);
  });
});
