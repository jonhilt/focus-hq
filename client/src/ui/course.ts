// Where a goal's waypoints sit on its star chart: a course from the launch point (bottom left) towards the objective (top
// right), meandering a little, turning away at each course correction with the old heading carrying on, scrubbed, and
// the lead's ideas for what's next fanning out ahead of it, and the loose threads noticed on the way as sensor contacts
// off to the side of the waypoint that noticed them. Pure, so the chart panel only draws it.

import type { Contact, Waypoint } from '../../../shared/types';

export interface Pt {
  x: number;
  y: number;
}

/** A label beside something on the chart, on whichever side keeps it off the course. */
export interface Label extends Pt {
  anchor: 'start' | 'end';
}

export interface PlottedWaypoint extends Pt {
  waypoint: Waypoint;
  /** What its label says: the slice's title, cut short. */
  name: string;
  /** Landed, the slice under way, or a slice of a closed goal that never landed. */
  state: 'landed' | 'now' | 'open';
  label: Label;
}

/** The heading a course correction left behind: on from where it turned, to a cross. */
export interface Scrubbed {
  from: Pt;
  to: Pt;
  label: Label;
  text: string;
}

/** A course the lead might take next. */
export interface Projected {
  to: Pt;
  label: Label;
  text: string;
}

/** A loose thread, as a sensor contact by the waypoint that noticed it: open, pursued (into `pursuedAt`) or dropped. */
export interface PlottedContact extends Pt {
  contact: Contact;
  state: 'open' | 'pursued' | 'dropped';
  label: Label;
  text: string;
  /** Where a pursued one was taken up: the waypoint of the slice it went into, when that's on the chart. */
  pursuedAt?: Pt;
}

export interface CoursePlot {
  width: number;
  height: number;
  launch: Pt;
  objective: Pt & { r: number };
  points: PlottedWaypoint[];
  /** The course flown, as an SVG path through the launch point and every waypoint. */
  path: string;
  scrubbed: Scrubbed[];
  projected: Projected[];
  contacts: PlottedContact[];
}

/**
 * What the chart's drawn from: the goal's waypoints in slice order, the one under way (an open goal's), what's next, and
 * the loose threads noticed on the way.
 */
export interface Voyage {
  waypoints: Waypoint[];
  current?: number;
  next: string[];
  contacts?: Contact[];
  /** Makes each goal's meander its own, and the same every time it's drawn. */
  seed: string;
}

export const CHART = { width: 900, height: 560, pad: 56, objectiveR: 84 } as const;

/** About how wide a character of a chart label is, for keeping labels clear of the objective. */
const TEXT_W = 7.2;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Roughly where a label's text lies, in Antonio (about 0.47em a character) at `size`. */
const box = (l: Label, text: string, size: number): Box => {
  const w = text.length * size * 0.47;
  const x0 = l.anchor === 'start' ? l.x : l.x - w;
  return { x0, y0: l.y - size, x1: x0 + w, y1: l.y + 3 };
};
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A waypoint's label, off to one side of the course (`out` 1 to its right as it heads up the chart, -1 to its left). */
const beside = (p: Pt, side: Pt, out: number): Label => ({ x: p.x + side.x * 26 * out, y: p.y + side.y * 26 * out + 5, anchor: out > 0 ? 'start' : 'end' });

/**
 * A label for something at `at`: to its right, unless that would run into the objective or off the chart, then to
 * its left, and failing that, under it.
 */
export function clearOf(objective: Pt & { r: number }, at: Pt, textWidth: number, width: number): Label {
  const hits = (x0: number, x1: number, y: number) => x1 > objective.x - objective.r && x0 < objective.x + objective.r && Math.abs(y - objective.y) < objective.r + 8;
  const y = at.y + 5;
  if (!hits(at.x + 12, at.x + 12 + textWidth, y) && at.x + 12 + textWidth < width - 8) return { x: at.x + 12, y, anchor: 'start' };
  if (!hits(at.x - 12 - textWidth, at.x - 12, y) && at.x - 12 - textWidth > 8) return { x: at.x - 12, y, anchor: 'end' };
  return { x: at.x, y: at.y + 24, anchor: at.x > width / 2 ? 'end' : 'start' };
}

/** A repeatable random sequence from a string: each goal's course always meanders the same way. */
export function seeded(seed: string): () => number {
  let s = 2166136261;
  for (const c of seed) s = Math.imul(s ^ c.charCodeAt(0), 16777619);
  s = (s >>> 0) % 2147483646 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Cut to `max` characters at a word, with an ellipsis. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const word = cut.lastIndexOf(' ');
  return `${(word > max / 2 ? cut.slice(0, word) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/** A smooth SVG path through the points (Catmull-Rom, as cubic Béziers). */
export function smoothPath(pts: Pt[]): string {
  if (!pts.length) return '';
  const f = (n: number) => Math.round(n * 10) / 10;
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/**
 * Lays the voyage out on a chart of `CHART`'s size. Waypoints step along the line from the launch point to the
 * objective, never reaching it (how far is left is anyone's guess), each drifting a little to one side of it; after a
 * course correction the course swings over to the other side, and the old heading carries on from the turn, scrubbed.
 */
export function plotCourse(voyage: Voyage): CoursePlot {
  const { width, height, pad, objectiveR } = CHART;
  const rand = seeded(voyage.seed);
  const launch = { x: pad + 8, y: height - pad - 24 };
  const objective = { x: width - pad - objectiveR + 20, y: pad + objectiveR - 16, r: objectiveR };
  const along = { x: objective.x - launch.x, y: objective.y - launch.y };
  const total = Math.hypot(along.x, along.y);
  const dir = { x: along.x / total, y: along.y / total };
  // to the course's right as it heads up the chart: down and to the right
  const side = { x: -dir.y, y: dir.x };
  const n = voyage.waypoints.length;
  const usable = total - objectiveR - 70;
  const step = Math.min(150, usable / (n + 1.3));
  const swing = Math.min(70, step * 0.6);
  const clampX = (x: number) => Math.max(pad, Math.min(width - pad, x));
  const clampY = (y: number) => Math.max(pad, Math.min(height - pad, y));

  // the slice that went the wrong way drifts well out to one side; after it, the course swings back towards the objective
  let drift = 0;
  const points: PlottedWaypoint[] = voyage.waypoints.map((waypoint, i) => {
    const before = voyage.waypoints[i - 1];
    const wander = Math.max(-swing, Math.min(swing, drift * 0.5 + (rand() * 2 - 1) * swing * 0.6));
    drift = waypoint.turnedFrom ? (Math.sign(drift) || 1) * swing : before?.turnedFrom ? -Math.sign(drift) * swing * 0.25 : wander;
    const s = step * (i + 1);
    const x = clampX(launch.x + dir.x * s + side.x * drift);
    const y = clampY(launch.y + dir.y * s + side.y * drift);
    // a label sits out on the side its waypoint drifted to (in towards the course at a turn, whose scrubbed heading
    // takes the outside), or alternates while the course runs straight, so neighbours don't run into each other
    const outward = Math.abs(drift) > swing * 0.3 ? Math.sign(drift) : i % 2 ? 1 : -1;
    const out = waypoint.turnedFrom ? -outward : outward;
    const state = waypoint.landedAt ? 'landed' : waypoint.slice === voyage.current ? 'now' : 'open';
    return { x, y, waypoint, name: clip(waypoint.title ?? `Slice ${waypoint.slice}`, 28), state, label: beside({ x, y }, side, out) };
  });

  // each correction's old heading: on from the turn, further off course, to a cross
  const scrubbed: Scrubbed[] = points.flatMap((p) => {
    const from = p.waypoint.turnedFrom;
    if (!from) return [];
    const off = Math.sign((p.x - launch.x) * side.x + (p.y - launch.y) * side.y) || 1;
    const veer = 0.75;
    const heading = { x: dir.x * Math.cos(veer) + side.x * off * Math.sin(veer), y: dir.y * Math.cos(veer) + side.y * off * Math.sin(veer) };
    const reach = Math.max(70, step * 0.8);
    const to = { x: clampX(p.x + heading.x * reach), y: clampY(p.y + heading.y * reach) };
    const label = { x: to.x + side.x * 14 * off, y: to.y + side.y * 14 * off + 5, anchor: off > 0 ? ('start' as const) : ('end' as const) };
    return [{ from: { x: p.x, y: p.y }, to, text: clip(from, 34), label }];
  });

  // a label that would land on another, or on a waypoint, goes on the other side of its own instead (whichever side
  // runs into less), the earlier waypoints' labels and the scrubbed headings' having first claim
  const taken: Box[] = [
    ...points.map((p) => ({ x0: p.x - 14, y0: p.y - 14, x1: p.x + 14, y1: p.y + 14 })),
    ...scrubbed.map((x) => box(x.label, `SCRUBBED ${x.text}`, 14)),
    box({ x: launch.x - 20, y: launch.y + 30, anchor: 'start' }, 'LAUNCH · SD 00.00.00', 15),
  ];
  for (const [i, p] of points.entries()) {
    const own = taken[i];
    const hits = (l: Label) => taken.filter((b) => b !== own && overlaps(b, box(l, p.name, 17))).length;
    const other = beside(p, side, p.label.anchor === 'start' ? -1 : 1);
    if (hits(p.label) && hits(other) < hits(p.label)) p.label = other;
    taken.push(box(p.label, p.name, 17));
  }

  // what's next fans out ahead of the last waypoint, towards the objective but stopping short of it
  const last = points.at(-1) ?? launch;
  const ahead = Math.atan2(objective.y - last.y, objective.x - last.x);
  const gap = Math.hypot(objective.x - last.x, objective.y - last.y) - objectiveR;
  const reach = Math.max(80, Math.min(170, gap * 0.7));
  const ideas = voyage.next.slice(0, 3);
  const spread = ideas.length === 1 ? [0] : ideas.length === 2 ? [-0.4, 0.4] : [-0.7, 0, 0.7];
  const projected: Projected[] = ideas.map((idea, i) => {
    const a = ahead + spread[i];
    const to = { x: clampX(last.x + Math.cos(a) * reach), y: clampY(last.y + Math.sin(a) * reach) };
    const text = clip(idea, 30);
    return { to, text, label: clearOf(objective, to, text.length * TEXT_W, width) };
  });

  // contacts sit off to the side of the waypoint that noticed them, away from its label where there's room, each placed
  // where it and its label run into the least that's already on the chart
  taken.push(
    { x0: objective.x - objectiveR, y0: objective.y - objectiveR - 24, x1: objective.x + objectiveR, y1: objective.y + objectiveR },
    ...projected.flatMap((p) => [box(p.label, p.text, 15), { x0: p.to.x - 7, y0: p.to.y - 7, x1: p.to.x + 7, y1: p.to.y + 7 }]),
  );
  const at = (slice: number) => points.find((p) => p.waypoint.slice === slice);
  const nearby = new Map<number, number>();
  const contacts: PlottedContact[] = (voyage.contacts ?? []).map((contact) => {
    const wp = at(contact.slice) ?? points.at(-1);
    const by = wp ?? launch;
    const k = nearby.get(contact.slice) ?? 0;
    nearby.set(contact.slice, k + 1);
    const away = wp?.label.anchor === 'start' ? -1 : 1;
    const text = clip(contact.text, 26);
    const tries = [away, -away].flatMap((out) => [58, 92, 126].flatMap((d) => [0, -0.35, 0.35, -0.7, 0.7].map((t) => {
      const spot = { x: clampX(by.x + side.x * d * out + dir.x * step * (t + (k % 3) * 0.12)), y: clampY(by.y + side.y * d * out + dir.y * step * (t + (k % 3) * 0.12)) };
      const label: Label = out > 0 ? { x: spot.x + 12, y: spot.y + 5, anchor: 'start' } : { x: spot.x - 12, y: spot.y + 5, anchor: 'end' };
      const mark = { x0: spot.x - 9, y0: spot.y - 9, x1: spot.x + 9, y1: spot.y + 9 };
      const room = label.anchor === 'start' ? box(label, text, 15).x1 < width - 4 : box(label, text, 15).x0 > 4;
      return { spot, label, boxes: [mark, box(label, text, 15)], cost: taken.filter((b) => overlaps(b, mark) || overlaps(b, box(label, text, 15))).length + (room ? 0 : 5) };
    })));
    const best = tries.reduce((a, b) => (b.cost < a.cost ? b : a));
    taken.push(...best.boxes);
    const closed = contact.closed;
    const pursued = closed?.as === 'pursued' ? at(closed.slice) : undefined;
    return { ...best.spot, contact, state: closed?.as ?? 'open', label: best.label, text, ...(pursued && { pursuedAt: { x: pursued.x, y: pursued.y } }) };
  });

  return { width, height, launch, objective, points, path: smoothPath([launch, ...points]), scrubbed, projected, contacts };
}

/**
 * The goal's waypoints with a gap filled for every slice that has none (goals started before they were kept, or a
 * slice nothing has happened in yet), so the chart shows every slice up to `upTo`.
 */
export function everySlice(waypoints: Waypoint[] | undefined, upTo: number, startedAt: number): Waypoint[] {
  const kept = new Map((waypoints ?? []).map((w) => [w.slice, w]));
  const first = Math.min(1, ...kept.keys());
  const last = Math.max(upTo, ...kept.keys());
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => kept.get(first + i) ?? { slice: first + i, startedAt });
}
