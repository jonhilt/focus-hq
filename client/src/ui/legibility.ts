// The cartographer's rules a star chart is held to, as measures of what's drawn: no label over another, over a mark or
// across a line, labels kept a little apart, and no two leaders crossing. Pure, so a layout can be scored with them
// while it's placing things, and tested against them once it has.

import { type Box, overlaps, type Pt } from './course';

/** A straight line drawn on the chart, from `a` to `b`: a stretch of the course, a leader, a link to a node. */
export type Segment = readonly [Pt, Pt];

/** What a chart (or part of it) draws, as the rules see it. */
export interface Scene {
  labels: Box[];
  marks: Box[];
  /** Lines a label mustn't run across. */
  lines: Segment[];
  /** Lines from a mark out to its label or its node, which mustn't cross each other or `lines`. */
  leaders: Segment[];
}

/** How many times a scene breaks each rule. */
export interface Faults {
  /** Pairs of labels over each other. */
  overlapping: number;
  /** Labels over a mark. */
  onMarks: number;
  /** Labels across a line or a leader. */
  onLines: number;
  /** Pairs of labels nearer than the gap they should keep, without being over each other. */
  crowded: number;
  /** Leaders crossing each other or a line. */
  crossing: number;
}

/** A box `by` bigger all round. */
export const grow = (b: Box, by: number): Box => ({ x0: b.x0 - by, y0: b.y0 - by, x1: b.x1 + by, y1: b.y1 + by });

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Whether two segments cross somewhere other than at an end they share (two leaders out of one mark don't cross). */
export function segmentsCross([a, b]: Segment, [c, d]: Segment): boolean {
  const same = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
  if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) return false;
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Whether a segment runs through (or into) a box. */
export function segmentHitsBox([a, b]: Segment, box: Box): boolean {
  const inside = (p: Pt) => p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1;
  if (inside(a) || inside(b)) return true;
  const corners = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
  return corners.some((p, i) => segmentsCross([a, b], [p, corners[(i + 1) % 4]]));
}

/** How many times `scene` breaks each rule, its labels to keep `gap` apart. */
export function faults(scene: Scene, gap: number): Faults {
  const { labels, marks, lines, leaders } = scene;
  let overlapping = 0;
  let crowded = 0;
  for (const [i, a] of labels.entries()) {
    for (const b of labels.slice(i + 1)) {
      if (overlaps(a, b)) overlapping++;
      else if (overlaps(grow(a, gap / 2), grow(b, gap / 2))) crowded++;
    }
  }
  const onMarks = labels.reduce((n, l) => n + marks.filter((m) => overlaps(l, m)).length, 0);
  const onLines = labels.reduce((n, l) => n + [...lines, ...leaders].filter((s) => segmentHitsBox(s, l)).length, 0);
  let crossing = 0;
  for (const [i, a] of leaders.entries()) {
    for (const b of [...leaders.slice(i + 1), ...lines]) if (segmentsCross(a, b)) crossing++;
  }
  return { overlapping, onMarks, onLines, crowded, crossing };
}

/** A scene that keeps every rule. */
export const NO_FAULTS: Faults = { overlapping: 0, onMarks: 0, onLines: 0, crowded: 0, crossing: 0 };
