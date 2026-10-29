import { describe, expect, it } from 'vitest';
import type { Agent, Board, GoalRecord, IssueDraft, Project, PullRequest, QaReview, Snapshot } from '../../shared/types';
import { closedGoalPrs, lookUpPrStates, summariseShip } from './shipStatus';

const project = { id: 'p1', name: 'Shop', repos: ['acme/shop', 'acme/shop-api'] } as Project;
const agent = (patch: Partial<Agent>): Agent =>
  ({ id: 'a1', name: 'Ensign Reyes', projectId: 'p1', repo: 'acme/shop', task: 'issue', issue: { number: 12, title: 'Add a wishlist', url: '' }, status: 'working', activity: 'Editing src/cart.ts', ...patch }) as Agent;
const pr = (patch: Partial<PullRequest>): PullRequest =>
  ({ repo: 'acme/shop', number: 40, title: 'Wishlist', url: '', branch: 'b', headSha: 'abcdef1234', baseBranch: 'main', isDraft: false, mergeable: 'MERGEABLE', checks: 'passing', failedChecks: [], closes: [], createdAt: '', ...patch });

function snapshot(patch: Partial<Snapshot> = {}): Snapshot {
  return {
    projects: [project],
    agents: [],
    boards: [],
    lines: {},
    browser: {},
    previews: [],
    drafts: [],
    reviews: [],
    ...patch,
  } as unknown as Snapshot;
}

const worktree = (id: string) => `/ws/${id}`;

describe('summariseShip', () => {
  it('leaves hidden projects out', () => {
    const secret = { id: 'p2', name: 'Secret', repos: ['acme/secret'], hidden: true } as Project;
    const status = summariseShip(snapshot({ projects: [project, secret], agents: [agent({}), agent({ id: 'a2', projectId: 'p2' })] }), worktree);
    expect(status.projects.map((p) => p.name)).toEqual(['Shop']);
    expect(JSON.stringify(status)).not.toContain('secret');
  });

  it('lists each agent with their issue, status and worktree, without terminal lines or browser frames', () => {
    const status = summariseShip(
      snapshot({
        agents: [agent({})],
        lines: { a1: [{ t: 0, kind: 'text', text: 'SECRET TERMINAL LINE' }] },
        browser: { a1: { url: 'http://x', image: 'data:image/jpeg;base64,FRAME', at: 0 } },
      }),
      worktree,
    );
    expect(status.projects[0].agents).toEqual([{ name: 'Ensign Reyes', task: 'issue', repo: 'acme/shop', issue: '#12 Add a wishlist', status: 'working', activity: 'Editing src/cart.ts', worktree: '/ws/a1' }]);
    const text = JSON.stringify(status);
    expect(text).not.toContain('SECRET TERMINAL LINE');
    expect(text).not.toContain('FRAME');
  });

  it('shows each open PR with QA’s verdict and its checks', () => {
    const review = { projectId: 'p1', repo: 'acme/shop', number: 40, status: 'passed', sha: 'abcdef1234' } as QaReview;
    const failing = pr({ number: 41, checks: 'failing', failedChecks: [{ name: 'build' }] });
    const status = summariseShip(snapshot({ boards: [{ projectId: 'p1', issues: [], prs: [pr({}), failing], updatedAt: 0 }], reviews: [review] }), worktree);
    expect(status.projects[0].prs).toEqual([
      { repo: 'acme/shop', number: 40, title: 'Wishlist', author: undefined, draft: false, qa: 'QA passed', checks: 'passing', conflicts: false },
      { repo: 'acme/shop', number: 41, title: 'Wishlist', author: undefined, draft: false, qa: 'not tested', checks: 'failing', failedChecks: ['build'], conflicts: false },
    ]);
  });

  it('collects what needs the captain: raised hands, problems, conflicts, stuck PRs, merges and drafts', () => {
    const board: Board = { projectId: 'p1', issues: [], prs: [pr({}), pr({ number: 41, mergeable: 'CONFLICTING' }), pr({ number: 42 })], updatedAt: 0 };
    const reviews = [
      { repo: 'acme/shop', number: 40, status: 'passed', sha: 'abcdef1234' },
      { repo: 'acme/shop', number: 42, status: 'failed', sha: 'abcdef1234', followUp: { kind: 'needs-you', reason: 'Failed three rounds' } },
    ] as QaReview[];
    const status = summariseShip(
      snapshot({
        agents: [agent({ status: 'waiting', permission: { id: 'x', tool: 'Bash', summary: 'rm -rf dist', at: 0 } }), agent({ id: 'a2', name: 'Lt. Novak', status: 'error', error: 'Out of credit' })],
        boards: [board],
        reviews,
        drafts: [{ projectId: 'p1', status: 'ready', idea: 'wishlists', title: 'Add wishlists' } as IssueDraft],
      }),
      worktree,
    );
    expect(status.projects[0].needsCaptain).toEqual([
      'Ensign Reyes has a hand up: rm -rf dist',
      'Lt. Novak hit a problem: Out of credit',
      'acme/shop#40 passed QA: ready to merge',
      'acme/shop#41 conflicts with main',
      'acme/shop#42 failed QA and needs you: Failed three rounds',
      'An issue draft is waiting at Ops: “Add wishlists”',
    ]);
  });

  it('trims long PR lists and titles', () => {
    const prs = Array.from({ length: 20 }, (_, i) => pr({ number: i + 1, title: 'x'.repeat(200) }));
    const status = summariseShip(snapshot({ boards: [{ projectId: 'p1', issues: [], prs, updatedAt: 0 }] }), worktree);
    expect(status.projects[0].prs).toHaveLength(15);
    expect(status.projects[0].morePrs).toBe(5);
    expect(status.projects[0].prs[0].title.length).toBe(80);
  });

  it('says which goal a lead is on, and which slice, not an issue', () => {
    const lead = agent({ id: 'lead_p1_ab12', task: 'lead', issue: { number: 0, title: 'Saved items', url: '' }, lead: { station: 1, title: 'Saved items', repos: [], slice: 2, prs: [] } });
    expect(summariseShip(snapshot({ agents: [lead] }), worktree).projects[0].agents[0].issue).toBe('Goal “Saved items”, slice 2, with the captain');
  });

  const goal = (patch: Partial<GoalRecord>): GoalRecord => ({
    id: 'g1',
    title: 'Saved items',
    note: { done: 'Shoppers find saved items on any device', learned: [], next: [] },
    slices: 3,
    prs: [
      { repo: 'acme/shop', number: 50, url: '' },
      { repo: 'acme/shop-api', number: 7, url: '', outcome: 'merged' },
      { repo: 'acme/shop', number: 51, url: '', outcome: 'closed' },
    ],
    leadName: 'Cmdr Vale',
    openedAt: 0,
    closedAt: Date.UTC(2026, 9, 1),
    ...patch,
  });
  const withGoals = (goals: GoalRecord[]) => snapshot({ projects: [{ ...project, goals }] });

  it('lists closed goals with each PR’s live state, not the one recorded when the goal closed', () => {
    const live = new Map([
      ['acme/shop#50', 'merged'],
      ['acme/shop-api#7', 'closed'],
      ['acme/shop#51', 'open'],
    ] as const);
    const status = summariseShip(withGoals([goal({})]), worktree, new Map(live));
    expect(status.projects[0].closedGoals).toEqual([
      {
        title: 'Saved items',
        lead: 'Cmdr Vale',
        slices: 3,
        closedAt: '2026-10-01T00:00:00.000Z',
        done: 'Shoppers find saved items on any device',
        prs: [
          { repo: 'acme/shop', number: 50, state: 'merged' },
          { repo: 'acme/shop-api', number: 7, state: 'closed' },
          { repo: 'acme/shop', number: 51, state: 'open' },
        ],
      },
    ]);
  });

  it('falls back to the recorded outcome, marked stale, for a PR it couldn’t look up', () => {
    const status = summariseShip(withGoals([goal({ note: undefined })]), worktree, new Map([['acme/shop#51', 'merged']]));
    const [shown] = status.projects[0].closedGoals;
    expect(shown.done).toBeUndefined();
    expect(shown.prs).toEqual([
      { repo: 'acme/shop', number: 50, state: 'open', stale: true },
      { repo: 'acme/shop-api', number: 7, state: 'merged', stale: true },
      { repo: 'acme/shop', number: 51, state: 'merged' },
    ]);
  });

  it('caps the closed goals, newest first, and counts the rest', () => {
    const goals = Array.from({ length: 13 }, (_, i) => goal({ id: `g${i}`, title: `${i} ${'x'.repeat(200)}`, prs: [{ repo: 'acme/shop', number: i + 1, url: '' }] }));
    const snap = withGoals(goals);
    const status = summariseShip(snap, worktree);
    expect(status.projects[0].closedGoals).toHaveLength(10);
    expect(status.projects[0].closedGoals[0].title).toMatch(/^0 /);
    expect(status.projects[0].closedGoals[0].title.length).toBe(80);
    expect(status.projects[0].moreGoals).toBe(3);
    // only the shown goals' PRs get looked up
    expect(closedGoalPrs(snap).map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('gives a project without closed goals an empty list, and keeps hidden projects’ goals out', () => {
    const secret = { id: 'p2', name: 'Secret', repos: ['acme/secret'], hidden: true, goals: [goal({ prs: [{ repo: 'acme/secret', number: 9, url: '' }] })] } as Project;
    const snap = snapshot({ projects: [project, secret] });
    const status = summariseShip(snap, worktree);
    expect(status.projects.map((p) => [p.name, p.closedGoals, p.moreGoals])).toEqual([['Shop', [], undefined]]);
    expect(closedGoalPrs(snap)).toEqual([]);
  });
});

describe('lookUpPrStates', () => {
  it('looks each PR up once, and leaves out the ones that fail', async () => {
    const asked: string[] = [];
    const states = await lookUpPrStates(
      [
        { repo: 'acme/shop', number: 1 },
        { repo: 'acme/shop', number: 2 },
        { repo: 'acme/shop', number: 1 },
      ],
      (repo, number) => {
        asked.push(`${repo}#${number}`);
        return number === 2 ? Promise.reject(new Error('gh down')) : Promise.resolve('MERGED');
      },
    );
    expect(asked).toEqual(['acme/shop#1', 'acme/shop#2']);
    expect([...states]).toEqual([['acme/shop#1', 'merged']]);
  });
});
