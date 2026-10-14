import { describe, expect, it } from 'vitest';
import type { Agent, GoalRecord, Project } from '../../../shared/types';
import { ARM, goalStars, spiral } from './galaxy';

const record = (id: string, openedAt: number): GoalRecord => ({ id, title: `Goal ${id}`, slices: 2, prs: [], leadName: 'Lt. Data', openedAt, closedAt: openedAt + 10 });
const project = (id: string, goals: GoalRecord[], hidden = false): Project => ({ id, name: id, color: `#${id}`, goals, hidden }) as unknown as Project;
const lead = (id: string, projectId: string, startedAt: number, firstSlice?: number): Agent =>
  ({ id, projectId, task: 'lead', startedAt, lead: { title: `Live ${id}`, slice: 3, station: 0, waypoints: firstSlice === undefined ? [] : [{ slice: 1, startedAt: firstSlice }] } }) as unknown as Agent;

describe('goalStars', () => {
  it('puts every closed and live goal in time order, each in its project colour', () => {
    const stars = goalStars([project('aa', [record('g1', 300)]), project('bb', [record('g2', 100)])], [lead('L1', 'aa', 900, 200)]);
    expect(stars.map((s) => [s.id, s.color, s.openedAt])).toEqual([['g2', '#bb', 100], ['L1', '#aa', 200], ['g1', '#aa', 300]]);
    expect(stars[1]).toMatchObject({ title: 'Live L1', slices: 3 });
    expect(stars[1].closedAt).toBeUndefined();
    expect(stars[2]).toMatchObject({ closedAt: 310, slices: 2 });
  });

  it('dates a live goal by its lead when it has no slice yet', () => {
    expect(goalStars([project('aa', [])], [lead('L1', 'aa', 900)])[0].openedAt).toBe(900);
  });

  it('leaves out hidden projects, and agents that are not leads', () => {
    const helper = { ...lead('H1', 'aa', 5), task: 'issue' } as Agent;
    expect(goalStars([project('aa', [record('g1', 1)], true), project('bb', [])], [lead('L1', 'aa', 2), helper])).toEqual([]);
  });
});

describe('spiral', () => {
  const r = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);

  it('puts the newest dead ahead on the inner edge, and winds out to the oldest', () => {
    const points = spiral(12);
    const newest = points[points.length - 1];
    expect(newest.x).toBeCloseTo(0);
    expect(newest.z).toBeCloseTo(-ARM.inner);
    for (let i = 1; i < points.length; i++) expect(r(points[i - 1])).toBeGreaterThan(r(points[i]));
  });

  it('keeps neighbours a spacing apart round the arm', () => {
    const [a, b] = spiral(2);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(ARM.spacing, 1);
  });

  it('squeezes many goals in, the oldest no further out than the outer edge', () => {
    const points = spiral(400);
    // the arm's length is a little short of the spiral's, stepping round it a spacing at a time
    expect(r(points[0])).toBeLessThanOrEqual(ARM.outer + 0.01);
    expect(r(points[0])).toBeGreaterThan(ARM.outer - 0.5);
  });

  it('rises ahead and falls behind, by the tilt, from below eye height', () => {
    const newest = spiral(1)[0];
    expect(newest.y).toBeCloseTo(ARM.drop + ARM.inner * Math.tan(ARM.tilt));
  });

  it('has nothing to place for no goals', () => {
    expect(spiral(0)).toEqual([]);
  });
});
