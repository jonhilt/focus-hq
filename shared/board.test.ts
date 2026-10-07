import { describe, expect, it } from 'vitest';
import { carryMergeable, columns, goalState, resolvingAlready } from './board';
import type { Agent, LeadWork, Project, PullRequest } from './types';

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

describe('goals on the board', () => {
  const work = (over: Partial<LeadWork> = {}): LeadWork => ({ station: 0, title: 'Saved items', repos: [], slice: 2, prs: [], ...over });
  const lead = (id: string, status: Agent['status'], over: Partial<LeadWork> = {}) =>
    ({ id, task: 'lead', status, projectId: 'p1', repo: 'acme/shop', issue: { number: 0, title: 'Saved items', url: '' }, startedAt: 0, lead: work(over) }) as Agent;
  const project = { id: 'p1', repos: ['acme/shop'] } as Project;

  it('are in progress for as long as the goal is, by team station, whether or not the lead is at it', () => {
    const agents = [lead('b', 'done', { station: 3 }), lead('a', 'working', { station: 1 }), { ...lead('dev', 'working'), task: 'issue', lead: undefined } as Agent];
    const cols = columns(project, undefined, agents, undefined);
    expect(cols.goals.map((a) => a.id)).toEqual(['a', 'b']);
    expect(cols.doing.map((a) => a.id)).toEqual(['dev']);
  });

  it('say which slice they’re on and what they’re waiting for', () => {
    expect(goalState(lead('l', 'working'))).toBe('Slice 2 · working');
    expect(goalState(lead('l', 'waiting'))).toBe('Slice 2 · needs approval');
    expect(goalState(lead('l', 'done'))).toBe('Slice 2 · waiting for you');
    const prs = [{ repo: 'acme/shop', number: 4, url: '' }, { repo: 'acme/api', number: 9, url: '' }, { repo: 'acme/api', number: 3, url: '', outcome: 'merged' as const }];
    expect(goalState(lead('l', 'done', { prs }))).toBe('Slice 2 · 2 PRs open');
    expect(goalState(lead('l', 'working', { closing: { reason: 'All shipped', at: 0 } }))).toBe('Ready to wrap up');
  });
});
