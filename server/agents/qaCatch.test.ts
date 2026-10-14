import { describe, expect, it } from 'vitest';
import type { QaReport } from '../../shared/types';
import { addedLines, catchGuard, catchLines, catchTotals, plant, plantableFile, scoreReport } from './qaCatch';

const diff = [
  'diff --git a/server/gate.ts b/server/gate.ts',
  '--- a/server/gate.ts',
  '+++ b/server/gate.ts',
  '@@ -10,2 +10,4 @@ export function canMerge',
  ' const x = 1;',
  '+  // a comment === nothing',
  '+  if (!review) return false;',
  '+  return review.passed && review.sha === head;',
  '@@ -40,0 +43,1 @@',
  '+export const LIMIT = 3;',
  'diff --git a/client/src/ui/x.ts b/client/src/ui/x.ts',
  '--- a/client/src/ui/x.ts',
  '+++ b/client/src/ui/x.ts',
  '@@ -0,0 +1,1 @@',
  '+if (a === b) go();',
  'diff --git a/old.ts b/old.ts',
  '--- a/old.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-gone === here',
].join('\n');

describe('addedLines', () => {
  it('gives each added line with its line number in the new file, leaving deleted files out', () => {
    expect(addedLines(diff)).toEqual([
      { file: 'server/gate.ts', line: 11, text: '  // a comment === nothing' },
      { file: 'server/gate.ts', line: 12, text: '  if (!review) return false;' },
      { file: 'server/gate.ts', line: 13, text: '  return review.passed && review.sha === head;' },
      { file: 'server/gate.ts', line: 43, text: 'export const LIMIT = 3;' },
      { file: 'client/src/ui/x.ts', line: 1, text: 'if (a === b) go();' },
    ]);
  });
});

describe('plantableFile', () => {
  it('takes code QA can catch a bug in from the diff and the tests, not UI, tests or config', () => {
    expect(['server/agents/lead.ts', 'shared/qa.ts', 'Courses.Api/Services/Enrol.cs', 'scripts/flow.ts'].every(plantableFile)).toBe(true);
    expect(['client/src/ui/x.ts', 'server/agents/lead.test.ts', 'Courses.Api.Tests/EnrolTests.cs', 'docs/qa.md', 'vite.config.ts', 'shared/types.d.ts'].some(plantableFile)).toBe(false);
  });
});

describe('plant', () => {
  const lines = addedLines(diff);
  it('breaks a line of plantable code the pull request added, the same way for the same seed, never a comment', () => {
    const picks = [0, 1, 2].map((seed) => plant(lines, seed));
    expect(picks.map((p) => p && [p.line, p.after])).toEqual([
      [12, '  if (review) return false;'],
      [13, '  return review.passed && review.sha !== head;'],
      [12, '  if (review) return false;'],
    ]);
    expect(picks[1]?.bug).toBe('an equality check turned into an inequality');
    expect(plant(lines, 1)).toEqual(picks[1]);
  });

  it('plants nothing when nothing added can take a bug', () => {
    expect(plant(addedLines(diff).filter((l) => l.file.startsWith('client')), 0)).toBeUndefined();
  });
});

describe('scoreReport', () => {
  const planted = { file: 'server/gate.ts', line: 12, before: '  if (!review) return false;', after: '  if (review) return false;', bug: 'a guard turned round' };
  const report = (r: Partial<QaReport>): QaReport => ({ verdict: 'fail', summary: '', checks: [], commands: [], captions: [], ...r });
  it('counts it caught when QA fails it and points at the bug, and says how it went otherwise', () => {
    expect(scoreReport(report({ fixInstructions: 'In gate.ts the guard is inverted.' }), planted)).toBe('caught');
    expect(scoreReport(report({ checks: [{ name: 'merge gate', result: 'fail', details: 'canMerge passes with no review: if (review) return false;' }] }), planted)).toBe('caught');
    expect(scoreReport(report({ spotChecks: [{ file: 'server/gate.ts', line: 14, why: 'inverted' }] }), planted)).toBe('caught');
    expect(scoreReport(report({ spotChecks: [{ file: 'server/gate.ts', line: 40, why: 'far off' }], fixInstructions: 'The README is wrong.' }), planted)).toBe('failed-elsewhere');
    expect(scoreReport(report({ verdict: 'pass', spotChecks: [{ file: 'server/gate.ts', line: 12, why: 'looks risky' }] }), planted)).toBe('missed');
  });
});

describe('catchTotals and catchLines', () => {
  const planted = { file: 'server/gate.ts', line: 12, before: '', after: '', bug: 'a guard turned round' };
  const run = (pr: number, outcome: 'caught' | 'failed-elsewhere' | 'missed' | 'error', costUsd = 0.5) => ({ repo: 'o/web', pr, planted, outcome, summary: '', costUsd });
  it('give the rate over the runs that finished, and each run', () => {
    const results = [run(1, 'caught'), run(2, 'missed'), run(3, 'failed-elsewhere'), run(4, 'error', 0.1)];
    expect(catchTotals(results)).toEqual({ runs: 4, caught: 1, failedElsewhere: 1, missed: 1, errors: 1, rate: 1 / 3, costUsd: 1.6 });
    expect(catchLines(results)[0]).toBe('QA caught 1 of 3 planted bugs (33%) · 1 failed for something else · 1 missed · 1 without a verdict · $1.60');
    expect(catchLines(results)[2]).toBe('  ✗ missed                 web#2  server/gate.ts:12  a guard turned round');
  });
});

describe('catchGuard', () => {
  const planted = { file: 'a.ts', line: 1, before: '', after: '', bug: 'x' };
  it('reads the latest run as a guard, or says it hasn’t been measured', () => {
    const results = [{ repo: 'o/r', pr: 1, planted, outcome: 'caught' as const, summary: '' }, { repo: 'o/r', pr: 2, planted, outcome: 'missed' as const, summary: '' }];
    expect(catchGuard({ at: Date.parse('2026-10-15T09:00:00Z'), model: 'sonnet', results })).toBe('  QA catch rate: caught 1 of 2 planted bugs (50%), 0 failed for something else, 1 missed · 2026-10-15, sonnet');
    expect(catchGuard(undefined)).toMatch(/not measured yet/);
  });
});
