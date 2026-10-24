import { describe, expect, it } from 'vitest';
import type { LedgerEvent, LentJournal, ReviewEntry } from '../../plugin-api/server';
import { loadScorer } from '../../plugin-api/server';
import { DIFF_MAX, goalOf, keyOf, reportsDue, sampled, scoreEntry, scorePrompt, scoreSchema } from './scoring';

const scorer = loadScorer('qa-report');
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

describe('what the model is told and what its grade is written as', () => {
  it('tells it the pull request, QA’s report with its file account, and the diff, cut when it’s long', () => {
    const [d] = reportsDue([journal(7, ['s1'])], [], 100, 0);
    if (!d) throw new Error('no report due');
    const prompt = scorePrompt(d, 'diff --git a/a.ts b/a.ts');
    expect(prompt).toContain('Pull request acme/shop#7: PR 7');
    expect(prompt).toContain('"summary": "Checked the new route."');
    expect(prompt).toContain('"fileAccount"');
    expect(prompt).toContain('diff --git a/a.ts b/a.ts');
    expect(scorePrompt(d, 'x'.repeat(DIFF_MAX + 10))).toContain(`(cut here: the diff is ${DIFF_MAX + 10} characters in all)`);
  });

  it('asks for one of the scorer’s labels and why', () => {
    expect(scoreSchema(scorer)).toMatchObject({ required: ['label', 'why'], properties: { label: { enum: ['thorough', 'shallow', 'wrong'] } } });
  });

  it('writes the grade with its score, the stamp QA’s verdict had and the scorer’s digest; nothing for a label it hasn’t got', () => {
    const [d] = reportsDue([journal(7, ['s1'])], [], 100, 0);
    if (!d) throw new Error('no report due');
    expect(scoreEntry(d, scorer, { structured: { label: 'shallow', why: ' Leans on the suite. ' }, model: 'claude-haiku-4-5', costUsd: 0.06 }, 'Shop goal')).toEqual({
      kind: 'qa-score', repo: 'acme/shop', pr: 7, goal: 'Shop goal', sha: 's1', label: 'shallow', score: 0.5, passed: false, why: 'Leans on the suite.',
      crew: stamp, scorer: `qa-report-${scorer.digest}`, model: 'claude-haiku-4-5', costUsd: 0.06,
    });
    expect(scoreEntry(d, scorer, { structured: { label: 'brilliant', why: '' } })).toBeUndefined();
    expect(scoreEntry(d, scorer, { structured: undefined })).toBeUndefined();
  });

  it('finds the goal a pull request is a slice of from QA’s verdict lines', () => {
    const verdict = (pr: number, goal?: string): LedgerEvent => ({ kind: 'qa-verdict', repo: 'acme/shop', pr, ...(goal && { goal }), verdict: 'pass', reviewer: 'Lt. Varga', checks: { pass: 1, fail: 0, skip: 0 }, failedRounds: 0, projectId: 'shop', at: 1, seq: 1 });
    expect(goalOf([verdict(7, 'Shop goal'), verdict(8, 'Other'), verdict(7)], 'acme/shop', 7)).toBe('Shop goal');
    expect(goalOf([verdict(8, 'Other')], 'acme/shop', 7)).toBeUndefined();
  });
});
