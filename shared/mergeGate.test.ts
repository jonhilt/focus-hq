import { describe, expect, it } from 'vitest';
import { autoMergeFor, type GateOffice, goneReply, mergeAction, mergeMethodFor, mergeStep, requestedMerge, unpassedReason } from './mergeGate';
import type { PullRequest, QaReview } from './types';

const HEAD = 'abc1234def5678';

const pr = (p: Partial<PullRequest> = {}) => ({
  headSha: HEAD,
  isDraft: false,
  mergeable: 'MERGEABLE' as const,
  checks: 'passing' as const,
  failedChecks: [],
  ...p,
});

const review = (r: Partial<QaReview> = {}): QaReview => ({
  projectId: 'p',
  repo: 'acme/shop',
  number: 12,
  title: 'Save for later',
  status: 'passed',
  sha: HEAD,
  openedByOffice: true,
  requestedAt: 0,
  ...r,
});

const office = (o: Partial<GateOffice> = {}): GateOffice => ({ openedByOffice: true, developerBusy: false, autoSendBack: true, ...o });

const failing = pr({
  checks: 'failing',
  failedChecks: [
    { name: 'CI / test', url: 'https://github.com/acme/shop/actions/runs/77/job/1', runId: 77 },
    { name: 'CI / lint', url: 'https://github.com/acme/shop/actions/runs/77/job/2', runId: 77 },
  ],
});

describe('mergeStep', () => {
  it('merges the head commit once QA passed it, its checks pass and it merges cleanly', () => {
    expect(mergeStep(pr(), review(), office())).toEqual({ kind: 'merge', sha: HEAD });
  });

  it('never merges a pull request a plugin keeps for the captain (a climb), however well QA did', () => {
    expect(mergeStep(pr(), review(), office({ captainMerges: true }))).toEqual({ kind: 'blocked', reason: 'only the captain merges it' });
  });

  it('merges a PR without checks', () => {
    expect(mergeStep(pr({ checks: 'none' }), review(), office())).toEqual({ kind: 'merge', sha: HEAD });
  });

  it('never merges a teammate’s PR', () => {
    expect(mergeStep(pr(), review(), office({ openedByOffice: false }))).toEqual({ kind: 'blocked', reason: 'a teammate opened it' });
  });

  it('leaves drafts alone', () => {
    expect(mergeStep(pr({ isDraft: true }), review(), office()).kind).toBe('blocked');
  });

  it('waits for checks that are still running', () => {
    expect(mergeStep(pr({ checks: 'pending' }), review(), office())).toEqual({ kind: 'wait', reason: 'checks are running' });
  });

  it('waits while GitHub works out whether it merges', () => {
    expect(mergeStep(pr({ mergeable: 'UNKNOWN' }), review(), office()).kind).toBe('wait');
  });

  it('waits while a developer is working on it', () => {
    expect(mergeStep(pr({ mergeable: 'CONFLICTING' }), review(), office({ developerBusy: true }))).toEqual({ kind: 'wait', reason: 'a developer is working on it' });
  });

  describe('QA', () => {
    it('sends a PR QA never tested to QA', () => {
      expect(mergeStep(pr(), undefined, office())).toEqual({ kind: 'qa', reason: 'QA hasn’t tested it' });
    });

    it('sends a PR back to QA when commits arrived after the pass', () => {
      expect(mergeStep(pr({ headSha: 'fff0000aaa' }), review(), office())).toEqual({ kind: 'qa', reason: 'commits arrived after QA passed it' });
    });

    it('sends a PR back to QA when a fix arrived after a fail', () => {
      expect(mergeStep(pr({ headSha: 'fff0000aaa' }), review({ status: 'failed' }), office())).toEqual({ kind: 'qa', reason: 'commits arrived after QA failed it' });
    });

    it('waits while QA is testing', () => {
      expect(mergeStep(pr(), review({ status: 'queued' }), office()).kind).toBe('wait');
      expect(mergeStep(pr(), review({ status: 'testing' }), office()).kind).toBe('wait');
    });

    it('stops at a fail on the head commit (the QA loop sends that back)', () => {
      expect(mergeStep(pr(), review({ status: 'failed' }), office())).toEqual({ kind: 'blocked', reason: 'QA failed it' });
    });

    it('stops when QA couldn’t finish', () => {
      expect(mergeStep(pr(), review({ status: 'error' }), office()).kind).toBe('blocked');
    });

    it('won’t merge when it can’t tell which commit QA passed', () => {
      expect(mergeStep(pr(), review({ sha: undefined }), office()).kind).toBe('blocked');
      expect(mergeStep(pr({ headSha: undefined }), review(), office()).kind).toBe('blocked');
    });

    it('stops when the office gave up on the PR', () => {
      expect(mergeStep(failing, review({ followUp: { kind: 'needs-you', reason: 'Ada pushed no fix' } }), office({ mark: { sha: HEAD, kind: 'sent-back' } })))
        .toEqual({ kind: 'blocked', reason: 'Ada pushed no fix' });
    });
  });

  describe('failing checks', () => {
    it('re-runs the failed Actions runs once', () => {
      expect(mergeStep(failing, review(), office())).toEqual({ kind: 'rerun-checks', sha: HEAD, runIds: [77] });
    });

    it('sends the PR back to its developer with the failing checks when they fail again', () => {
      expect(mergeStep(failing, review(), office({ mark: { sha: HEAD, kind: 'rerun' } }))).toEqual({ kind: 'send-back', sha: HEAD, checks: failing.failedChecks });
    });

    it('sends it straight back when there’s nothing to re-run', () => {
      const external = pr({ checks: 'failing', failedChecks: [{ name: 'ci/circleci', url: 'https://circleci.com/x' }] });
      expect(mergeStep(external, review(), office()).kind).toBe('send-back');
    });

    it('re-runs again for a new head commit', () => {
      expect(mergeStep(failing, review(), office({ mark: { sha: 'fff0000aaa', kind: 'sent-back' } })).kind).toBe('rerun-checks');
    });

    it('stops once the PR went back and its checks still fail', () => {
      expect(mergeStep(failing, review(), office({ mark: { sha: HEAD, kind: 'sent-back' } })).kind).toBe('blocked');
    });

    it('stops when the project doesn’t send PRs back', () => {
      expect(mergeStep(failing, review(), office({ autoSendBack: false, mark: { sha: HEAD, kind: 'rerun' } }))).toEqual({ kind: 'blocked', reason: 'checks fail' });
    });
  });

  describe('conflicts', () => {
    it('resolves conflicts first, whatever QA said', () => {
      expect(mergeStep(pr({ mergeable: 'CONFLICTING' }), review(), office())).toEqual({ kind: 'resolve-conflicts', sha: HEAD });
      expect(mergeStep(pr({ mergeable: 'CONFLICTING' }), undefined, office()).kind).toBe('resolve-conflicts');
    });

    it('stops when resolving them left the PR where it was', () => {
      expect(mergeStep(pr({ mergeable: 'CONFLICTING' }), review(), office({ mark: { sha: HEAD, kind: 'resolving' } })).kind).toBe('blocked');
    });

    it('goes back to QA once the resolved commit is up', () => {
      expect(mergeStep(pr({ headSha: 'fff0000aaa' }), review(), office({ mark: { sha: HEAD, kind: 'resolving' } })).kind).toBe('qa');
    });
  });

  it('stops trying once GitHub refused to merge the head commit', () => {
    expect(mergeStep(pr(), review(), office({ mark: { sha: HEAD, kind: 'refused', reason: 'reviews required' } })))
      .toEqual({ kind: 'blocked', reason: 'GitHub refused the merge: reviews required' });
  });
});

describe('unpassedReason', () => {
  it('lets a PR QA passed at its head merge without asking', () => {
    expect(unpassedReason(review(), { headSha: HEAD })).toBeUndefined();
  });

  it('names why anything else needs confirming', () => {
    expect(unpassedReason(undefined, { headSha: HEAD })).toBe('QA hasn’t tested it');
    expect(unpassedReason(review({ status: 'failed' }), { headSha: HEAD })).toBe('QA failed it');
    expect(unpassedReason(review({ status: 'failed', followUp: { kind: 'triaging', officer: 'Lt. Varga', activity: 'Reading the diff' } }), { headSha: HEAD })).toBe('QA failed it');
    expect(unpassedReason(review(), { headSha: 'fff0000aaa' })).toBe('QA passed an older commit, not the latest one');
    expect(unpassedReason(review({ status: 'testing' }), { headSha: HEAD })).toBe('QA hasn’t finished testing it');
  });
});

describe('autoMergeFor', () => {
  it('is off unless the project switched it on', () => {
    expect(autoMergeFor({})).toBe(false);
    expect(autoMergeFor({ autoMerge: true })).toBe(true);
  });
});

describe('mergeAction', () => {
  it('merges a PR QA passed straight away', () => {
    expect(mergeAction(review(), pr())).toEqual({ kind: 'merge' });
  });

  it('offers to merge when QA passes while QA is queued or testing', () => {
    expect(mergeAction(review({ status: 'queued', sha: undefined }), pr())).toEqual({ kind: 'when-passed' });
    expect(mergeAction(review({ status: 'testing' }), pr())).toEqual({ kind: 'when-passed' });
  });

  it('says so once the captain asked for that', () => {
    expect(mergeAction(review({ status: 'testing', mergeRequested: { at: 1 } }), pr())).toEqual({ kind: 'requested' });
  });

  it('still merges a failed or untested PR, behind a confirm', () => {
    expect(mergeAction(review({ status: 'failed' }), pr())).toEqual({ kind: 'merge', confirm: 'QA failed it' });
    expect(mergeAction(undefined, pr())).toEqual({ kind: 'merge', confirm: 'QA hasn’t tested it' });
    expect(mergeAction(review({ sha: 'fff0000' }), pr())).toEqual({ kind: 'merge', confirm: 'QA passed an older commit, not the latest one' });
  });
});

describe('requestedMerge', () => {
  it('waits while QA is queued or testing', () => {
    expect(requestedMerge(pr(), review({ status: 'queued', sha: undefined }))).toEqual({ kind: 'wait' });
    expect(requestedMerge(pr(), review({ status: 'testing' }))).toEqual({ kind: 'wait' });
  });

  it('merges exactly the commit QA passed', () => {
    expect(requestedMerge(pr({ headSha: HEAD }), review({ sha: HEAD.slice(0, 7) }))).toEqual({ kind: 'merge', sha: HEAD });
  });

  it('drops the request when QA fails or can’t finish', () => {
    expect(requestedMerge(pr(), review({ status: 'failed' }))).toEqual({ kind: 'drop', reason: 'QA failed it' });
    expect(requestedMerge(pr(), review({ status: 'error' }))).toEqual({ kind: 'drop', reason: 'QA couldn’t finish testing it' });
  });

  it('goes back to QA when commits arrived after the pass', () => {
    expect(requestedMerge(pr({ headSha: 'fff0000111' }), review())).toEqual({ kind: 'qa', reason: 'commits arrived after QA passed it' });
  });

  it('waits for GitHub and the checks, and drops a PR that conflicts', () => {
    expect(requestedMerge(pr({ checks: 'pending' }), review())).toEqual({ kind: 'wait' });
    expect(requestedMerge(pr({ mergeable: 'UNKNOWN' }), review())).toEqual({ kind: 'wait' });
    expect(requestedMerge(pr({ mergeable: 'CONFLICTING' }), review())).toEqual({ kind: 'drop', reason: 'it conflicts with its base branch' });
  });
});

describe('goneReply', () => {
  it('tells whoever messages QA there is nothing left to review', () => {
    expect(goneReply(139, 'merged')).toBe('PR #139 was merged; nothing to review');
  });
});

describe('mergeMethodFor', () => {
  it('uses the repo’s own choice over the office-wide one', () => {
    expect(mergeMethodFor({ mergeMethods: { 'o/a': 'rebase' } }, 'o/a', 'squash')).toBe('rebase');
  });
  it('falls back to the office-wide setting for a repo without one', () => {
    expect(mergeMethodFor({ mergeMethods: { 'o/a': 'rebase' } }, 'o/b', 'merge')).toBe('merge');
    expect(mergeMethodFor({}, 'o/a', 'squash')).toBe('squash');
    expect(mergeMethodFor(undefined, 'o/a', 'squash')).toBe('squash');
  });
});
