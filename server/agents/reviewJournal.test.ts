import { describe, expect, it } from 'vitest';
import type { QaReport } from '../../shared/types';
import { foldReview, REVIEW_INTERRUPTED, type ReviewFact, reviewRecovery } from './reviewJournal';

const report: QaReport = { verdict: 'pass', summary: 'Works.', checks: [], commands: [] } as unknown as QaReport;
const reported = (verdict: 'pass' | 'fail'): ReviewFact => ({ kind: 'reported', verdict, officer: 'Lt. Quintero', body: 'QA passed', failedRounds: verdict === 'pass' ? 0 : 1, report, screenshots: [], sha: 'abc' });
const tested: ReviewFact[] = [{ kind: 'requested' }, { kind: 'seated', agent: 'qa_p' }, { kind: 'testing', sha: 'abc' }];

describe('a review’s journal', () => {
  it('follows a review from being asked for to its verdict on the pull request', () => {
    expect(foldReview([{ kind: 'requested' }]).phase).toBe('queued');
    expect(foldReview(tested.slice(0, 2))).toMatchObject({ phase: 'seated', agent: 'qa_p' });
    expect(foldReview(tested)).toMatchObject({ phase: 'testing', sha: 'abc' });
    expect(foldReview([...tested, reported('pass')])).toMatchObject({ phase: { reported: 'posting' }, reported: { verdict: 'pass', body: 'QA passed' } });
    expect(foldReview([...tested, reported('pass'), { kind: 'posted', url: 'u' }])).toMatchObject({ phase: { reported: 'announcing' }, reported: { url: 'u' } });
    expect(foldReview([...tested, reported('pass'), { kind: 'posted' }, { kind: 'announced' }])).toMatchObject({ phase: 'passed', verdict: 'pass' });
    expect(foldReview([...tested, reported('fail'), { kind: 'posted' }, { kind: 'announced' }])).toMatchObject({ phase: 'failed', verdict: 'fail' });
    expect(foldReview([...tested, { kind: 'ended', error: 'Stopped' }])).toMatchObject({ phase: 'error', error: 'Stopped' });
  });

  it('goes back to the last verdict when a precheck finds nothing to test, and carries a pass over', () => {
    const passed: ReviewFact[] = [...tested, reported('pass'), { kind: 'posted' }, { kind: 'announced' }, { kind: 'requested' }, { kind: 'prechecking' }];
    const failed: ReviewFact[] = [...tested, reported('fail'), { kind: 'posted' }, { kind: 'announced' }, { kind: 'requested' }, { kind: 'prechecking' }];
    expect(foldReview(passed).phase).toBe('precheck');
    expect(foldReview([...passed, { kind: 'precheck-skipped' }]).phase).toBe('passed');
    expect(foldReview([...failed, { kind: 'precheck-skipped' }]).phase).toBe('failed');
    expect(foldReview([...passed, { kind: 'precheck-carried', sha: 'def' }])).toMatchObject({ phase: 'passed', sha: 'def' });
    expect(foldReview([...passed, { kind: 'precheck-retest' }]).phase).toBe('queued');
  });

  it('is over for good once its pull request is gone, and asked for again otherwise', () => {
    expect(foldReview([...tested, { kind: 'gone', merged: true }, { kind: 'requested' }]).phase).toBe('gone');
    expect(foldReview([...tested, { kind: 'ended', error: 'x' }, { kind: 'requested' }]).phase).toBe('queued');
    // a fact out of turn changes nothing
    expect(foldReview([{ kind: 'requested' }, { kind: 'announced' }]).phase).toBe('queued');
  });
});

describe('a review after a restart', () => {
  it('waits for a reviewer again, or QA tests it when the office was still looking at it', () => {
    expect(reviewRecovery(foldReview([{ kind: 'requested' }]), 'queued', undefined)).toEqual({ kind: 'queue' });
    expect(reviewRecovery(foldReview([{ kind: 'requested' }, { kind: 'prechecking' }]), 'queued', undefined)).toEqual({ kind: 'retest' });
  });

  it('starts again when its reviewer was still setting up', () => {
    expect(reviewRecovery(foldReview(tested.slice(0, 2)), 'queued', 'requeue')).toEqual({ kind: 'restart' });
  });

  it('carries on with its reviewer’s turn when that picks itself back up, and ends otherwise', () => {
    const testing = foldReview(tested);
    for (const reviewer of ['resume', 'hold-again', 'requeue'] as const) expect(reviewRecovery(testing, 'testing', reviewer)).toEqual({ kind: 'carry-on' });
    // on the API key, or with no conversation to go back to
    for (const reviewer of ['wait', 'hold', 'none', undefined] as const) expect(reviewRecovery(testing, 'testing', reviewer)).toEqual({ kind: 'interrupted', error: REVIEW_INTERRUPTED });
  });

  it('posts a verdict it had, and tells everyone of one it posted', () => {
    expect(reviewRecovery(foldReview([...tested, reported('pass')]), 'testing', 'none')).toEqual({ kind: 'post' });
    expect(reviewRecovery(foldReview([...tested, reported('pass'), { kind: 'posted', url: 'u' }]), 'testing', 'none')).toEqual({ kind: 'announce' });
  });

  it('leaves a finished review alone, and ends one from before reviews had journals that was under way', () => {
    const announced: ReviewFact[] = [...tested, reported('pass'), { kind: 'posted' }, { kind: 'announced' }];
    for (const facts of [announced, [...tested, { kind: 'ended', error: 'x' }], [...tested, { kind: 'gone', merged: false }]] as ReviewFact[][]) {
      expect(reviewRecovery(foldReview(facts), 'passed', undefined)).toEqual({ kind: 'none' });
    }
    expect(reviewRecovery(foldReview([]), 'testing', undefined)).toEqual({ kind: 'interrupted', error: REVIEW_INTERRUPTED });
    expect(reviewRecovery(foldReview([]), 'passed', undefined)).toEqual({ kind: 'none' });
  });
});
