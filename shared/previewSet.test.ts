import { describe, expect, it } from 'vitest';
import { chosenSet, featureSlugs, linkedPrs, previewIncludes, previewPrsGone, previewSet } from './previewSet';
import type { Issue, PullRequest } from './types';

const REPOS = ['acme/api', 'acme/web', 'acme/admin'];

const issue = (repo: string, number: number, labels: string[]): Issue => ({
  repo,
  number,
  title: `Issue ${number}`,
  body: '',
  url: '',
  labels,
  createdAt: '2026-10-01T00:00:00Z',
});

const pr = (repo: string, number: number, closes: number[], updatedAt?: string): PullRequest => ({
  repo,
  number,
  title: `PR ${number}`,
  url: '',
  branch: `focus/${number}`,
  baseBranch: 'main',
  isDraft: false,
  mergeable: 'MERGEABLE',
  checks: 'passing',
  failedChecks: [],
  closes,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt,
});

const issues = [issue('acme/api', 5, ['feature:x']), issue('acme/web', 3, ['enhancement', 'Feature:X']), issue('acme/admin', 2, ['bug'])];
const apiPr = pr('acme/api', 10, [5]);
const webPr = pr('acme/web', 12, [3]);
const adminPr = pr('acme/admin', 7, [2]);
const board = { issues, prs: [apiPr, webPr, adminPr] };

describe('featureSlugs', () => {
  it('picks feature:<slug> labels, case-insensitively', () => {
    expect(featureSlugs(['bug', 'feature:Bulk-Export', 'FEATURE: wishlist ', 'feature:'])).toEqual(['bulk-export', 'wishlist']);
  });
});

describe('previewSet', () => {
  it('brings along the PRs closing issues with the same feature label, from either side', () => {
    expect(previewSet(apiPr, board, REPOS)).toEqual({ 'acme/api': 10, 'acme/web': 12, 'acme/admin': null });
    expect(previewSet(webPr, board, REPOS)).toEqual({ 'acme/web': 12, 'acme/api': 10, 'acme/admin': null });
  });

  it('gives a PR without a feature only itself, the other repos at their default branch', () => {
    expect(previewSet(adminPr, board, REPOS)).toEqual({ 'acme/admin': 7, 'acme/api': null, 'acme/web': null });
    expect(linkedPrs(adminPr, board)).toEqual([]);
  });

  it('ignores an issue number from another repo', () => {
    const stray = pr('acme/admin', 8, [5]); // admin#5 doesn't exist; api#5 is feature:x
    expect(previewSet(stray, { issues, prs: [...board.prs, stray] }, REPOS)).toEqual({ 'acme/admin': 8, 'acme/api': null, 'acme/web': null });
  });

  it('picks the most recently updated of two linked PRs in a repo, and lists the other', () => {
    const older = pr('acme/web', 20, [3], '2026-10-02T00:00:00Z');
    const newer = pr('acme/web', 15, [3], '2026-10-04T00:00:00Z');
    const prs = [apiPr, older, newer];
    expect(previewSet(apiPr, { issues, prs }, REPOS)['acme/web']).toBe(15);
    expect(linkedPrs(apiPr, { issues, prs }).map((p) => p.number)).toEqual([15, 20]);
  });

  it('falls back to the highest PR number when it can’t tell which was updated last', () => {
    const prs = [apiPr, pr('acme/web', 15, [3], '2026-10-04T00:00:00Z'), pr('acme/web', 20, [3])];
    expect(previewSet(apiPr, { issues, prs }, REPOS)['acme/web']).toBe(20);
  });

  it('links through any of an issue’s features', () => {
    const both = [issue('acme/api', 5, ['feature:x', 'feature:y']), issue('acme/admin', 2, ['feature:y'])];
    expect(previewSet(apiPr, { issues: both, prs: board.prs }, REPOS)).toEqual({ 'acme/api': 10, 'acme/web': null, 'acme/admin': 7 });
  });
});

describe('chosenSet', () => {
  it('is the linked set when the manager picked nothing', () => {
    expect(chosenSet(apiPr, board, REPOS)).toEqual(previewSet(apiPr, board, REPOS));
  });

  it('takes the manager’s picks: another open PR, or the default branch', () => {
    expect(chosenSet(apiPr, board, REPOS, { 'acme/web': null, 'acme/admin': 7 })).toEqual({ 'acme/api': 10, 'acme/web': null, 'acme/admin': 7 });
  });

  it('keeps the clicked PR and ignores repos outside the project', () => {
    expect(chosenSet(apiPr, board, REPOS, { 'acme/api': null, 'other/repo': 1 })).toEqual({ 'acme/api': 10, 'acme/web': 12, 'acme/admin': null });
  });

  it('runs the default branch for a pick that is no longer open', () => {
    expect(chosenSet(apiPr, board, REPOS, { 'acme/admin': 99 })['acme/admin']).toBeNull();
  });
});

describe('previewIncludes', () => {
  const preview = { repo: 'acme/api', number: 10, checkouts: [{ repo: 'acme/api', ref: { pr: 10 } }, { repo: 'acme/web', ref: { pr: 12 } }, { repo: 'acme/admin', ref: { branch: 'main' } }] };

  it('covers the clicked PR and the ones checked out with it', () => {
    expect(previewIncludes(preview, 'acme/api', 10)).toBe(true);
    expect(previewIncludes(preview, 'acme/web', 12)).toBe(true);
    expect(previewIncludes(preview, 'acme/admin', 7)).toBe(false);
    expect(previewIncludes({ ...preview, checkouts: [] }, 'acme/api', 10)).toBe(true);
  });
});

describe('previewPrsGone', () => {
  const preview = { repo: 'acme/api', number: 10, checkouts: [{ repo: 'acme/api', ref: { pr: 10 } }, { repo: 'acme/web', ref: { pr: 12 } }, { repo: 'acme/admin', ref: { branch: 'main' } }] };

  it('names the preview’s PRs that left the board', () => {
    expect(previewPrsGone(preview, { prs: [apiPr, adminPr] })).toEqual([{ repo: 'acme/web', number: 12 }]);
    expect(previewPrsGone(preview, { prs: [adminPr] })).toEqual([
      { repo: 'acme/api', number: 10 },
      { repo: 'acme/web', number: 12 },
    ]);
    expect(previewPrsGone(preview, board)).toEqual([]);
  });

  it('leaves a repo GitHub couldn’t list alone, and has nothing to say without a preview', () => {
    expect(previewPrsGone(preview, { prs: [], error: 'acme/web: HTTP 502' })).toEqual([{ repo: 'acme/api', number: 10 }]);
    expect(previewPrsGone(undefined, { prs: [] })).toEqual([]);
  });
});
