import { describe, expect, it } from 'vitest';
import type { QaReport, QaReview } from '../../shared/types';
import { foldReview, leftWithoutVerdict, resumedFacts, REVIEW_INTERRUPTED, type ReviewFact, reviewRecovery, reviewView } from './reviewJournal';

const report: QaReport = { verdict: 'pass', summary: 'Works.', checks: [], commands: [] } as unknown as QaReport;
const reported = (verdict: 'pass' | 'fail'): ReviewFact => ({ kind: 'reported', verdict, officer: 'Lt. Quintero', body: 'QA passed', failedRounds: verdict === 'pass' ? 0 : 1, report, screenshots: [], sha: 'abc' });
const asked: ReviewFact = { kind: 'requested', projectId: 'p', repo: 'o/web', number: 4, title: 'Saved items' };
const tested: ReviewFact[] = [asked, { kind: 'seated', agent: 'qa_p' }, { kind: 'testing', sha: 'abc' }];
/** Facts stamped with their time, as the journal has them. */
const at = (facts: ReviewFact[]) => facts.map((f, i) => ({ ...f, t: (i + 1) * 10 }));
const view = (facts: ReviewFact[]) => reviewView(foldReview(at(facts)));

describe('a review’s journal', () => {
  it('follows a review from being asked for to its verdict on the pull request', () => {
    expect(foldReview([asked]).phase).toBe('queued');
    expect(foldReview(tested.slice(0, 2))).toMatchObject({ phase: 'seated', agent: 'qa_p' });
    expect(foldReview(tested)).toMatchObject({ phase: 'testing', sha: 'abc' });
    expect(foldReview([...tested, reported('pass')])).toMatchObject({ phase: { reported: 'posting' }, reported: { verdict: 'pass', body: 'QA passed' } });
    expect(foldReview([...tested, reported('pass'), { kind: 'posted', url: 'u' }])).toMatchObject({ phase: { reported: 'announcing' }, reported: { url: 'u' } });
    expect(foldReview([...tested, reported('pass'), { kind: 'posted' }, { kind: 'announced' }])).toMatchObject({ phase: 'passed', verdict: 'pass' });
    expect(foldReview([...tested, reported('fail'), { kind: 'posted' }, { kind: 'announced' }])).toMatchObject({ phase: 'failed', verdict: 'fail' });
    expect(foldReview([...tested, { kind: 'ended', error: 'Stopped' }])).toMatchObject({ phase: 'error', error: 'Stopped' });
  });

  it('goes back to the last verdict when a precheck finds nothing to test, and carries a pass over', () => {
    const passed: ReviewFact[] = [...tested, reported('pass'), { kind: 'posted' }, { kind: 'announced' }, asked, { kind: 'prechecking' }];
    const failed: ReviewFact[] = [...tested, reported('fail'), { kind: 'posted' }, { kind: 'announced' }, asked, { kind: 'prechecking' }];
    expect(foldReview(passed).phase).toBe('precheck');
    expect(foldReview([...passed, { kind: 'precheck-skipped' }]).phase).toBe('passed');
    expect(foldReview([...failed, { kind: 'precheck-skipped' }]).phase).toBe('failed');
    expect(foldReview([...passed, { kind: 'precheck-carried', sha: 'def' }])).toMatchObject({ phase: 'passed', sha: 'def' });
    expect(foldReview([...passed, { kind: 'precheck-retest' }]).phase).toBe('queued');
  });

  it('is gone once its pull request is, until it’s reopened and asked for again', () => {
    expect(foldReview([...tested, { kind: 'gone', merged: true }]).phase).toBe('gone');
    expect(foldReview([...tested, { kind: 'gone', merged: false }, asked]).phase).toBe('queued');
    expect(foldReview([...tested, { kind: 'ended', error: 'x' }, asked]).phase).toBe('queued');
    // a fact out of turn changes nothing
    expect(foldReview([asked, { kind: 'announced' }]).phase).toBe('queued');
  });
});

describe('the board’s review, from the journal', () => {
  it('is what the facts say, from being asked for to the verdict posted', () => {
    expect(view([])).toBeUndefined();
    expect(view([asked])).toEqual({ projectId: 'p', repo: 'o/web', number: 4, title: 'Saved items', status: 'queued', requestedAt: 10 });
    expect(view([...tested.slice(0, 2), { kind: 'testing', sha: 'abc', title: 'Saved items, renamed' }])).toMatchObject({ status: 'testing', agentId: 'qa_p', sha: 'abc', title: 'Saved items, renamed' });
    // the verdict's on the board once it's on the pull request, not before
    expect(view([...tested, reported('fail')])?.status).toBe('testing');
    expect(view([...tested, reported('fail'), { kind: 'posted', url: 'u' }])).toMatchObject({ status: 'failed', commentUrl: 'u', failedRounds: 1, report, finishedAt: 50 });
    expect(view([...tested, { kind: 'ended', error: 'Stopped' }])).toMatchObject({ status: 'error', error: 'Stopped', finishedAt: 40 });
    expect(view([...tested, { kind: 'gone', merged: true }])).toBeUndefined();
  });

  it('carries what the last round left into the next, and puts the verdict back when there’s nothing to test', () => {
    const failedOnce: ReviewFact[] = [...tested, reported('fail'), { kind: 'posted', url: 'u' }, { kind: 'announced' }, { kind: 'merge-requested', on: true }];
    const again = view([...failedOnce, { ...asked, head: 'def', retryNote: 'Ops sent it back' }]);
    expect(again).toMatchObject({ status: 'queued', shippedHead: 'def', retryNote: 'Ops sent it back', failedRounds: 1, lastRound: { sha: 'abc', report }, mergeRequested: { at: 70 } });
    expect(again?.report).toBeUndefined();
    const skipped = view([...failedOnce, asked, { kind: 'prechecking' }, { kind: 'merge-requested', on: false }, { kind: 'precheck-skipped' }]);
    expect(skipped).toMatchObject({ status: 'failed', commentUrl: 'u', report });
    expect(skipped?.mergeRequested).toBeUndefined();
    const carried = view([...tested, reported('pass'), { kind: 'posted', url: 'u' }, { kind: 'announced' }, asked, { kind: 'prechecking' }, { kind: 'precheck-carried', sha: 'def', commentUrl: 'c' }]);
    expect(carried).toMatchObject({ status: 'passed', sha: 'def', carriedFrom: 'abc', commentUrl: 'c', finishedAt: 90 });
  });

  it('follows what Ops does about a failed PR, and the operations officer’s look', () => {
    const failed: ReviewFact[] = [...tested, reported('fail'), { kind: 'posted' }, { kind: 'announced' }];
    const fixing = { kind: 'fixing', agentId: 'a1', agentName: 'Ens. Park', fixes: { kind: 'qa' } } as const;
    expect(view([...failed, { kind: 'follow-up', followUp: fixing }])?.followUp).toEqual(fixing);
    const triaged = view([...failed, { kind: 'triaging', officer: 'Lt. Ops' }, { kind: 'triage-activity', text: 'Reading the diff' }]);
    expect(triaged).toMatchObject({ triages: 1, followUp: { kind: 'triaging', officer: 'Lt. Ops', activity: 'Reading the diff' } });
    const decided = view([...failed, { kind: 'triaging', officer: 'Lt. Ops' }, { kind: 'triaged', triage: { officer: 'Lt. Ops', action: 'escalate', note: 'n', at: 1 } }, { kind: 'follow-up', followUp: { kind: 'needs-you', reason: 'r' } }]);
    expect(decided).toMatchObject({ triage: { action: 'escalate' }, followUp: { kind: 'needs-you', reason: 'r' } });
    expect(view([...failed, { kind: 'follow-up', followUp: fixing }, { kind: 'follow-up' }])?.followUp).toBeUndefined();
  });

  it('puts a review back in line when its reviewer goes home', () => {
    expect(view([...tested, { kind: 'unseated' }])).toMatchObject({ status: 'queued', agentId: undefined });
    expect(foldReview([...tested, { kind: 'unseated' }]).phase).toBe('queued');
  });

  it('takes in a review the board kept before reviews had journals, in the phase its status says', () => {
    const saved: QaReview = { projectId: 'p', repo: 'o/web', number: 4, title: 't', status: 'passed', sha: 'abc', report, requestedAt: 1, finishedAt: 2 };
    const imported = foldReview([{ kind: 'imported', review: saved }]);
    expect(imported).toMatchObject({ phase: 'passed', verdict: 'pass', view: saved });
    for (const status of ['queued', 'testing', 'failed', 'error'] as const) expect(foldReview([{ kind: 'imported', review: { ...saved, status } }]).phase).toBe(status);
    // and goes on from there like any other
    expect(foldReview([{ kind: 'imported', review: saved }, asked, { kind: 'prechecking' }, { kind: 'precheck-skipped' }]).view).toMatchObject({ status: 'passed', report });
  });
});

describe('a review ended without a verdict', () => {
  const unjudged: ReviewFact = { kind: 'ended', error: 'Finished without a QA report.', noVerdict: true };

  it('says so on the board, for the captain, and a re-test asks for it afresh', () => {
    expect(view([...tested, unjudged])).toMatchObject({ status: 'error', error: 'Finished without a QA report.', noVerdict: true });
    expect(view([...tested, { kind: 'ended', error: 'Stopped' }])?.noVerdict).toBeUndefined();
    const again = view([...tested, unjudged, { kind: 'follow-up', followUp: { kind: 'needs-you', reason: 'r' } }, asked]);
    expect(again).toMatchObject({ status: 'queued' });
    expect(again?.noVerdict).toBeUndefined();
    expect(again?.followUp).toBeUndefined();
  });
});

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
