import { describe, expect, it } from 'vitest';
import { carryMergeable, columns, freshBoard, goalState, prsOffBoard, resolvingAlready, staleClosedPrs } from './board';
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
