import { describe, expect, it } from 'vitest';
import type { Waypoint } from '../../../shared/types';
import { labelBox, misread, overlaps, plotCourse } from './course';
import { faults, NO_FAULTS } from './legibility';
import { chartLines, chartMarks, column, freeAngles, gather, ORBIT, quiet, sky, sliceWork, type WorkNode } from './constellation';

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
    workflows: [{ id: 'w1', name: 'review', description: '', status: 'running', phases: [], agents: [], roll: [], startedAt: 0 }],
    artifacts: [{ id: 'mock', title: 'Mockup', at: 0, slice: 2 }, { id: 'old', title: 'Older', at: 0, slice: 1 }],
    questions: [{ id: 'q1', question: 'Which layout?', options: [], at: 0, slice: 2, answer: { option: 'a', at: 1 } }],
    prs: [{ repo: 'o/focus', number: 7, url: '', slice: 2, outcome: 'merged' }, { repo: 'o/focus', number: 6, url: '', slice: 1 }],
    flying: new Set(['h4']),
  });

  it('takes in everything kept on the slice, kinds together, tasks first and pull requests last', () => {
    expect(nodes.map((n) => n.key)).toEqual(['task:1', 'workflow:w1', 'probe:h1', 'probe:h2', 'probe:h3', 'commits', 'shown:mock', 'asked:q1', 'shot:0', 'pr:o/focus#7']);
  });

  it('says how each stands', () => {
    const state = Object.fromEntries(nodes.map((n) => [n.key, n.state]));
    expect(state).toMatchObject({ 'task:1': 'active', 'workflow:w1': 'active', 'probe:h1': 'done', 'probe:h2': 'failed', 'probe:h3': 'lost', 'asked:q1': 'done', 'pr:o/focus#7': 'done' });
    expect(nodes.find((n) => n.key === 'commits')?.text).toBe('3 commits');
    expect(nodes.find((n) => n.kind === 'pr')?.text).toBe('focus #7');
  });

  it('leaves out probes still flying, and slices without anything', () => {
    expect(nodes.some((n) => n.key === 'probe:h4')).toBe(false);
    expect(sliceWork({ waypoint: { slice: 1, startedAt: 0 }, artifacts: [], questions: [], prs: [], flying: new Set() })).toEqual([]);
  });
});

describe('the constellation', () => {
  const many = (n: number, text = (i: number) => `Task number ${i} of the slice`): WorkNode[] => Array.from({ length: n }, (_, i) => ({ key: `task:${i}`, kind: 'task', text: text(i), state: 'open' }));
  const open = { px: 1, avoid: [], lines: [], course: [] as number[], width: 900, height: 560 };

  it('keeps clear of the ways out of the waypoint that are taken', () => {
    const free = freeAngles([0, Math.PI]);
    expect(free.every((a) => Math.min(Math.abs(Math.sin(a)), 1) > Math.sin(0.4))).toBe(true);
    const q = quiet({ x: 0, y: 0 }, 8, [0, Math.PI])!;
    expect(Math.abs(Math.sin(Math.atan2(q.y, q.x)))).toBeGreaterThan(Math.sin(0.4));
  });

  it('runs round in order, so each kind keeps together', () => {
    const free = freeAngles([Math.PI / 2]);
    // free directions run round without doubling back
    const steps = free.slice(1).map((a, i) => ((a - free[i]) + 2 * Math.PI) % (2 * Math.PI));
    expect(steps.every((s) => s < 0.1)).toBe(true);
  });

  it('gathers work that says the same into one, counted, at it now if any of it is', () => {
    const probe = (id: string, state: WorkNode['state']): WorkNode => ({ key: `probe:${id}`, kind: 'probe', text: 'Script tts/probe.mjs', state });
    const g = gather([probe('a', 'done'), { key: 'task:1', kind: 'task', text: 'Script tts/probe.mjs', state: 'done' }, probe('b', 'active'), probe('c', 'done')]);
    expect(g.map((n) => [n.key, n.count, n.state])).toEqual([['probe:a', 3, 'active'], ['task:1', 1, 'done']]);
    expect(g[0].keys).toEqual(['probe:a', 'probe:b', 'probe:c']);
  });

  it('shows a waypoint out of focus as a count of its work, close in, and nothing when there is none', () => {
    const q = quiet({ x: 100, y: 100 }, 14, [])!;
    expect(q.count).toBe(14);
    expect(Math.round(Math.hypot(q.x - 100, q.y - 100))).toBe(ORBIT.quiet.r);
    expect(quiet({ x: 100, y: 100 }, 0, [])).toBeUndefined();
  });

  it('names the waypoint in focus\'s work in one column, evenly spaced, kinds in order, on the side away from the course', () => {
    const col = column({ x: 400, y: 300 }, many(6), { ...open, course: [0] })!;
    expect(col.side).toBe(-1);
    expect(new Set(col.nodes.map((n) => n.x)).size).toBe(1);
    const gaps = col.nodes.slice(1).map((n, i) => Math.round(n.y - col.nodes[i].y));
    expect(new Set(gaps)).toEqual(new Set([ORBIT.focus.row]));
    expect(col.nodes.map((n) => n.key)).toEqual(many(6).map((n) => n.key));
  });

  it('keeps the column off what it is told to avoid and on the chart, and its words the same size however far it is zoomed', () => {
    const avoid = [{ x0: 200, y0: 0, x1: 395, y1: 560 }];
    const col = column({ x: 400, y: 300 }, many(4), { ...open, avoid })!;
    expect(col.side).toBe(1);
    for (const n of col.nodes) expect(overlaps(labelBox(n.label, n.name, ORBIT.focus.size), avoid[0])).toBe(false);
    const edge = column({ x: 860, y: 300 }, many(4), open)!;
    expect(edge.side).toBe(-1);
    const near = column({ x: 400, y: 300 }, many(1), { ...open, course: [0] })!;
    const far = column({ x: 400, y: 300 }, many(1), { ...open, course: [0], px: 0.8 })!;
    expect(far.nodes[0].x - 400).toBeCloseTo((near.nodes[0].x - 400) * 0.8, 0);
  });

  it('says how many more there are once a slice has more work than rows', () => {
    const col = column({ x: 400, y: 280 }, many(20), open)!;
    expect(col.nodes).toHaveLength(ORBIT.focus.rows);
    expect(col.nodes.at(-1)).toMatchObject({ more: 20 - ORBIT.focus.rows + 1, name: `+${20 - ORBIT.focus.rows + 1} more in the log` });
  });
});

describe('a chart held to the rules', () => {
  // the voyage in the captain's screenshot: a busy first slice, a second that ran the same script three times
  const task = (slice: number, i: number, subject: string) => ({ id: `${slice}-${i}`, subject, status: 'completed' as const });
  const waypoints: Waypoint[] = [
    { slice: 1, startedAt: 10, landedAt: 15, title: 'Briefings and crew always speak in their own voices', tasks: Array.from({ length: 9 }, (_, i) => task(1, i, `Voice step ${i + 1} of the briefing work`)), probes: Array.from({ length: 5 }, (_, i) => ({ id: `p1${i}`, description: `Probe voice ${i}`, launchedAt: 1, endedAt: 2, ok: true })), commits: 6 },
    { slice: 2, startedAt: 20, landedAt: 25, title: 'Crew voices run on the Apple GPU, so busy agents don\'t slow them', probes: ['a', 'b', 'c'].map((id) => ({ id, description: 'Script tts/probe.mjs', launchedAt: 1, endedAt: 2, ok: true, type: 'script' as const })), commits: 1, tasks: [task(2, 1, 'Move Kokoro onto the GPU'), task(2, 2, 'Warm every voice at load')] },
    { slice: 3, startedAt: 30, landedAt: 35, title: 'Updated briefings say which beat changed', commits: 2, tasks: [task(3, 1, 'Say which beat changed')] },
    { slice: 4, startedAt: 40, tasks: [{ id: '4-1', subject: 'Lay out the chart', status: 'in_progress' }] },
  ];
  const contacts = [{ id: 'c1', text: 'Kokoro is CPU-bound under load', slice: 2, at: 0 }];
  const prs = [{ repo: 'jonhilt/focus', number: 466, url: '', slice: 2, outcome: 'merged' as const }];
  const plot = plotCourse({ waypoints, current: 4, next: ['Voice the comms panel', 'Steady the GPU fallback', 'Briefings on the wall'], contacts, seed: 'lead_proj_bd529cc4d2_voices' });
  const workOf = (slice: number) => sliceWork({ waypoint: waypoints.find((w) => w.slice === slice)!, artifacts: [], questions: [], prs, flying: new Set() });
  const sq = (p: { x: number; y: number }, r: number) => ({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });

  it('breaks none of them round whichever waypoint is in focus, however far it is zoomed', () => {
    for (const focus of [1, 2, 3, 4]) {
      for (const px of [1.3, 0.8, 0.5, 0.35, 0.25]) {
        const nameSize = 17 * Math.min(1, px);
        const heavens = sky(plot, workOf, focus, px, nameSize);
        const col = heavens.column!;
        expect(col.slice).toBe(focus);
        const labels = col.nodes.map((n) => labelBox(n.label, n.name, ORBIT.focus.size * px));
        const marks = [...chartMarks(plot, nameSize), ...[...heavens.quiet.values()].map((q) => sq(q, 9)), ...col.nodes.map((n) => sq(n, ORBIT.focus.mark * px))];
        const found = faults({ labels, marks, lines: chartLines(plot), leaders: col.leaders }, 4 * px);
        expect(found, `waypoint ${focus} at ${px}`).toEqual(NO_FAULTS);
        // and the counts round the rest cover none of its names
        for (const q of heavens.quiet.values()) for (const l of labels) expect(overlaps(sq(q, 9), l), `waypoint ${focus} at ${px}`).toBe(false);
      }
    }
  });

  it('draws the script run three times once, counted, and every other waypoint as a count', () => {
    const heavens = sky(plot, workOf, 2, 0.5, 17);
    expect(heavens.column!.nodes.filter((n) => n.kind === 'probe').map((n) => n.name)).toEqual(['Script tts/probe.mjs ×3']);
    expect([...heavens.quiet.keys()]).toEqual([1, 3, 4]);
    expect(heavens.quiet.get(1)!.count).toBe(15);
  });

  it('zooms to take in the waypoint in focus, its name and its column', () => {
    const p = plot.points[1];
    const { bounds } = sky(plot, workOf, 2, 0.5, 17).column!;
    const name = labelBox(p.label!, p.lines, 17);
    expect(bounds.x0 <= name.x0 && bounds.y0 <= name.y0 && bounds.x1 >= name.x1 && bounds.y1 >= name.y1).toBe(true);
  });
});

describe('counts out of focus', () => {
  it('sits nearer its own waypoint than any other, or is left off where it can’t', () => {
    const near = [{ x: 140, y: 100 }];
    const q = quiet({ x: 100, y: 100 }, 5, [], [], [], 1, near)!;
    expect(Math.hypot(q.x - 100, q.y - 100)).toBeLessThan(Math.hypot(q.x - 140, q.y - 100));
    // hemmed in by waypoints all round, closer than its count would sit
    const round = Array.from({ length: 8 }, (_, i) => ({ x: 100 + Math.cos((i * Math.PI) / 4) * 40, y: 100 + Math.sin((i * Math.PI) / 4) * 40 }));
    expect(quiet({ x: 100, y: 100 }, 5, [], [], [], 1, round)).toBeUndefined();
  });

  it('is left off once zoomed out past the frame, where its number would be mistaken for a waypoint’s', () => {
    const many = Array.from({ length: 14 }, (_, i): Waypoint => ({ slice: i + 1, startedAt: i, landedAt: i + 1, title: `Slice ${i + 1}`, tasks: [{ id: `${i}`, subject: 'x', status: 'completed' }] }));
    const work = (slice: number) => sliceWork({ waypoint: many[slice - 1], artifacts: [], questions: [], prs: [], flying: new Set() });
    expect(sky(plotCourse({ waypoints: many, next: [], seed: 'whole' }, 2.5, true, 2.5), work, undefined, 2.5, 17 * 2.5).quiet.size).toBe(0);
    expect(sky(plotCourse({ waypoints: many, next: [], seed: 'whole' }, 1, true), work, undefined, 1, 17).quiet.size).toBeGreaterThan(0);
  });

  it('labels nothing as another waypoint’s on a long voyage seen at the frame’s size', () => {
    const many = Array.from({ length: 14 }, (_, i): Waypoint => ({ slice: i + 1, startedAt: i, landedAt: i + 1, title: `Slice ${i + 1}`, tasks: [{ id: `${i}`, subject: 'x', status: 'completed' }] }));
    const plot = plotCourse({ waypoints: many, next: [], seed: 'whole' }, 1, true);
    const heavens = sky(plot, (slice) => sliceWork({ waypoint: many[slice - 1], artifacts: [], questions: [], prs: [], flying: new Set() }), undefined, 1, 17);
    expect(heavens.quiet.size).toBeGreaterThan(0);
    for (const [slice, q] of heavens.quiet) {
      const own = plot.points[slice - 1];
      const box = { x0: q.x - 10 * plot.marks, y0: q.y - 10 * plot.marks, x1: q.x + 10 * plot.marks, y1: q.y + 10 * plot.marks };
      expect(misread(box, own, plot.points.filter((p) => p !== own)), `waypoint ${slice}`).toBe(false);
    }
  });
});
