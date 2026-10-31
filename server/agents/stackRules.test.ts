import { describe, expect, it } from 'vitest';
import type { LeadPr, LeadWork, PullRequest } from '../../shared/types';
import { basesSaid, landingHold, restackPlan, stackBase, stackBelow } from './stackRules';

const pr = (repo: string, number: number, slice: number, more: Partial<LeadPr> = {}): LeadPr => ({ repo, number, url: `u${number}`, slice, branch: `wp${slice}-${repo.split('/')[1]}`, ...more });
// waypoint 1 touches web and api; 2 is on 1 and touches web; 3 is on 2 and touches web and api; 4 stands alone
const work: Pick<LeadWork, 'slice' | 'prs' | 'waypoints' | 'repos'> = {
  slice: 4,
  repos: [{ repo: 'acme/web', folder: 'web', baseBranch: 'main' }, { repo: 'acme/api', folder: 'api', baseBranch: 'develop' }],
  prs: [pr('acme/web', 10, 1), pr('acme/api', 4, 1), pr('acme/web', 11, 2), pr('acme/web', 12, 3), pr('acme/api', 5, 3), pr('acme/web', 13, 4)],
  waypoints: [{ slice: 1, startedAt: 0 }, { slice: 2, startedAt: 1, on: 1 }, { slice: 3, startedAt: 2, on: 2 }, { slice: 4, startedAt: 3 }],
};

describe('stackBelow', () => {
  it('follows a waypoint’s stack down through the open waypoints it’s on, and stops at one that has landed', () => {
    expect(stackBelow(work, 3)).toEqual([2, 1]);
    expect(stackBelow(work, 4)).toEqual([]);
    const landed = { ...work, prs: work.prs.filter((p) => p.slice !== 1) };
    expect(stackBelow(landed, 3)).toEqual([2]);
  });
});

describe('stackBase', () => {
  it('cuts a waypoint’s branch in each repo from the nearest waypoint below it that touches that repo, else the base branch', () => {
    expect(stackBase(work, 'acme/web', 3)).toBe('wp2-web');
    // waypoint 2 has nothing in api: 3's api branch builds on 1's
    expect(stackBase(work, 'acme/api', 3)).toBe('wp1-api');
    expect(stackBase(work, 'acme/api', 1)).toBe('develop');
    expect(stackBase(work, 'acme/web', 4)).toBe('main');
    // once 1's api pull request has merged, 3's api one sits on the base branch again
    const merged = { ...work, prs: work.prs.map((p) => (p.number === 4 ? { ...p, outcome: 'merged' as const } : p)) };
    expect(stackBase(merged, 'acme/api', 3)).toBe('develop');
  });
});

describe('landingHold', () => {
  it('holds a stacked waypoint’s pull requests until the waypoint it’s on has landed, and nothing else', () => {
    expect(landingHold(work, { repo: 'acme/api', number: 5 })).toBe('it waits on waypoint 2, which its waypoint is stacked on, to land first');
    expect(landingHold(work, { repo: 'acme/web', number: 10 })).toBeUndefined();
    expect(landingHold(work, { repo: 'acme/web', number: 13 })).toBeUndefined();
    expect(landingHold(work, { repo: 'acme/web', number: 99 })).toBeUndefined();
    expect(landingHold({ ...work, prs: work.prs.filter((p) => (p.slice ?? 0) > 2) }, { repo: 'acme/web', number: 12 })).toBeUndefined();
  });

  it('holds one whose waypoint below has landed until Ops has moved it onto the branch it lands on', () => {
    const landed = (stackedOn: LeadPr['stackedOn']) => ({ ...work, prs: [pr('acme/web', 11, 2, { stackedOn })] });
    expect(landingHold(landed({ branch: 'wp1-web', sha: 'a1' }), { repo: 'acme/web', number: 11 })).toBe('Ops is moving it onto `main` first');
    expect(landingHold(landed({ branch: 'wp1-web', sha: 'a1', stuck: { lower: '', head: 'b1' } }), { repo: 'acme/web', number: 11 })).toBe('it needs moving onto `main` first, which its lead has been asked to do');
    expect(landingHold(landed({ branch: 'main', sha: '' }), { repo: 'acme/web', number: 11 })).toBeUndefined();
    // one Ops hasn't seen sitting anywhere yet isn't held for it
    expect(landingHold(landed(undefined), { repo: 'acme/web', number: 11 })).toBeUndefined();
  });
});

describe('restackPlan', () => {
  // waypoint 1's web pull request, and 2's on it; 3's on 2
  const stacked = (more: Partial<LeadPr> = {}, three: Partial<LeadPr> | false = false): Pick<LeadWork, 'slice' | 'prs' | 'waypoints' | 'repos'> => ({
    slice: 3,
    repos: work.repos,
    prs: [pr('acme/web', 10, 1), pr('acme/web', 11, 2, more), ...(three ? [pr('acme/web', 12, 3, three)] : [])],
    waypoints: [{ slice: 1, startedAt: 0 }, { slice: 2, startedAt: 1, on: 1 }, { slice: 3, startedAt: 2, on: 2 }],
  });
  const onBoard = (number: number, branch: string, baseBranch: string, headSha: string): PullRequest => ({
    repo: 'acme/web', number, title: `PR ${number}`, url: `u${number}`, branch, baseBranch, headSha,
    isDraft: false, mergeable: 'MERGEABLE', checks: 'passing', failedChecks: [], closes: [], createdAt: '2026-10-30T00:00:00Z',
  });
  const board = (lower = 'a1', base11 = 'wp1-web') => [onBoard(10, 'wp1-web', 'main', lower), onBoard(11, 'wp2-web', base11, 'b1')];
  const landed = (more: Partial<LeadPr>) => ({ ...stacked(more), prs: [pr('acme/web', 10, 1, { outcome: 'merged' }), pr('acme/web', 11, 2, more)] });

  it('records where a stacked pull request sits, first seen, and moves nothing', () => {
    expect(restackPlan(stacked(), board())).toEqual({ kind: 'steps', steps: [{ kind: 'record', repo: 'acme/web', number: 11, stackedOn: { branch: 'wp1-web', sha: 'a1' } }] });
    // nothing to do once it's recorded, however often it's asked
    expect(restackPlan(stacked({ stackedOn: { branch: 'wp1-web', sha: 'a1' } }), board())).toEqual({ kind: 'none' });
    // nor for one off the board, nor one on no stack
    expect(restackPlan(stacked(), [])).toEqual({ kind: 'none' });
    expect(restackPlan({ ...stacked(), waypoints: [] }, board())).toEqual({ kind: 'none' });
  });

  it('moves it onto the branch below when that one gets a push, replaying its own commits from where it sat', () => {
    expect(restackPlan(stacked({ stackedOn: { branch: 'wp1-web', sha: 'a1' } }), board('a2'))).toEqual({ kind: 'steps', steps: [
      { kind: 'restack', repo: 'acme/web', number: 11, branch: 'wp2-web', onto: 'wp1-web', upstream: 'a1', head: 'b1', stackedOn: { branch: 'wp1-web', sha: 'a2' } },
    ] });
  });

  it('moves it onto the base branch when the waypoint below lands, and points its pull request there', () => {
    expect(restackPlan(landed({ stackedOn: { branch: 'wp1-web', sha: 'a1' } }), board())).toEqual({ kind: 'steps', steps: [
      { kind: 'restack', repo: 'acme/web', number: 11, branch: 'wp2-web', onto: 'main', upstream: 'a1', head: 'b1', stackedOn: { branch: 'main', sha: '' }, retarget: 'main' },
    ] });
    // GitHub pointed it at main itself as the branch below went: it's only moved
    const retargeted = restackPlan(landed({ stackedOn: { branch: 'wp1-web', sha: 'a1' } }), board('a1', 'main'));
    const [step] = retargeted.kind === 'steps' ? retargeted.steps : [];
    expect(step).toMatchObject({ kind: 'restack', onto: 'main' });
    expect(step).not.toHaveProperty('retarget');
    // moved, and based on a branch it shouldn't be: only pointed
    expect(restackPlan(landed({ stackedOn: { branch: 'main', sha: '' } }), board())).toEqual({ kind: 'steps', steps: [{ kind: 'retarget', repo: 'acme/web', number: 11, base: 'main' }] });
  });

  it('leaves one stuck on a clash until the branch below or its own head moves', () => {
    const stuck = { branch: 'wp1-web', sha: 'a1', stuck: { lower: 'a2', head: 'b1' } };
    expect(restackPlan(stacked({ stackedOn: stuck }), board('a2'))).toEqual({ kind: 'none' });
    expect(restackPlan(stacked({ stackedOn: stuck }), board('a3')).kind).toBe('steps');
    const pushed = [board('a2')[0], { ...board('a2')[1], headSha: 'b2' }];
    expect(restackPlan(stacked({ stackedOn: stuck }), pushed)).toMatchObject({ steps: [{ kind: 'restack', upstream: 'a1', head: 'b2' }] });
  });

  it('says so once when where its own commits start isn’t known, and takes it as moved once the lead pushes it', () => {
    // first seen after the waypoint below had landed: the branch it's based on has gone from the board
    expect(restackPlan(landed({}), [board()[1]])).toEqual({ kind: 'steps', steps: [
      { kind: 'record', repo: 'acme/web', number: 11, stackedOn: { branch: 'wp1-web', sha: '' } },
      { kind: 'no-upstream', repo: 'acme/web', number: 11, branch: 'wp2-web', onto: 'main', stuck: { lower: '', head: 'b1' } },
    ] });
    const told = { branch: 'wp1-web', sha: '', stuck: { lower: '', head: 'b1' } };
    expect(restackPlan(landed({ stackedOn: told }), [board()[1]])).toEqual({ kind: 'none' });
    expect(restackPlan(landed({ stackedOn: told }), [{ ...board()[1], headSha: 'b2' }])).toEqual({ kind: 'steps', steps: [
      { kind: 'record', repo: 'acme/web', number: 11, stackedOn: { branch: 'main', sha: '' } },
      { kind: 'retarget', repo: 'acme/web', number: 11, base: 'main' },
    ] });
  });

  it('moves the lowest waypoints first', () => {
    const work3 = stacked({ stackedOn: { branch: 'wp1-web', sha: 'a1' } }, { stackedOn: { branch: 'wp2-web', sha: 'b0' } });
    const plan = restackPlan({ ...work3, prs: [...work3.prs].reverse() }, [...board('a2'), onBoard(12, 'wp3-web', 'wp2-web', 'c1')]);
    expect(plan.kind === 'steps' && plan.steps.map((s) => s.number)).toEqual([11, 12]);
  });
});

describe('basesSaid', () => {
  it('tells the lead which branch to base each of a stacked waypoint’s pull requests on, and nothing for one on the base branch', () => {
    expect(basesSaid(work, 3)).toBe(' Base them on the waypoint below\'s branch: acme/web#12 on `wp2-web`, acme/api#5 on `wp1-api`.');
    expect(basesSaid(work, 4)).toBe('');
    expect(basesSaid(work, 1)).toBe('');
  });
});
