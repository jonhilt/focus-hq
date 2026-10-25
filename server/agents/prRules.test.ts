import { describe, expect, it } from 'vitest';
import type { LeadPr, PrReview, QaReview } from '../../shared/types';
import { claims, filedClaims, readyPrs, reflogBranches, retestAfterTurn, REVIEW_NOTE_LIMITS, reviewNote, unheardReviews } from './prRules';

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

describe('reviews on GitHub', () => {
  const review = (id: string, state: PrReview['state'], body = ''): PrReview => ({ id, author: 'jonhilt', state, body, submittedAt: '2026-10-25T10:00:00Z' });

  it('are the lead’s to hear once each, while the pull request is open', () => {
    const reviews = [review('r1', 'COMMENTED', 'Looks close'), review('r2', 'CHANGES_REQUESTED', 'Rename it')];
    expect(unheardReviews({}, { reviews }).map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(unheardReviews({ heardReviews: ['r1'] }, { reviews }).map((r) => r.id)).toEqual(['r2']);
    expect(unheardReviews({ outcome: 'merged' }, { reviews })).toEqual([]);
    // off the board, or a provider that can't tell: none
    expect(unheardReviews({}, undefined)).toEqual([]);
    expect(unheardReviews({}, {})).toEqual([]);
  });

  it('reach the lead as who, how, what they said and their comments on the code', () => {
    expect(reviewNote('acme/web', 12, review('r1', 'CHANGES_REQUESTED', 'Close.\nRename the store first.'), [
      { author: 'jonhilt', path: 'src/store.ts', line: 42, body: 'Call this savedItems' },
      { author: 'sam', path: 'src/old.ts', body: 'Gone now?' },
    ])).toBe([
      'jonhilt reviewed acme/web#12 on GitHub and asked for changes:',
      '> Close.\n> Rename the store first.',
      'On the code:\n- src/store.ts:42:\n  > Call this savedItems\n- src/old.ts (on code that has since changed) (sam):\n  > Gone now?',
    ].join('\n\n'));
    expect(reviewNote('acme/web', 12, review('r2', 'APPROVED'), [])).toBe('jonhilt reviewed acme/web#12 on GitHub and approved it.');
    // a review that only comments and says nothing (a reply's wrapper) is nothing to tell
    expect(reviewNote('acme/web', 12, review('r3', 'COMMENTED'), [])).toBeUndefined();
  });

  it('keep a long review to its first words, and say how many comments are left on GitHub', () => {
    const many = Array.from({ length: REVIEW_NOTE_LIMITS.comments + 2 }, (_, i) => ({ author: 'jonhilt', path: 'a.ts', line: i + 1, body: 'x' }));
    const note = reviewNote('acme/web', 12, review('r1', 'COMMENTED', 'y'.repeat(REVIEW_NOTE_LIMITS.body + 10)), many) ?? '';
    expect(note).toContain(`> ${'y'.repeat(REVIEW_NOTE_LIMITS.body - 1)}…`);
    expect(note).toMatch(/…and 2 more on GitHub\.$/);
  });
});
