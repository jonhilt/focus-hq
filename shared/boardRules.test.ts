import { describe, expect, it } from 'vitest';
import { carryMergeable, prsOffBoard, resolvingAlready, staleClosedPrs } from './boardRules';
import type { Agent, ClosedPr, PullRequest } from './types';

const pr = (mergeable: PullRequest['mergeable'], over: Partial<PullRequest> = {}): PullRequest => ({
  repo: 'acme/shop',
  number: 7,
  title: 'Fix checkout',
  url: 'https://github.com/acme/shop/pull/7',
  branch: 'focus/7-fix-checkout',
  headSha: 'abc123',
  baseBranch: 'main',
  isDraft: false,
  mergeable,
  checks: 'passing',
  failedChecks: [],
  closes: [],
  createdAt: '2026-01-07T00:00:00Z',
  ...over,
});

describe('carryMergeable', () => {
  it('keeps the last definite answer while GitHub says UNKNOWN on the same commit and base', () => {
    expect(carryMergeable([pr('CONFLICTING')], [pr('UNKNOWN')])[0].mergeable).toBe('CONFLICTING');
    expect(carryMergeable([pr('MERGEABLE')], [pr('UNKNOWN')])[0].mergeable).toBe('MERGEABLE');
  });

  it('lets UNKNOWN stand once the head commit or base branch has moved', () => {
    expect(carryMergeable([pr('CONFLICTING')], [pr('UNKNOWN', { headSha: 'def456' })])[0].mergeable).toBe('UNKNOWN');
    expect(carryMergeable([pr('CONFLICTING')], [pr('UNKNOWN', { baseBranch: 'develop' })])[0].mergeable).toBe('UNKNOWN');
  });

  it('takes a definite answer from GitHub over the previous one', () => {
    expect(carryMergeable([pr('CONFLICTING')], [pr('MERGEABLE')])[0].mergeable).toBe('MERGEABLE');
    expect(carryMergeable([pr('MERGEABLE')], [pr('CONFLICTING')])[0].mergeable).toBe('CONFLICTING');
  });

  it('leaves UNKNOWN for a new PR or one with no definite answer yet', () => {
    expect(carryMergeable([], [pr('UNKNOWN')])[0].mergeable).toBe('UNKNOWN');
    expect(carryMergeable([pr('CONFLICTING', { number: 8 })], [pr('UNKNOWN')])[0].mergeable).toBe('UNKNOWN');
    expect(carryMergeable([pr('CONFLICTING', { repo: 'acme/api' })], [pr('UNKNOWN')])[0].mergeable).toBe('UNKNOWN');
    expect(carryMergeable([pr('UNKNOWN')], [pr('UNKNOWN')])[0].mergeable).toBe('UNKNOWN');
  });
});

describe('resolvingAlready', () => {
  const agent = (task: Agent['task'], status: Agent['status']) => ({ task, status });

  it('is a developer still at work on the PR, who would only hear the request twice', () => {
    expect(resolvingAlready(agent('issue', 'working'))).toBe(true);
    expect(resolvingAlready(agent('issue', 'queued'))).toBe(true);
    expect(resolvingAlready(agent('issue', 'done'))).toBe(false);
    expect(resolvingAlready(undefined)).toBe(false);
  });

  it('is never a goal’s lead: they take the conflicts on whatever else they’re doing', () => {
    expect(resolvingAlready(agent('lead', 'working'))).toBe(false);
    expect(resolvingAlready(agent('lead', 'done'))).toBe(false);
  });
});

describe('prsOffBoard', () => {
  const none = { reviews: [], leadPrs: [], agents: [] };
  const done = (number: number, over: Partial<Agent> = {}) => ({ repo: 'acme/shop', status: 'done' as const, pr: { number, url: '' }, ...over });

  it('asks about the reviews, leads’ PRs and finished agents’ PRs that left the board, reviews first', () => {
    const held = { reviews: [{ repo: 'acme/api', number: 2 }], leadPrs: [{ repo: 'acme/shop', number: 5 }], agents: [done(8)] };
    expect(prsOffBoard({ prs: [] }, held)).toEqual([
      { repo: 'acme/api', number: 2, kind: 'review' },
      { repo: 'acme/shop', number: 5, kind: 'seat' },
      { repo: 'acme/shop', number: 8, kind: 'seat' },
    ]);
  });

  it('leaves out a PR still on the board, matching its repo as well as its number', () => {
    const held = { reviews: [{ repo: 'acme/shop', number: 7 }, { repo: 'acme/api', number: 7 }], leadPrs: [{ repo: 'acme/shop', number: 7 }], agents: [done(7)] };
    expect(prsOffBoard({ prs: [pr('MERGEABLE')] }, held)).toEqual([{ repo: 'acme/api', number: 7, kind: 'review' }]);
  });

  it('waits on a repo GitHub couldn’t list', () => {
    const held = { reviews: [{ repo: 'acme/shop', number: 2 }, { repo: 'acme/api', number: 3 }], leadPrs: [{ repo: 'acme/shop', number: 5 }], agents: [done(8)] };
    expect(prsOffBoard({ prs: [], error: 'acme/shop: rate limited' }, held)).toEqual([{ repo: 'acme/api', number: 3, kind: 'review' }]);
  });

  it('only asks about an agent’s PR once the agent is done with it', () => {
    const agents = [done(1, { status: 'working' }), done(2, { status: 'error' }), { repo: 'acme/shop', status: 'done' as const }];
    expect(prsOffBoard({ prs: [] }, { ...none, agents })).toEqual([]);
  });
});

describe('staleClosedPrs', () => {
  const note = (repo: string, issue: number): ClosedPr => ({ repo, issue, pr: 90 + issue, officer: 'Data', note: 'wrong approach', at: 1 });
  const open = (repo: string, number: number) => ({ repo, number, title: '', body: '', url: '', labels: [], createdAt: '' });

  it('drops the notes whose issue is no longer open', () => {
    const closed = [note('acme/api', 2), note('acme/api', 6)];
    expect(staleClosedPrs(['acme/api'], { issues: [open('acme/api', 6)] }, closed)).toEqual([note('acme/api', 2)]);
  });

  it('keeps the notes for a repo GitHub couldn’t list, or one outside the project', () => {
    const closed = [note('acme/api', 2), note('acme/other', 3)];
    expect(staleClosedPrs(['acme/api'], { issues: [], error: 'acme/api: HTTP 502' }, closed)).toEqual([]);
  });
});
