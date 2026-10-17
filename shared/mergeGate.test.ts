import { describe, expect, it } from 'vitest';
import { autoMergeFor, boardMergeSaid, conflictsSaid, forgottenMarks, type GateOffice, goneReply, mergeAction, mergeMethodFor, mergeStep, requestedMerge, stepMark, unpassedReason } from './mergeGate';
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
      .toEqual({ kind: 'blocked', reason: 'the merge was refused: reviews required' });
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

  it('waits while the merge check runs', () => {
    expect(mergeAction(review(), pr({ mergeCheck: { state: 'checking', head: HEAD } }))).toEqual({ kind: 'checking' });
  });

  it('merges past a merge check that refused it only on purpose, behind a confirm that says why', () => {
    const refused = pr({ mergeCheck: { state: 'refused', head: HEAD, reason: '`pnpm run lint` fails on its merge with the base at 1234567' } });
    expect(mergeAction(review(), refused)).toEqual({ kind: 'merge', override: true, confirm: 'Its merge check refused it: `pnpm run lint` fails on its merge with the base at 1234567. Merging past the check is noted in the ledger' });
    expect(mergeAction(review({ status: 'failed' }), refused)).toMatchObject({ override: true, confirm: expect.stringContaining('and QA failed it') });
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

describe('forgottenMarks', () => {
  const open = (...prs: [string, number][]) => ({ prs: prs.map(([repo, number]) => ({ repo, number })) });

  it('forgets the marks of PRs no longer on the board', () => {
    expect(forgottenMarks(['acme/shop#12', 'acme/shop#13'], ['acme/shop'], open(['acme/shop', 12]))).toEqual(['acme/shop#13']);
  });

  it('keeps the marks of PRs still open', () => {
    expect(forgottenMarks(['acme/shop#12'], ['acme/shop'], open(['acme/shop', 12]))).toEqual([]);
  });

  it('keeps the marks of a repo GitHub couldn’t list this time, so a refused merge isn’t tried again', () => {
    const board = { ...open(['acme/api', 3]), error: 'acme/shop: HTTP 502' };
    expect(forgottenMarks(['acme/shop#12', 'acme/api#4'], ['acme/shop', 'acme/api'], board)).toEqual(['acme/api#4']);
  });

  it('keeps the marks of repos that aren’t the project’s: another project’s refresh forgets those', () => {
    expect(forgottenMarks(['acme/blog#7'], ['acme/shop'], open())).toEqual([]);
  });

  it('reads the repo from before the last #, whatever the name holds', () => {
    expect(forgottenMarks(['acme/c#-lib#7', 'acme/c#-lib#8'], ['acme/c#-lib'], open(['acme/c#-lib', 8]))).toEqual(['acme/c#-lib#7']);
  });
});

describe('stepMark', () => {
  it('marks the head before re-running checks, sending back or resolving conflicts, so the next refresh waits', () => {
    expect(stepMark({ kind: 'rerun-checks', sha: HEAD, runIds: [77] })).toEqual({ sha: HEAD, kind: 'rerun' });
    expect(stepMark({ kind: 'send-back', sha: HEAD, checks: [] })).toEqual({ sha: HEAD, kind: 'sent-back' });
    expect(stepMark({ kind: 'resolve-conflicts', sha: HEAD })).toEqual({ sha: HEAD, kind: 'resolving' });
  });

  it('leaves no mark for a merge (only a refusal marks it), QA, waiting or a blocked PR', () => {
    expect(stepMark({ kind: 'merge', sha: HEAD })).toBeUndefined();
    expect(stepMark({ kind: 'qa', reason: 'QA hasn’t tested it' })).toBeUndefined();
    expect(stepMark({ kind: 'wait', reason: 'checks are running' })).toBeUndefined();
    expect(stepMark({ kind: 'blocked', reason: 'it’s a draft' })).toBeUndefined();
  });
});

describe('conflictsSaid', () => {
  it('says an agent is resolving them', () => {
    expect(conflictsSaid('shop#12', 'main', { kind: 'agent' })).toBe('🔧 shop#12 conflicts with main – resolving them before QA');
  });

  it('says the office merged the base in, and which files it settled by rule', () => {
    expect(conflictsSaid('shop#12', 'main', { kind: 'merged' })).toBe('🔧 shop#12 conflicts with main – the office merged main in cleanly');
    expect(conflictsSaid('shop#12', 'main', { kind: 'merged', auto: ['pnpm-lock.yaml', 'CHANGELOG.md'] }))
      .toBe('🔧 shop#12 conflicts with main – the office merged main in, settling pnpm-lock.yaml, CHANGELOG.md by rule');
  });

  it('says when GitHub is behind and it already has everything from the base', () => {
    expect(conflictsSaid('shop#12', 'develop', { kind: 'up-to-date' })).toBe('🔧 shop#12 conflicts with develop on GitHub, but it already has everything from develop');
  });
});

describe('boardMergeSaid', () => {
  it('says whether the captain’s merge was checked or went past the check', () => {
    expect(boardMergeSaid('shop#12', 'main', false)).toBe('Merged shop#12: it checks out merged onto main');
    expect(boardMergeSaid('shop#12', 'main', true)).toBe('Merged shop#12 past its merge check, as you asked');
  });
});
