// A slice's work as a constellation round its waypoint on the star chart: the lead's tasks and the
// workflows the lead has running (the slice under way's, live), the probes it sent out once they're home, its commits,
// what it showed and asked on the station's screen, QA's screenshots and its pull requests. Each is a node the captain
// can pick for a look at just that. Pure, so the chart panel only draws it.

import type { GoalArtifact, GoalQuestion, LeadPr, Waypoint, Workflow } from '../../../shared/types';
import { type Box, clip, type CoursePlot, type Label, labelBox, misread, overlaps, type Pt } from './course';
import { type Segment, segmentHitsBox, segmentsCross } from './legibility';

export type WorkKind = 'task' | 'workflow' | 'probe' | 'commits' | 'shown' | 'asked' | 'shot' | 'pr';

/** One piece of a slice's work. `key` is unique within the slice (`probe:<id>`, `pr:<repo>#<n>`…). */
export interface WorkNode {
  key: string;
  kind: WorkKind;
  text: string;
  /** Done (or merged, or answered), still to do, at it now, failed (or closed), or never heard from again. */
  state: 'done' | 'open' | 'active' | 'failed' | 'lost';
}

/** What a slice's work is read from: the waypoint, and what the goal keeps by slice (and, for the slice under way, live). */
export interface SliceSource {
  waypoint: Waypoint;
  /** The workflows: only the slice under way has them. Its tasks are on its waypoint. */
  workflows?: Workflow[];
  artifacts: GoalArtifact[];
  questions: GoalQuestion[];
  prs: LeadPr[];
  /** Probes still flying on the chart (out, or transmitting home): they join the constellation once they're home. */
  flying: ReadonlySet<string>;
}

const TASK_STATE = { pending: 'open', in_progress: 'active', completed: 'done' } as const;
const WORKFLOW_STATE = { running: 'active', done: 'done', failed: 'failed' } as const;

/** A slice's work, in the order the constellation lays it out round the waypoint: tasks first, the pull requests last. */
export function sliceWork(src: SliceSource): WorkNode[] {
  const w = src.waypoint;
  const prName = (repo: string, n: number) => `${repo.split('/')[1] ?? repo} #${n}`;
  return [
    ...(w.tasks ?? []).map((t): WorkNode => ({ key: `task:${t.id}`, kind: 'task', text: t.subject, state: TASK_STATE[t.status] })),
    ...(src.workflows ?? []).map((f): WorkNode => ({ key: `workflow:${f.id}`, kind: 'workflow', text: f.name, state: WORKFLOW_STATE[f.status] })),
    ...(w.probes ?? []).filter((p) => !src.flying.has(p.id)).map((p): WorkNode => ({
      key: `probe:${p.id}`, kind: 'probe', text: p.description,
      state: !p.endedAt ? 'lost' : p.ok ? 'done' : 'failed',
    })),
    ...(w.commits ? [{ key: 'commits', kind: 'commits' as const, text: `${w.commits} commit${w.commits === 1 ? '' : 's'}`, state: 'done' as const }] : []),
    ...src.artifacts.filter((a) => a.slice === w.slice).map((a): WorkNode => ({ key: `shown:${a.id}`, kind: 'shown', text: a.title, state: 'done' })),
    ...src.questions.filter((q) => q.slice === w.slice).map((q): WorkNode => ({ key: `asked:${q.id}`, kind: 'asked', text: q.question, state: q.answer ? 'done' : 'open' })),
    ...(w.evidence ?? []).map((e, i): WorkNode => ({ key: `shot:${i}`, kind: 'shot', text: e.caption, state: 'done' })),
    ...src.prs.filter((p) => p.slice === w.slice).map((p): WorkNode => ({
      key: `pr:${p.repo}#${p.number}`, kind: 'pr', text: prName(p.repo, p.number),
      state: p.outcome === 'merged' ? 'done' : p.outcome === 'closed' ? 'failed' : 'open',
    })),
  ];
}

/** Pieces of work that say the same (the same script probed three times), gathered into one, counted. */
export interface Gathered extends WorkNode {
  /** How many it stands for. */
  count: number;
  /** Every piece's `key`, the first (`key`) opened when it's picked. */
  keys: string[];
}

/** How a gathered node stands: at it now if any is, else failed, never heard from, still to do, or done. */
const WORST: WorkNode['state'][] = ['active', 'failed', 'lost', 'open', 'done'];

/** A slice's work with the pieces that say the same gathered into one, where the first of them was. */
export function gather(nodes: WorkNode[]): Gathered[] {
  const out: Gathered[] = [];
  const by = new Map<string, Gathered>();
  for (const n of nodes) {
    const same = by.get(`${n.kind}:${n.text}`);
    if (!same) {
      const g = { ...n, count: 1, keys: [n.key] };
      by.set(`${n.kind}:${n.text}`, g);
      out.push(g);
      continue;
    }
    same.count++;
    same.keys.push(n.key);
    same.state = WORST.find((s) => s === same.state || s === n.state) ?? same.state;
  }
  return out;
}

/** A node of the column round the waypoint in focus, where it's drawn, with its label. */
export interface PlacedNode extends Gathered, Pt {
  label: Label;
  /** What its label says: its text, cut short, and how many it stands for. */
  name: string;
  /** The last row of a slice with more work than rows: how many more there are (in the waypoint's log). */
  more?: number;
}

/** Round a waypoint out of focus, its work as a count, close in where it's clear. */
export interface Quiet extends Pt {
  count: number;
}

/** The waypoint in focus's work: a row each in one column off to one side, joined to the waypoint by a spine. */
export interface Column {
  nodes: PlacedNode[];
  side: 1 | -1;
  /** The leaders: from the waypoint's ring to the spine, the spine down the column (when there's more than a row), and a tick out to each row. */
  leaders: Segment[];
  /** Everything the column and its waypoint take up, for zooming to. */
  bounds: Box;
}

/**
 * How the work round a waypoint's drawn: a count close in round every waypoint out of focus (in the chart's units); a
 * column of rows round the one in focus, in screen pixels however far the chart's zoomed (`column`'s `px` turns them
 * into units), so its words are always the same size and the same distance apart.
 */
export const ORBIT = {
  quiet: { r: 34, size: 9 },
  focus: { row: 24, size: 13, reach: [72, 112, 160, 220, 300], ring: 24, mark: 6, gap: 9, chars: 30, rows: 12 },
} as const;

/** How far round (radians) to keep clear of each way out of a waypoint that's already taken: the course, its name. */
const CLEARANCE = 0.42;
const SAMPLES = 72;

const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const apart = (a: number, b: number) => {
  const d = Math.abs(norm(a) - norm(b));
  return Math.min(d, 2 * Math.PI - d);
};

/**
 * The directions round a waypoint left free (every `SAMPLES`th of a turn not within `CLEARANCE` of a way out that's
 * taken), in order round from the edge of a taken one, so nodes laid along them in turn keep their kinds together.
 */
export function freeAngles(taken: number[]): number[] {
  const all = Array.from({ length: SAMPLES }, (_, i) => (i * 2 * Math.PI) / SAMPLES);
  const free = all.map((a) => !taken.some((t) => apart(a, t) < CLEARANCE));
  if (!free.some(Boolean)) return all;
  // start just after a taken direction, so the free ones run round without a break in the middle
  const start = free.findIndex((f, i) => f && !free[(i - 1 + SAMPLES) % SAMPLES]);
  return Array.from({ length: SAMPLES }, (_, i) => (start + i) % SAMPLES).filter((i) => free[i]).map((i) => all[i]);
}

const square = (p: Pt, r: number): Box => ({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });

/**
 * A waypoint out of focus's work, generalised as a cartographer would at this scale: one small count close in, in the
 * middle of the directions `taken` leaves free, or as near it as runs into none of `avoid` or `lines` and sits nearer
 * its own waypoint than any of `others` (none if there's no such spot), `marks` times its usual size and distance out
 * (as the chart's marks are drawn).
 */
export function quiet(center: Pt, count: number, taken: number[], avoid: Box[] = [], lines: Segment[] = [], marks = 1, others: readonly Pt[] = []): Quiet | undefined {
  if (!count) return undefined;
  const free = freeAngles(taken);
  const mid = (free.length - 1) / 2;
  const r = ORBIT.quiet.r * marks;
  const tries = free.map((a, i) => ({ a, far: Math.abs(i - mid) })).sort((x, y) => x.far - y.far);
  const at = (a: number) => ({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
  const clear = tries.find(({ a }) => {
    const box = square(at(a), 10 * marks);
    return !avoid.some((b) => overlaps(b, box)) && !lines.some((s) => segmentHitsBox(s, box)) && !misread(box, center, others);
  });
  // one that would sit nearer another waypoint than its own is left off when there's none clear (it's a small thing, and
  // it'd mislead); with no waypoints near enough to mistake it for, it goes where it must
  if (!clear && others.length) return undefined;
  return { ...at((clear ?? tries[0]).a), count };
}

/** What the column round the waypoint in focus keeps clear of, and where it has to stay. */
export interface Surroundings {
  /** Screen pixels in the chart's units, as it'll be drawn. */
  px: number;
  /** What's already drawn there that its names and marks mustn't cover: the course's names, marks, contacts. */
  avoid: Box[];
  /** Lines its names mustn't run across, nor its leaders cross: the course, scrubbed headings, what's next. */
  lines: Segment[];
  /** The ways out of the waypoint the course takes (radians): the column would rather sit away from them. */
  course: number[];
  width: number;
  height: number;
}

/**
 * Lays the waypoint in focus's work out as boundary labelling does a crowded map: rather than each name squeezed in
 * somewhere round its mark, the rows stand evenly spaced in one column off to one side, kinds together in order, joined
 * to the waypoint by one leader to a spine down the column's near side, with a tick out to each row (so nothing crosses,
 * however many rows there are). Of every side, reach and height the column could take, it takes the one that covers
 * nothing and crosses no line, on the chart if it can be (past its edge if that's the only clear room), nearest in and
 * away from the course. A slice with more work than rows ends with a row saying how many more.
 */
export function column(center: Pt, work: WorkNode[], at: Surroundings): Column | undefined {
  const all = gather(work);
  if (!all.length) return undefined;
  const { row, size, reach, ring, mark, gap, chars, rows } = ORBIT.focus;
  const { px, avoid, lines, course, width, height } = at;
  const shown = all.length > rows ? all.slice(0, rows - 1) : all;
  const hidden = all.slice(shown.length);
  const names = shown.map((n) => `${clip(n.text, chars)}${n.count > 1 ? ` ×${n.count}` : ''}`);
  if (hidden.length) names.push(`+${hidden.reduce((k, n) => k + n.count, 0)} more in the log`);
  const n = names.length;
  const rowH = row * px;
  const away = (side: number) => course.reduce((k, a) => k + Math.max(0, Math.cos(a) * side), 0);
  /** Where everything of a column `side` of the waypoint, its marks at `x` and its first row at `top`, is drawn. */
  const lay = (side: 1 | -1, x: number, top: number) => {
    const spine = x - side * (mark + gap) * px;
    const anchor: Label['anchor'] = side > 0 ? 'start' : 'end';
    const rowsAt = names.map((name, i) => {
      const y = top + i * rowH;
      return {
        name, y,
        dot: square({ x, y }, mark * px),
        label: { x: x + side * (mark + gap) * px, y: y + size * px * 0.35, anchor },
        tick: [{ x: spine, y }, { x: x - side * mark * 1.4 * px, y }] as Segment,
      };
    });
    const joint = { x: spine, y: Math.max(top, Math.min(top + (n - 1) * rowH, center.y)) };
    const d = Math.hypot(joint.x - center.x, joint.y - center.y) || 1;
    const connector: Segment = [{ x: center.x + ((joint.x - center.x) * ring) / d, y: center.y + ((joint.y - center.y) * ring) / d }, joint];
    const spineLine: Segment = [{ x: spine, y: top }, { x: spine, y: top + (n - 1) * rowH }];
    return { rowsAt, leaders: [connector, ...(n > 1 ? [spineLine] : []), ...rowsAt.map((r) => r.tick)] };
  };
  let best: { cost: number; side: 1 | -1; x: number; top: number } | undefined;
  for (const side of [1, -1] as const) {
    for (const [ri, r] of reach.entries()) {
      const x = center.x + side * Math.max(ring + 16, r * px);
      for (let k = -n; k <= n; k++) {
        const top = center.y - ((n - 1) * rowH) / 2 + k * rowH;
        let cost = away(side) * 40 + ri * 12 + Math.abs(k) * 3;
        if (best && cost >= best.cost) continue;
        const { rowsAt, leaders } = lay(side, x, top);
        for (const l of leaders.slice(0, 2)) {
          for (const b of avoid) cost += segmentHitsBox(l, b) ? 2000 : 0;
          for (const s of lines) cost += segmentsCross(s, l) ? 1000 : 0;
        }
        for (const row of rowsAt) {
          const label = labelBox(row.label, row.name, size * px);
          // past the chart's edge is only open space, which the view can take in: better than covering a name
          if (![row.dot, label].every((b) => b.x0 >= 4 && b.x1 <= width - 4 && b.y0 >= 4 && b.y1 <= height - 4)) cost += 500;
          for (const b of avoid) cost += overlaps(b, label) || overlaps(b, row.dot) ? 10_000 : 0;
          for (const s of lines) cost += segmentHitsBox(s, label) || segmentHitsBox(s, row.dot) ? 1000 : 0;
          if (best && cost >= best.cost) break;
        }
        if (!best || cost < best.cost) best = { cost, side, x, top };
      }
    }
  }
  if (!best) return undefined;
  const { side, x, top } = best;
  const { rowsAt, leaders } = lay(side, x, top);
  const nodes = rowsAt.map((row, i): PlacedNode => {
    const of = shown[i] ?? { ...hidden[0], keys: hidden.flatMap((h) => h.keys) };
    return { ...of, x, y: row.y, label: row.label, name: row.name, ...(i >= shown.length && { more: hidden.reduce((k, h) => k + h.count, 0) }) };
  });
  const boxes = nodes.map((p) => labelBox(p.label, p.name, size * px));
  const bounds = [square(center, ring + 8), ...nodes.map((p) => square(p, mark * px)), ...boxes].reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
  return { nodes, side, leaders, bounds };
}

/** Every waypoint's work on the chart: the one in focus's as a column, the rest's as counts. */
export interface Sky {
  column?: Column & { slice: number };
  quiet: Map<number, Quiet>;
}

/** The lines on a plotted chart that labels mustn't run across: the course, scrubbed headings, what's next, pursued trails. */
export function chartLines(plot: CoursePlot): Segment[] {
  const course = [plot.launch, ...plot.points];
  const last = plot.points.at(-1) ?? plot.launch;
  return [
    ...course.slice(1).map((p, i): Segment => [course[i], p]),
    ...plot.scrubbed.map((x): Segment => [x.from, x.to]),
    ...plot.projected.map((p): Segment => [last, p.to]),
    ...plot.contacts.flatMap((c): Segment[] => (c.pursuedAt ? [[c, c.pursuedAt]] : [])),
  ];
}

/** What's drawn on a plotted chart that the work round its waypoints mustn't cover, its names `nameSize` big. */
export function chartMarks(plot: CoursePlot, nameSize: number): Box[] {
  const o = plot.objective;
  const m = plot.marks;
  return [
    ...plot.points.flatMap((p) => [square(p, ORBIT.focus.ring * m), ...(p.label ? [labelBox(p.label, p.lines, nameSize)] : [])]),
    ...plot.contacts.flatMap((c) => [square(c, 9 * m), ...(c.label ? [labelBox(c.label, c.text, nameSize)] : [])]),
    ...plot.projected.flatMap((p) => [square(p.to, 7 * m), ...(p.label ? [labelBox(p.label, p.text, nameSize)] : [])]),
    ...plot.scrubbed.flatMap((x) => [square(x.to, 8 * m), ...(x.label ? [labelBox(x.label, `SCRUBBED ${x.text}`, nameSize)] : [])]),
    square(plot.launch, 8 * m),
    { x0: o.x - o.r * 0.9, y0: o.y - o.r - 24, x1: o.x + o.r * 0.9, y1: o.y + o.r * 0.7 },
  ];
}

/**
 * The work round every waypoint of a plotted chart: `focus`'s as a column, `px` a screen pixel in the chart's units,
 * the rest as counts, all clear of the course and its names (drawn `nameSize` big), and the counts of the column too.
 */
export function sky(plot: CoursePlot, workOf: (slice: number) => WorkNode[], focus: number | undefined, px: number, nameSize: number): Sky {
  const toward = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
  const lines = chartLines(plot);
  const avoid = chartMarks(plot, nameSize);
  const ways = (i: number) => {
    const p = plot.points[i];
    const before = plot.points[i - 1] ?? plot.launch;
    const after = plot.points[i + 1] ?? (plot.projected.length ? plot.objective : undefined);
    return [toward(p, before), ...(after ? [toward(p, after)] : [])];
  };
  const at = plot.points.findIndex((p) => p.waypoint.slice === focus);
  const placed = at < 0 ? undefined : column(plot.points[at], workOf(focus!), { px, avoid: avoid.filter((b) => !overlaps(b, square(plot.points[at], 1))), lines, course: ways(at), width: plot.width, height: plot.height });
  const taken = [...avoid, ...(placed ? [...placed.nodes.map((p) => square(p, ORBIT.focus.mark * px)), ...placed.nodes.map((p) => labelBox(p.label, p.name, ORBIT.focus.size * px))] : [])];
  const quietOnes = new Map<number, Quiet>();
  for (const [i, p] of plot.points.entries()) {
    // zoomed out past the frame (its marks drawn bigger to stay seen), the counts are left off: generalised away, as a
    // small-scale map drops its minor features, rather than numbers among the waypoints' own to mistake for them
    if (i === at || plot.marks > 1) continue;
    const name = p.label && labelBox(p.label, p.lines, nameSize);
    const dirs = [...ways(i), ...(name ? [toward(p, { x: (name.x0 + name.x1) / 2, y: (name.y0 + name.y1) / 2 })] : [])];
    // a count sits by its own waypoint's mark, so that's not in its way
    const own = square(p, ORBIT.focus.ring * plot.marks);
    const near = taken.filter((b) => !(b.x0 === own.x0 && b.y0 === own.y0 && b.x1 === own.x1 && b.y1 === own.y1));
    const q = quiet(p, workOf(p.waypoint.slice).length, dirs, near, [...lines, ...(placed?.leaders ?? [])], plot.marks, plot.points.filter((o) => o !== p));
    if (q) {
      quietOnes.set(p.waypoint.slice, q);
      taken.push(square(q, 10 * plot.marks));
    }
  }
  // zoomed to, the column takes its waypoint's name in with it
  const own = at < 0 ? undefined : plot.points[at];
  const name = own?.label && labelBox(own.label, own.lines, nameSize);
  const bounds = placed && name ? { x0: Math.min(placed.bounds.x0, name.x0), y0: Math.min(placed.bounds.y0, name.y0), x1: Math.max(placed.bounds.x1, name.x1), y1: Math.max(placed.bounds.y1, name.y1) } : placed?.bounds;
  return { ...(placed && bounds && { column: { ...placed, bounds, slice: focus! } }), quiet: quietOnes };
}
