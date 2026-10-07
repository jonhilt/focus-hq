import { describe, expect, it } from 'vitest';
import { type LedgerEvent, parseLedger, reportCard, reportLines } from './ledger';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const pr = (n: number) => ({ projectId: 'p', repo: 'o/r', pr: n });

const merged = (n: number, qa: 'passed' | 'stale' | 'none', failedRounds = 0, at = NOW - DAY): LedgerEvent => ({ ...pr(n), at, kind: 'merged', by: qa === 'passed' ? 'office' : 'captain', qa, failedRounds, triages: 0 });
const verdict = (n: number, v: 'pass' | 'fail', at = NOW - DAY): LedgerEvent => ({ ...pr(n), at, kind: 'qa-verdict', verdict: v, reviewer: 'QA', checks: { pass: 1, fail: 0, skip: 0 }, failedRounds: 0 });

describe('reportCard', () => {
  it('counts merges, first-time passes, rounds and merges without a pass', () => {
    const card = reportCard([merged(1, 'passed'), merged(2, 'passed', 2), merged(3, 'stale'), verdict(1, 'pass'), verdict(2, 'fail'), verdict(2, 'fail'), verdict(2, 'pass')], NOW);
    expect(card).toMatchObject({ merged: 3, mergedFirstTime: 1, mergedUnpassed: 1, verdicts: 4, fails: 2 });
    expect(card.roundsPerMerge).toBeCloseTo(2 / 3);
  });

  it('leaves out what happened before the window', () => {
    expect(reportCard([merged(1, 'passed', 0, NOW - 31 * DAY), merged(2, 'none')], NOW)).toMatchObject({ merged: 1, mergedUnpassed: 1 });
  });

  it('counts each conflicting PR once, and those that needed an agent', () => {
    const conflicts = (n: number, resolved: 'office' | 'agent'): LedgerEvent => ({ ...pr(n), at: NOW - DAY, kind: 'conflicts', resolved });
    expect(reportCard([conflicts(1, 'office'), conflicts(1, 'agent'), conflicts(2, 'office')], NOW)).toMatchObject({ conflicts: 2, conflictsForAgent: 1 });
  });
});

describe('parseLedger', () => {
  it('skips blank and broken lines, like one cut short when Focus stopped', () => {
    const text = `${JSON.stringify(merged(1, 'passed'))}\n\nnot json\n{"kind":"merged"}\n${JSON.stringify(verdict(1, 'pass')).slice(0, 20)}`;
    expect(parseLedger(text)).toEqual([merged(1, 'passed')]);
  });
});

describe('reportLines', () => {
  it('says it is gathering evidence until there is some', () => {
    expect(reportLines(reportCard([], NOW)).headline).toBe('Gathering evidence');
  });

  it('shows the first-time pass rate as a percentage', () => {
    const { headline, lines } = reportLines(reportCard([merged(1, 'passed'), merged(2, 'passed', 1)], NOW));
    expect(headline).toBe('2 merged · last 30 days');
    expect(lines[0]).toBe('QA passed first time: 50%');
  });
});
