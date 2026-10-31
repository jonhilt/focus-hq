import { describe, expect, it } from 'vitest';
import type { LeadPr, LeadWork } from '../../shared/types';
import { basesSaid, landingHold, stackBase, stackBelow } from './stackRules';

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
});

describe('basesSaid', () => {
  it('tells the lead which branch to base each of a stacked waypoint’s pull requests on, and nothing for one on the base branch', () => {
    expect(basesSaid(work, 3)).toBe(' Base them on the waypoint below\'s branch: acme/web#12 on `wp2-web`, acme/api#5 on `wp1-api`.');
    expect(basesSaid(work, 4)).toBe('');
    expect(basesSaid(work, 1)).toBe('');
  });
});
