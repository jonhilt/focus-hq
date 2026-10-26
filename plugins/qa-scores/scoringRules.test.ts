import { describe, expect, it } from 'vitest';
import type { LedgerEvent, LentJournal, ReviewEntry } from '../../plugin-api/server';
import { keyOf, reportsDue, sampled } from './scoringRules';

const report = { verdict: 'pass' as const, summary: 'Checked the new route.', checks: [{ name: 'Route answers', result: 'pass' as const, details: 'curl gave 200' }], commands: [{ command: 'pnpm test', result: '12 passed' }], captions: [] };
const stamp = { digest: '4f0660b9', model: 'sonnet', effort: 'medium' as const, commit: 'abc1234' };

/** A pull request's review journal: asked for, then a verdict on each of `shas`, `t` apart. */
function journal(pr: number, shas: string[], t = 1000): LentJournal<ReviewEntry> {
  let seq = 0;
  const at = (n: number) => ({ v: 1 as const, seq: ++seq, t: t + n });
  return {
    key: `acme/shop#${pr}`,
    entries: [
      { kind: 'requested', projectId: 'shop', repo: 'acme/shop', number: pr, title: `PR ${pr}`, ...at(0) },
      ...shas.map((sha, i) => ({ kind: 'reported' as const, verdict: 'pass' as const, officer: 'Lt. Varga', body: '', failedRounds: 0, report, screenshots: [], sha, crew: stamp, files: { changed: ['a.ts'], opened: ['a.ts'], sentBack: 0 }, ...at(i + 1) })),
    ],
  };
}

const graded = (pr: number, sha: string): LedgerEvent => ({ kind: 'qa-score', repo: 'acme/shop', pr, sha, label: 'thorough', score: 1, passed: true, why: '', scorer: 'qa-report-x', model: 'haiku', projectId: 'shop', at: 5, seq: 1 });

describe('which of QA’s reports are graded', () => {
  it('samples by a hash of each report, the same ones always, about as many as the rate says', () => {
    const keys = Array.from({ length: 2000 }, (_, i) => keyOf('acme/shop', i, 'sha'));
    expect(keys.filter((k) => sampled(k, 25)).length).toBeGreaterThan(400);
    expect(keys.filter((k) => sampled(k, 25)).length).toBeLessThan(600);
    expect(keys.filter((k) => sampled(k, 25))).toEqual(keys.filter((k) => sampled(k, 25)));
    expect(keys.every((k) => sampled(k, 100))).toBe(true);
  });

  it('takes each commit’s report once, newest first, none graded already or from before the look back', () => {
    const due = reportsDue([journal(1, ['a1', 'a2']), journal(2, ['b1'], 3000), journal(3, ['c1'], 10)], [graded(1, 'a1')], 100, 500);
    expect(due.map((d) => d.key)).toEqual(['acme/shop#2@b1', 'acme/shop#1@a2']);
    expect(due[0]).toMatchObject({ projectId: 'shop', repo: 'acme/shop', pr: 2, title: 'PR 2', sha: 'b1' });
  });

  it('leaves out reports the sample doesn’t take', () => {
    const shas = Array.from({ length: 40 }, (_, i) => `s${i}`);
    const due = reportsDue([journal(1, shas)], [], 25, 0);
    expect(due.length).toBeGreaterThan(0);
    expect(due.length).toBeLessThan(40);
    expect(due.every((d) => sampled(d.key, 25))).toBe(true);
  });
});
