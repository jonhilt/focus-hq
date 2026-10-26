import { describe, expect, it } from 'vitest';
import type { QaReport } from '../../shared/types';
import { foldReview, type ReviewFact } from './reviewJournal';
import { leftWithoutVerdict, resumedFacts, REVIEW_INTERRUPTED, reviewRecovery } from './reviewJournalRules';

const report: QaReport = { verdict: 'pass', summary: 'Works.', checks: [], commands: [] } as unknown as QaReport;
const reported = (verdict: 'pass' | 'fail'): ReviewFact => ({ kind: 'reported', verdict, officer: 'Lt. Quintero', body: 'QA passed', failedRounds: verdict === 'pass' ? 0 : 1, report, screenshots: [], sha: 'abc' });
const asked: ReviewFact = { kind: 'requested', projectId: 'p', repo: 'o/web', number: 4, title: 'Saved items' };
const tested: ReviewFact[] = [asked, { kind: 'seated', agent: 'qa_p' }, { kind: 'testing', sha: 'abc' }];

const at = (facts: ReviewFact[]) => facts.map((f, i) => ({ ...f, t: (i + 1) * 10 }));

describe('leftWithoutVerdict', () => {
  const testing = foldReview(tested);
  const reviewer = { id: 'qa_p', status: 'working' as const };
  const at = { closing: false, over: false };

  it('is a review under test once its reviewer’s session is over: Ops done with their last turn, or they’re done or failed', () => {
    expect(leftWithoutVerdict(testing, reviewer, { ...at, over: true })).toBe(true);
    expect(leftWithoutVerdict(testing, { ...reviewer, status: 'done' }, at)).toBe(true);
    expect(leftWithoutVerdict(testing, { ...reviewer, status: 'error' }, at)).toBe(true);
  });

  it('isn’t while they’re at work, or held for the plan’s limit', () => {
    expect(leftWithoutVerdict(testing, reviewer, at)).toBe(false);
    expect(leftWithoutVerdict(testing, { ...reviewer, status: 'stopped', held: { until: 5 } }, { ...at, over: true })).toBe(false);
  });

  it('isn’t once the captain stopped them, the PR’s gone, or while Focus shuts down', () => {
    expect(leftWithoutVerdict(testing, { ...reviewer, status: 'stopped' }, { ...at, over: true })).toBe(false);
    expect(leftWithoutVerdict(testing, { ...reviewer, status: 'done', prGone: 'merged' }, { ...at, over: true })).toBe(false);
    expect(leftWithoutVerdict(testing, { ...reviewer, status: 'done' }, { closing: true, over: true })).toBe(false);
  });

  it('isn’t a review that isn’t under test, or is under test by someone else', () => {
    for (const facts of [[asked], tested.slice(0, 2), [...tested, reported('pass')], [...tested, { kind: 'ended', error: 'x' } as ReviewFact]]) {
      expect(leftWithoutVerdict(foldReview(facts), { ...reviewer, status: 'done' }, { ...at, over: true })).toBe(false);
    }
    expect(leftWithoutVerdict(testing, { id: 'qa_other', status: 'done' }, { ...at, over: true })).toBe(false);
  });
});

describe('a review whose reviewer the captain picks back up', () => {
  /** The review after the facts, the reviewer picked back up, and the verdict their turn reaches. */
  const resumed = (facts: ReviewFact[]) => {
    const before = foldReview(at(facts));
    return foldReview(at([...facts, ...resumedFacts(before, 'qa_p'), reported('pass')]));
  };
  const failed: ReviewFact[] = [...tested, { kind: 'ended', error: 'Credit balance is too low' }];

  it('is under test again, so the verdict their turn reaches is posted: after their turn failed, or asked for again since', () => {
    expect(resumed(failed)).toMatchObject({ phase: { reported: 'posting' }, agent: 'qa_p', reported: { verdict: 'pass' } });
    expect(resumed([...failed, asked])).toMatchObject({ phase: { reported: 'posting' }, reported: { verdict: 'pass' } });
    expect(resumed(failed).view).toMatchObject({ status: 'testing', sha: 'abc', repo: 'o/web', number: 4, title: 'Saved items' });
    // as it was, the verdict went nowhere
    expect(foldReview([...failed, reported('pass')]).phase).toBe('error');
    expect(foldReview([...failed, asked, reported('pass')]).phase).toBe('queued');
  });

  it('carries over what the last round left', () => {
    const rounds = resumed([...tested, reported('fail'), { kind: 'posted' }, { kind: 'announced' }, asked, ...tested.slice(1), { kind: 'ended', error: 'x' }]);
    expect(rounds.view).toMatchObject({ failedRounds: 1, lastRound: { sha: 'abc' } });
  });

  it('changes nothing under test, with a verdict in hand or given, never checked out, or gone', () => {
    const none = (facts: ReviewFact[]) => resumedFacts(foldReview(at(facts)), 'qa_p');
    expect(none(tested)).toEqual([]);
    expect(none([...tested, reported('pass')])).toEqual([]);
    expect(none([...tested, reported('pass'), { kind: 'posted' }, { kind: 'announced' }])).toEqual([]);
    expect(none([asked, { kind: 'seated', agent: 'qa_p' }, { kind: 'ended', error: 'No checkout' }])).toEqual([]);
    expect(none([...tested, { kind: 'gone', merged: true }])).toEqual([]);
  });
});

describe('a review after a restart', () => {
  it('waits for a reviewer again, or QA tests it when Ops was still looking at it', () => {
    expect(reviewRecovery(foldReview([asked]), undefined)).toEqual({ kind: 'queue' });
    expect(reviewRecovery(foldReview([asked, { kind: 'prechecking' }]), undefined)).toEqual({ kind: 'retest' });
  });

  it('starts again when its reviewer was still setting up', () => {
    expect(reviewRecovery(foldReview(tested.slice(0, 2)), 'requeue')).toEqual({ kind: 'restart' });
  });

  it('carries on with its reviewer’s turn when that picks itself back up, and ends otherwise', () => {
    const testing = foldReview(tested);
    for (const reviewer of ['resume', 'hold-again', 'requeue'] as const) expect(reviewRecovery(testing, reviewer)).toEqual({ kind: 'carry-on' });
    // on the API key, or with no conversation to go back to
    for (const reviewer of ['wait', 'hold', 'none', undefined] as const) expect(reviewRecovery(testing, reviewer)).toEqual({ kind: 'interrupted', error: REVIEW_INTERRUPTED });
  });

  it('posts a verdict it had, and tells everyone of one it posted', () => {
    expect(reviewRecovery(foldReview([...tested, reported('pass')]), 'none')).toEqual({ kind: 'post' });
    expect(reviewRecovery(foldReview([...tested, reported('pass'), { kind: 'posted', url: 'u' }]), 'none')).toEqual({ kind: 'announce' });
  });

  it('leaves a finished review alone', () => {
    const announced: ReviewFact[] = [...tested, reported('pass'), { kind: 'posted' }, { kind: 'announced' }];
    for (const facts of [announced, [...tested, { kind: 'ended', error: 'x' }], [...tested, { kind: 'gone', merged: false }], []] as ReviewFact[][]) {
      expect(reviewRecovery(foldReview(facts), undefined)).toEqual({ kind: 'none' });
    }
  });
});
