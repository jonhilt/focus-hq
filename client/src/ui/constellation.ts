// A slice's work as a constellation round its waypoint on the star chart: the lead's tasks and the
// workflows the lead has running (the slice under way's, live), the probes it sent out once they're home, its commits,
// what it showed and asked on the station's screen, QA's screenshots and its pull requests. Each is a node the captain
// can pick for a look at just that. Pure, so the chart panel only draws it.

import type { GoalArtifact, GoalQuestion, LeadPr, Waypoint, Workflow } from '../../../shared/types';
import { clip, type Label, labelBox, overlaps, type Box, type Pt } from './course';

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

/** A node of the constellation where it's drawn, with its label when it has one (only round the waypoint in focus). */
export interface PlacedNode extends WorkNode, Pt {
  label?: Label;
  name?: string;
}

/**
 * How the constellation's drawn: close in and unlabelled round every waypoint (in the chart's units), or spread out and
 * named round the one in focus (in screen pixels, however far the chart's zoomed: `orbit`'s `px` turns them into units),
 * a row each in curved columns either side of it.
 */
export const ORBIT = {
  quiet: { r: 34 },
  focus: { r: 90, row: 22, columns: [1, 1.9, 2.8], chars: 26, size: 13 },
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

/** Close in round a waypoint, unnamed: evenly along the directions `taken` leaves free, in order. */
function ring(center: Pt, nodes: WorkNode[], taken: number[]): PlacedNode[] {
  const free = freeAngles(taken);
  const r = ORBIT.quiet.r;
  return nodes.map((n, i) => {
    const a = free[Math.min(free.length - 1, Math.floor(((i + 0.5) * free.length) / nodes.length))];
    return { ...n, x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r };
  });
}

/**
 * Lays a waypoint's work round it. Quietly, close in and unnamed along the directions left free by `taken`; or in focus,
 * a row each in curved columns to its right and left, each named, nearest first, skipping any row that would sit on a
 * way out that's taken or put its name over another's or any of `avoid`. They're taken in order down the right and
 * then down the left, so each kind keeps together. `px` is a screen pixel in the chart's units, as it'll be drawn.
 */
export function orbit(center: Pt, nodes: WorkNode[], taken: number[], focus: boolean, px = 1, avoid: Box[] = []): PlacedNode[] {
  if (!nodes.length) return [];
  if (!focus) return ring(center, nodes, taken);
  const { r, row, columns, chars, size } = ORBIT.focus;
  const R = r * px;
  const rowH = row * px;
  const rows = Math.ceil((R * 1.3) / rowH);
  const claimed: Box[] = [...avoid];
  const chosen: (Pt & { side: number; label: Label })[] = [];
  const names = nodes.map((n) => clip(n.text, chars));
  // the longest name, so that any row taken has room for whichever node ends up in it
  const widest = names.reduce((a, b) => (b.length > a.length ? b : a), '');
  const spots = columns.flatMap((col, c) => [1, -1].flatMap((side) => Array.from({ length: rows * 2 + 1 }, (_, k) => {
    const dy = (k - rows) * rowH;
    const reach = R * col;
    const dx = side * Math.sqrt(Math.max(reach * reach * 0.3, reach * reach - dy * dy * 0.55));
    return { x: center.x + dx, y: center.y + dy, side, near: c * 1000 + Math.abs(dy) };
  }))).sort((a, b) => a.near - b.near);
  for (const spot of spots) {
    if (chosen.length === nodes.length) break;
    if (taken.some((t) => apart(Math.atan2(spot.y - center.y, spot.x - center.x), t) < CLEARANCE)) continue;
    const label: Label = { x: spot.x + spot.side * 12 * px, y: spot.y + size * px * 0.35, anchor: spot.side > 0 ? 'start' : 'end' };
    const box = labelBox(label, widest, size * px);
    const mark: Box = { x0: spot.x - 7 * px, y0: spot.y - 7 * px, x1: spot.x + 7 * px, y1: spot.y + 7 * px };
    if (claimed.some((b) => overlaps(b, box) || overlaps(b, mark))) continue;
    claimed.push(box, mark);
    chosen.push({ ...spot, label });
  }
  // down the right, then down the left
  chosen.sort((a, b) => b.side - a.side || a.y - b.y);
  // any there was no room for left close in, unnamed (their names are on hover)
  const rest = ring(center, nodes.slice(chosen.length), taken);
  return nodes.map((n, i) => {
    const spot = chosen[i];
    return spot ? { ...n, x: spot.x, y: spot.y, label: spot.label, name: names[i] } : rest[i - chosen.length];
  });
}
