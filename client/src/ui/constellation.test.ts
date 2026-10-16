import { describe, expect, it } from 'vitest';
import type { Waypoint } from '../../../shared/types';
import { labelBox, overlaps } from './course';
import { freeAngles, ORBIT, orbit, sliceWork, type WorkNode } from './constellation';

const wp: Waypoint = {
  slice: 2, startedAt: 0, commits: 3, lastCommit: 'Draw it',
  probes: [
    { id: 'h1', description: 'Map the chart code', launchedAt: 1, endedAt: 2, ok: true },
    { id: 'h2', description: 'Run the tests', launchedAt: 1, endedAt: 2, ok: false },
    { id: 'h3', description: 'Never came back', launchedAt: 1 },
    { id: 'h4', description: 'Still out', launchedAt: 1 },
  ],
  evidence: [{ repo: 'o/focus', pr: 7, caption: 'The chart', file: 'a.png' }],
  tasks: [{ id: '1', subject: 'Read course.ts', status: 'in_progress' }],
};

describe("a slice's work", () => {
  const nodes = sliceWork({
    waypoint: wp,
    checklist: [{ text: 'Plot it', done: true }, { text: 'Draw it', done: false }],
    workflows: [{ id: 'w1', name: 'review', description: '', status: 'running', phases: [], agents: [], roll: [], startedAt: 0 }],
    artifacts: [{ id: 'mock', title: 'Mockup', at: 0, slice: 2 }, { id: 'old', title: 'Older', at: 0, slice: 1 }],
    questions: [{ id: 'q1', question: 'Which layout?', options: [], at: 0, slice: 2, answer: { option: 'a', at: 1 } }],
    prs: [{ repo: 'o/focus', number: 7, url: '', slice: 2, outcome: 'merged' }, { repo: 'o/focus', number: 6, url: '', slice: 1 }],
    flying: new Set(['h4']),
  });

  it('takes in everything kept on the slice, kinds together, steps first and pull requests last', () => {
    expect(nodes.map((n) => n.key)).toEqual(['step:0', 'step:1', 'task:1', 'workflow:w1', 'probe:h1', 'probe:h2', 'probe:h3', 'commits', 'shown:mock', 'asked:q1', 'shot:0', 'pr:o/focus#7']);
  });

  it('says how each stands', () => {
    const state = Object.fromEntries(nodes.map((n) => [n.key, n.state]));
    expect(state).toMatchObject({ 'step:0': 'done', 'step:1': 'open', 'task:1': 'active', 'workflow:w1': 'active', 'probe:h1': 'done', 'probe:h2': 'failed', 'probe:h3': 'lost', 'asked:q1': 'done', 'pr:o/focus#7': 'done' });
    expect(nodes.find((n) => n.key === 'commits')?.text).toBe('3 commits');
    expect(nodes.find((n) => n.kind === 'pr')?.text).toBe('focus #7');
  });

  it('leaves out probes still flying, and slices without anything', () => {
    expect(nodes.some((n) => n.key === 'probe:h4')).toBe(false);
    expect(sliceWork({ waypoint: { slice: 1, startedAt: 0 }, artifacts: [], questions: [], prs: [], flying: new Set() })).toEqual([]);
  });
});

describe('the constellation', () => {
  const many = (n: number): WorkNode[] => Array.from({ length: n }, (_, i) => ({ key: `step:${i}`, kind: 'step', text: `Step number ${i} of the slice`, state: 'open' }));
  const angle = (p: { x: number; y: number }) => Math.atan2(p.y, p.x);

  it('keeps clear of the ways out of the waypoint that are taken', () => {
    const free = freeAngles([0, Math.PI]);
    expect(free.every((a) => Math.min(Math.abs(Math.sin(a)), 1) > Math.sin(0.4))).toBe(true);
    const placed = orbit({ x: 0, y: 0 }, many(8), [0, Math.PI], false);
    for (const p of placed) expect(Math.abs(Math.sin(angle(p)))).toBeGreaterThan(Math.sin(0.4));
  });

  it('runs round in order, so each kind keeps together', () => {
    const free = freeAngles([Math.PI / 2]);
    // free directions run round without doubling back
    const steps = free.slice(1).map((a, i) => ((a - free[i]) + 2 * Math.PI) % (2 * Math.PI));
    expect(steps.every((s) => s < 0.1)).toBe(true);
  });

  it('sits close in and unnamed round every waypoint, further out and named round the one in focus', () => {
    const quiet = orbit({ x: 100, y: 100 }, many(3), [], false);
    expect(quiet.every((p) => !p.label && Math.round(Math.hypot(p.x - 100, p.y - 100)) === ORBIT.quiet.r)).toBe(true);
    const focus = orbit({ x: 300, y: 300 }, many(3), [], true);
    expect(focus.every((p) => p.label && Math.hypot(p.x - 300, p.y - 300) >= ORBIT.focus.r * 0.9)).toBe(true);
  });

  it('names every one in focus, a row each, down the right and then the left, never one over another', () => {
    const placed = orbit({ x: 400, y: 300 }, many(16), [Math.PI * 0.75, -Math.PI / 4], false);
    expect(placed.every((p) => p.label)).toBe(false);
    const focus = orbit({ x: 400, y: 300 }, many(16), [Math.PI * 0.75, -Math.PI / 4], true);
    expect(focus.every((p) => p.label && p.name)).toBe(true);
    const boxes = focus.map((p) => labelBox(p.label!, p.name!, ORBIT.focus.size));
    for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    const right = focus.filter((p) => p.x > 400);
    expect(focus.slice(0, right.length)).toEqual(right);
    expect(right.map((p) => p.y)).toEqual([...right.map((p) => p.y)].sort((a, b) => a - b));
  });

  it('keeps names off what it is told to avoid, and shrinks with the zoom', () => {
    const avoid = [{ x0: 400, y0: 250, x1: 700, y1: 350 }];
    const placed = orbit({ x: 400, y: 300 }, many(4), [], true, 1, avoid);
    for (const p of placed) expect(overlaps(labelBox(p.label!, p.name!, ORBIT.focus.size), avoid[0])).toBe(false);
    const zoomed = orbit({ x: 300, y: 300 }, many(1), [], true, 0.5);
    expect(Math.round(Math.hypot(zoomed[0].x - 300, zoomed[0].y - 300))).toBe(ORBIT.focus.r / 2);
  });
});
