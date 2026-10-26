import { describe, expect, it } from 'vitest';
import { columns, freshBoard, goalState } from './board';
import type { Agent, Board, ClosedPr, Issue, LeadWork, Project, PullRequest } from './types';

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

describe('a pull request being resolved', () => {
  const project = { id: 'p1', repos: ['acme/web'] } as Project;
  const pr = { repo: 'acme/web', number: 12, branch: 'focus/goal-1', mergeable: 'CONFLICTING' } as PullRequest;
  const lead = { id: 'lead_p1_a', task: 'lead', status: 'done', repo: 'acme/web', issue: { number: 0 }, lead: { prs: [{ repo: 'acme/web', number: 12 }] } } as unknown as Agent;
  const resolver = (status: Agent['status']) => ({ id: 'agent_r', task: 'conflicts', status, repo: 'acme/web', issue: { number: 12 }, pr: { number: 12 } }) as unknown as Agent;

  it('names who is resolving its conflicts, and keeps the lead as whose it is', () => {
    const [card] = columns(project, { prs: [pr], issues: [] } as unknown as Board, [lead, resolver('working')], undefined).prs;
    expect(card.agent?.id).toBe('lead_p1_a');
    expect(card.resolver?.id).toBe('agent_r');
  });

  it('has no resolver once they’ve finished', () => {
    const [card] = columns(project, { prs: [pr], issues: [] } as unknown as Board, [resolver('done'), lead], undefined).prs;
    expect(card.agent?.id).toBe('lead_p1_a');
    expect(card.resolver).toBeUndefined();
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

describe('freshBoard', () => {
  const issue = (repo: string, number: number, createdAt: string): Issue => ({ repo, number, title: `#${number}`, body: '', url: '', labels: [], createdAt });
  const note = (repo: string, issue: number): ClosedPr => ({ repo, issue, pr: 90 + issue, officer: 'Data', note: 'wrong approach', at: 1 });

  it('puts every listed repo’s issues and PRs together, oldest first', () => {
    const board = freshBoard(
      'p1',
      [
        { repo: 'acme/web', issues: [issue('acme/web', 4, '2026-01-04')], prs: [pr('MERGEABLE', { repo: 'acme/web', number: 9, createdAt: '2026-01-09' })] },
        { repo: 'acme/api', issues: [issue('acme/api', 2, '2026-01-02'), issue('acme/api', 6, '2026-01-06')], prs: [pr('MERGEABLE', { repo: 'acme/api', number: 3, createdAt: '2026-01-03' })] },
      ],
      [],
      [],
      42,
    );
    expect(board.projectId).toBe('p1');
    expect(board.updatedAt).toBe(42);
    expect(board.issues.map((i) => `${i.repo}#${i.number}`)).toEqual(['acme/api#2', 'acme/web#4', 'acme/api#6']);
    expect(board.prs.map((p) => `${p.repo}#${p.number}`)).toEqual(['acme/api#3', 'acme/web#9']);
    expect(board.error).toBeUndefined();
  });

  it('names each repo GitHub couldn’t list on a line of its own, and keeps the others', () => {
    const board = freshBoard(
      'p1',
      [
        { repo: 'acme/api', error: 'HTTP 502' },
        { repo: 'acme/web', issues: [issue('acme/web', 4, '2026-01-04')], prs: [] },
        { repo: 'acme/admin', error: 'not found' },
      ],
      [],
      [],
      0,
    );
    expect(board.error).toBe('acme/api: HTTP 502\nacme/admin: not found');
    expect(board.issues.map((i) => i.number)).toEqual([4]);
  });

  it('marks the issues Ops closed a PR for, and only those', () => {
    const board = freshBoard('p1', [{ repo: 'acme/api', issues: [issue('acme/api', 2, '2026-01-02'), issue('acme/api', 6, '2026-01-06')], prs: [] }], [], [note('acme/api', 6), note('acme/web', 2)], 0);
    expect(board.issues.map((i) => i.closedPr?.pr)).toEqual([undefined, 96]);
  });

  it('keeps the last board’s mergeability while GitHub works it out', () => {
    const board = freshBoard('p1', [{ repo: 'acme/shop', issues: [], prs: [pr('UNKNOWN')] }], [pr('CONFLICTING')], [], 0);
    expect(board.prs[0].mergeable).toBe('CONFLICTING');
  });
});
