import { describe, expect, it } from 'vitest';
import type { Board, PullRequest } from '../shared/types';
import { issueRefusal, previewTarget } from './officeRequests';

const project = { name: 'Shop', repos: ['acme/shop', 'acme/api'] };

describe('issueRefusal', () => {
  it('files an issue with a title in one of the project’s repos', () => {
    expect(issueRefusal(project, 'acme/api', 'Show stock levels')).toBeUndefined();
  });

  it('refuses a repo outside the project, first', () => {
    expect(issueRefusal(project, 'acme/other', '')).toBe('acme/other is not part of Shop');
  });

  it('refuses an issue with only blanks for a title', () => {
    expect(issueRefusal(project, 'acme/shop', ' \n')).toBe('An issue needs a title');
  });
});

describe('previewTarget', () => {
  const pr = (repo: string, number: number): PullRequest => ({
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
    closes: [],
    createdAt: '2026-10-01T00:00:00Z',
  });
  const board: Board = { projectId: 'p1', issues: [], prs: [pr('acme/shop', 7), pr('acme/api', 8)], updatedAt: 0 };

  it('finds the open PR on the board, by repo and number', () => {
    expect(previewTarget(project, board, 'acme/api', 8)).toEqual({ board, pr: board.prs[1] });
  });

  it('refuses a repo outside the project, first', () => {
    expect(previewTarget(project, undefined, 'acme/other', 7)).toBe('acme/other is not part of Shop');
  });

  it('refuses a PR that isn’t open on the board, or a board not loaded yet', () => {
    expect(previewTarget(project, board, 'acme/api', 7)).toBe('acme/api#7 is not an open pull request');
    expect(previewTarget(project, undefined, 'acme/shop', 7)).toBe('acme/shop#7 is not an open pull request');
  });
});
