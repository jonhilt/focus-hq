import { describe, expect, it } from 'vitest';
import type { LeadPr, QaReview } from '../../shared/types';
import { claims, filedClaims, readyPrs, reflogBranches, retestAfterTurn } from './prRules';

const pr = (number: number, branch: string, more: { repo?: string; isDraft?: boolean } = {}) => ({
  repo: more.repo ?? 'demo/web',
  number,
  url: `https://github.com/demo/web/pull/${number}`,
  branch,
  baseBranch: 'main',
  isDraft: more.isDraft ?? false,
});
const nobody = () => false;

describe('claims', () => {
  it('gives a PR to the one lead whose checkout of its repo has been on its branch', () => {
    const seen = [{ leadId: 'a', repo: 'demo/web', branches: ['main', 'fix/x'] }, { leadId: 'b', repo: 'demo/web', branches: ['main', 'feat/y'] }];
    expect(claims([pr(1, 'fix/x', { isDraft: true }), pr(2, 'feat/y'), pr(3, 'other')], seen, nobody)).toEqual([
      { leadId: 'a', pr: { repo: 'demo/web', number: 1, url: 'https://github.com/demo/web/pull/1', branch: 'fix/x' }, draft: true },
      { leadId: 'b', pr: { repo: 'demo/web', number: 2, url: 'https://github.com/demo/web/pull/2', branch: 'feat/y' }, draft: false },
    ]);
  });

  it('claims nothing from a base branch, a branch two leads have been on, another repo, or a PR already held', () => {
    const seen = [{ leadId: 'a', repo: 'demo/web', branches: ['main', 'shared'] }, { leadId: 'b', repo: 'demo/web', branches: ['shared'] }, { leadId: 'a', repo: 'demo/api', branches: ['api-only'] }];
    const held = (_repo: string, number: number) => number === 4;
    expect(claims([pr(1, 'main'), pr(2, 'shared'), pr(3, 'api-only'), pr(4, 'main')], seen, held)).toEqual([]);
  });
});

describe('filedClaims', () => {
  it('keeps a PR from a closed goal’s own branch with that goal, never a base branch’s, another repo’s, or one held', () => {
    const goals = [{ id: 'g1', branch: 'focus/saved-1', repos: [{ repo: 'demo/web', folder: 'web', baseBranch: 'main' }], prs: [{ repo: 'demo/web', number: 4, url: 'u4' }] }];
    const held = (_repo: string, number: number) => number === 3;
    const filed = filedClaims([pr(1, 'focus/saved-1', { isDraft: true }), pr(2, 'focus/saved-1', { repo: 'demo/api' }), pr(3, 'focus/saved-1'), pr(4, 'focus/saved-1'), pr(5, 'main')], goals, held);
    expect(filed).toEqual([{ goalId: 'g1', pr: { repo: 'demo/web', number: 1, url: 'https://github.com/demo/web/pull/1', branch: 'focus/saved-1' }, draft: true }]);
  });
});

describe('readyPrs', () => {
  it('sends the goal’s ready PRs QA hasn’t looked at, never a draft, another’s, or one already reviewed', () => {
    const goals = (_repo: string, number: number) => number !== 4;
    const reviewed = (_repo: string, number: number) => number === 3;
    expect(readyPrs([pr(1, 'a'), pr(2, 'b', { isDraft: true }), pr(3, 'c'), pr(4, 'd')], goals, reviewed).map((p) => p.number)).toEqual([1]);
  });
});

describe('retestAfterTurn', () => {
  it('sends back the lead’s open, ready PRs QA has a verdict on, never a draft, a landed one, another’s, or one under test', () => {
    const prs: Pick<LeadPr, 'repo' | 'number' | 'outcome'>[] = [{ repo: 'demo/web', number: 1 }, { repo: 'demo/web', number: 2 }, { repo: 'demo/web', number: 3, outcome: 'merged' }, { repo: 'demo/web', number: 4 }, { repo: 'demo/web', number: 6 }];
    const board = [pr(1, 'a'), pr(2, 'b', { isDraft: true }), pr(3, 'c'), pr(4, 'd'), pr(5, 'e'), pr(6, 'f')];
    const status = new Map<number, QaReview['status']>([[1, 'failed'], [2, 'passed'], [3, 'passed'], [4, 'testing'], [5, 'passed'], [6, 'passed']]);
    const review = (_repo: string, number: number) => { const s = status.get(number); return s && { status: s }; };
    expect(retestAfterTurn(prs, board, review).map((p) => p.number)).toEqual([1, 6]);
  });
});

describe('reflogBranches', () => {
  it('reads the branches a checkout moved between, once each, and nothing else', () => {
    const reflog = 'commit: Add the header\ncheckout: moving from focus/saved-1-ab to fix/held-frame\nreset: moving to HEAD\ncheckout: moving from fix/held-frame to focus/saved-1-ab\n';
    expect(reflogBranches(reflog)).toEqual(['focus/saved-1-ab', 'fix/held-frame']);
  });
});
