import { describe, expect, it } from 'vitest';
import type { LeadPr, LeadWork } from '../../shared/types';
import { landing, named, openWaypoints, splitLanded, waypointFor, waypointOf, waypointSet } from './waypointRules';

const pr = (repo: string, number: number, more: Partial<LeadPr> = {}): LeadPr => ({ repo, number, url: `u${number}`, ...more });
const work = (more: Partial<LeadWork> = {}): Pick<LeadWork, 'slice' | 'prs' | 'landed' | 'waypoints'> => ({
  slice: 1,
  prs: [pr('acme/web', 10), pr('acme/api', 4)],
  waypoints: [{ slice: 1, startedAt: 0 }],
  ...more,
});

describe('waypointOf and openWaypoints', () => {
  it('reads a pull request with no waypoint named as the one under way, so goals from before waypoints read as they did', () => {
    expect(waypointOf(pr('acme/web', 10), { slice: 3 })).toBe(3);
    expect(waypointOf(pr('acme/web', 10, { slice: 2 }), { slice: 3 })).toBe(2);
    expect(openWaypoints({ slice: 3, prs: [pr('acme/web', 10, { slice: 1 }), pr('acme/api', 4)] })).toEqual([1, 3]);
  });

  it('finds the waypoint of a pull request whose waypoint has landed, so a verdict that comes late goes on it, not the one under way', () => {
    const w = { slice: 3, prs: [pr('acme/web', 11, { slice: 2 })], landed: [pr('acme/web', 10, { slice: 1, outcome: 'merged' })] };
    expect(waypointFor(w, 'acme/web', 10)).toBe(1);
    expect(waypointFor(w, 'acme/web', 11)).toBe(2);
    expect(waypointFor(w, 'acme/web', 99)).toBe(3);
  });
});

describe('named', () => {
  it('puts the first pull requests in the waypoint under way, and the next ones in a new waypoint on it, which is then under way', () => {
    const first = named(work(), { prs: [{ repo: 'acme/web', number: 10 }, { repo: 'acme/api', number: 4 }] }, 5);
    expect(first).toMatchObject({ kind: 'named', waypoint: 1, said: 'Waypoint 1, on the base branch: acme/web#10, acme/api#4.' });
    if (first.kind !== 'named') return;
    const more = { ...work(), ...first.work, prs: [...first.work.prs, pr('acme/web', 11)] };
    const second = named(more, { prs: [{ repo: 'acme/web', number: 11 }], on: 1 }, 9);
    expect(second).toMatchObject({ kind: 'named', waypoint: 2, said: 'Waypoint 2, on waypoint 1: acme/web#11.' });
    if (second.kind !== 'named') return;
    expect(second.work.slice).toBe(2);
    expect(second.work.prs.map((p) => waypointOf(p, second.work))).toEqual([1, 1, 2]);
    // one never named stays in the waypoint it was in when a new one starts
    const unnamed = named({ ...work(), prs: [...work().prs, pr('acme/web', 11)] }, { prs: [{ repo: 'acme/web', number: 11 }], waypoint: 1 }, 9);
    if (unnamed.kind === 'named') expect(unnamed.work.prs.map((p) => p.slice)).toEqual([1, 1, 1]);
    const ahead = named({ ...work(), prs: [...work().prs, pr('acme/web', 11)] }, { prs: [{ repo: 'acme/web', number: 11 }] }, 9);
    if (ahead.kind === 'named') expect(ahead.work.prs.map((p) => waypointOf(p, ahead.work))).toEqual([1, 1, 2]);
    expect(second.work.waypoints).toEqual([{ slice: 1, startedAt: 0 }, { slice: 2, startedAt: 9, on: 1 }]);
  });

  it('sets no order and no cap: waypoints side by side sit on the base branch', () => {
    const w = work({ slice: 2, prs: [pr('acme/web', 10, { slice: 1 }), pr('acme/api', 4)], waypoints: [{ slice: 1, startedAt: 0 }, { slice: 2, startedAt: 1 }] });
    const third = named({ ...w, prs: [...w.prs, pr('acme/web', 12)] }, { prs: [{ repo: 'acme/web', number: 12 }] }, 9);
    expect(third).toMatchObject({ kind: 'named', waypoint: 3, work: { slice: 3 } });
    if (third.kind === 'named') expect(third.work.waypoints?.at(-1)).toEqual({ slice: 3, startedAt: 9 });
  });

  it('moves a pull request to another open waypoint, and changes or clears what a waypoint is on', () => {
    const w = work({ slice: 2, prs: [pr('acme/web', 10, { slice: 1 }), pr('acme/api', 4, { slice: 1 }), pr('acme/web', 11, { slice: 2 })], waypoints: [{ slice: 1, startedAt: 0 }, { slice: 2, startedAt: 1, on: 1 }] });
    const moved = named(w, { prs: [{ repo: 'acme/api', number: 4 }], waypoint: 2, on: 1 }, 5);
    expect(moved).toMatchObject({ kind: 'named', waypoint: 2, work: { slice: 2 } });
    if (moved.kind === 'named') expect(moved.work.prs.map((p) => p.slice)).toEqual([1, 2, 2]);
    const cleared = named(w, { prs: [{ repo: 'acme/web', number: 11 }], waypoint: 2 }, 5);
    if (cleared.kind === 'named') expect(cleared.work.waypoints?.[1]).toEqual({ slice: 2, startedAt: 1 });
  });

  it('refuses what would tangle the course: a pull request not the goal’s, a waypoint not open, on one not below it, or leaving one empty', () => {
    const w = work({ slice: 2, prs: [pr('acme/web', 10, { slice: 1 }), pr('acme/web', 11, { slice: 2 }), pr('acme/api', 3, { outcome: 'merged', slice: 2 })] });
    expect(named(w, { prs: [] }, 1)).toEqual({ kind: 'refused', why: 'Name at least one pull request' });
    expect(named(w, { prs: [{ repo: 'acme/api', number: 3 }] }, 1)).toMatchObject({ kind: 'refused', why: expect.stringMatching(/^acme\/api#3 isn't one of this goal's open pull requests/) });
    expect(named(w, { prs: [{ repo: 'acme/web', number: 11 }], waypoint: 7 }, 1)).toMatchObject({ kind: 'refused', why: expect.stringMatching(/^Waypoint 7 isn't open: the open ones are 1, 2/) });
    expect(named(w, { prs: [{ repo: 'acme/web', number: 11 }], waypoint: 2, on: 2 }, 1)).toMatchObject({ kind: 'refused', why: 'Waypoint 2 can only be on an open waypoint below it: 1' });
    expect(named(w, { prs: [{ repo: 'acme/web', number: 10 }], waypoint: 1, on: 2 }, 1)).toMatchObject({ kind: 'refused', why: 'Waypoint 1 can only be on an open waypoint below it, and there are none' });
    expect(named(w, { prs: [{ repo: 'acme/web', number: 10 }], waypoint: 2 }, 1)).toMatchObject({ kind: 'refused', why: expect.stringMatching(/^That would leave waypoint 1 with no open pull request/) });
  });
});

describe('landing', () => {
  it('lands a waypoint whole once its pull requests have all merged or closed, and starts the next when it was the one under way', () => {
    const one = landing(work(), 'acme/web', 10, true, 5);
    expect(one).toEqual({ kind: 'open', work: { prs: [pr('acme/web', 10, { outcome: 'merged' }), pr('acme/api', 4)] } });
    const both = landing({ ...work(), ...one.work }, 'acme/api', 4, false, 9);
    expect(both).toEqual({
      kind: 'landed',
      waypoint: 1,
      prs: [pr('acme/web', 10, { outcome: 'merged', slice: 1 }), pr('acme/api', 4, { outcome: 'closed', slice: 1 })],
      work: { slice: 2, prs: [], landed: [pr('acme/web', 10, { outcome: 'merged', slice: 1 }), pr('acme/api', 4, { outcome: 'closed', slice: 1 })], waypoints: [{ slice: 1, startedAt: 0, landedAt: 9 }, { slice: 2, startedAt: 9 }] },
    });
  });

  it('lands an earlier waypoint on its own, leaving the one under way and its pull requests open', () => {
    const w = work({ slice: 2, prs: [pr('acme/web', 10, { slice: 1 }), pr('acme/web', 11, { slice: 2 })], waypoints: [{ slice: 1, startedAt: 0 }, { slice: 2, startedAt: 1, on: 1 }] });
    const landed = landing(w, 'acme/web', 10, true, 7);
    expect(landed).toMatchObject({ kind: 'landed', waypoint: 1, work: { slice: 2, prs: [pr('acme/web', 11, { slice: 2 })] } });
    if (landed.kind === 'landed') expect(landed.work.waypoints).toEqual([{ slice: 1, startedAt: 0, landedAt: 7 }, { slice: 2, startedAt: 1, on: 1 }]);
  });

  it('starts the next waypoint when the one under way lands before an earlier one', () => {
    const w = work({ slice: 2, prs: [pr('acme/web', 10, { slice: 1 }), pr('acme/web', 11, { slice: 2 })], waypoints: [{ slice: 1, startedAt: 0 }, { slice: 2, startedAt: 1 }] });
    expect(landing(w, 'acme/web', 11, true, 7)).toMatchObject({ kind: 'landed', waypoint: 2, work: { slice: 3, prs: [pr('acme/web', 10, { slice: 1 })] } });
  });
});

describe('splitLanded', () => {
  it('reopens a goal with every waypoint still open: the one it was on, and any earlier one with a pull request still open', () => {
    const prs = [pr('acme/web', 9, { slice: 1, outcome: 'merged' }), pr('acme/web', 10, { slice: 2 }), pr('acme/api', 4, { slice: 2, outcome: 'merged' }), pr('acme/web', 11, { slice: 3 })];
    expect(splitLanded(prs, 3)).toEqual({ open: prs.slice(1), landed: [prs[0]] });
  });
});

describe('waypointSet', () => {
  const repos = [{ repo: 'acme/web', folder: 'web', baseBranch: 'main' }, { repo: 'acme/api', folder: 'api', baseBranch: 'develop' }, { repo: 'acme/docs', folder: 'docs', baseBranch: 'main' }];
  // waypoint 1 touched web and api and has landed; 2 touches web; 3 touches web and api
  const w = {
    slice: 3,
    repos,
    landed: [pr('acme/web', 9, { slice: 1, outcome: 'merged' }), pr('acme/api', 3, { slice: 1, outcome: 'merged' })],
    prs: [pr('acme/web', 10, { slice: 2, sha: 'w2' }), pr('acme/web', 11, { slice: 3, sha: 'w3' }), pr('acme/api', 4, { slice: 3 })],
  };

  it('checks each repo out at the highest waypoint up to n that touches it, pinned to what it last shipped', () => {
    expect(waypointSet(w, 3)).toEqual({ 'acme/web': { pr: 11, sha: 'w3' }, 'acme/api': { pr: 4 }, 'acme/docs': { branch: 'main' } });
    // at 2, api's highest is waypoint 1, which has merged: its base branch has it
    expect(waypointSet(w, 2)).toEqual({ 'acme/web': { pr: 10, sha: 'w2' }, 'acme/api': { branch: 'develop' }, 'acme/docs': { branch: 'main' } });
    expect(waypointSet(w, 0)).toEqual({ 'acme/web': { branch: 'main' }, 'acme/api': { branch: 'develop' }, 'acme/docs': { branch: 'main' } });
  });

  it('passes over a pull request closed unmerged', () => {
    const closed = { ...w, prs: [...w.prs.slice(0, 2), pr('acme/api', 4, { slice: 3, outcome: 'closed' })] };
    expect(waypointSet(closed, 3)['acme/api']).toEqual({ branch: 'develop' });
  });
});

it('does not strand a waypoint whose only other pull requests are finished when the lead moves its open one out', () => {
  const w = { slice: 2, prs: [pr('acme/web', 1, { slice: 1, outcome: 'merged' }), pr('acme/api', 2, { slice: 1 }), pr('acme/web', 3, { slice: 2 })], waypoints: [{ slice: 1, startedAt: 0 }, { slice: 2, startedAt: 1 }] };
  const r = named(w, { prs: [{ repo: 'acme/api', number: 2 }], waypoint: 2 }, 5);
  expect(r.kind).toBe('refused');
});
