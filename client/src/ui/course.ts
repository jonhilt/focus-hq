// Where a goal's waypoints sit on its star chart: a course from the launch point (bottom left) towards the objective (top
// right), meandering a little, turning away at each course correction with the old heading carrying on, scrubbed, and
// the lead's ideas for what's next fanning out ahead of it, and the loose threads noticed on the way as sensor contacts
// off to the side of the waypoint that noticed them. Pure, so the chart panel only draws it.

import type { Agent, Contact, Probe, Shield, Waypoint } from '../../../shared/types';

export interface Pt {
  x: number;
  y: number;
}

/** A label beside something on the chart, placed where it runs into nothing else drawn there. */
export interface Label extends Pt {
  anchor: 'start' | 'middle' | 'end';
  /** Set on one pushed further out than usual, to say it wants a faint line back to its mark. */
  leader?: boolean;
}

export interface PlottedWaypoint extends Pt {
  waypoint: Waypoint;
  /** What its label says (`waypointName`), cut short. */
  name: string;
  /** Its name as drawn: on one line, or wrapped onto two rather than cut short. */
  lines: string[];
  /** Where its name came from (`waypointName`). */
  named: Named;
  /** Landed, the slice under way, or a slice of a closed goal that never landed. */
  state: 'landed' | 'now' | 'open';
  /** Missing when there's no clear room for it (an older waypoint on a long voyage): its number shows, its name on hover. */
  label?: Label;
}

/** The heading a course correction left behind: on from where it turned, to a cross. */
export interface Scrubbed {
  from: Pt;
  to: Pt;
  /** Missing when there's no clear room for it. */
  label?: Label;
  text: string;
}

/** A course the lead might take next. */
export interface Projected {
  to: Pt;
  /** Missing when there's no clear room for it. */
  label?: Label;
  text: string;
}

/** A loose thread, as a sensor contact by the waypoint that noticed it: open, pursued (into `pursuedAt`) or dropped. */
export interface PlottedContact extends Pt {
  contact: Contact;
  state: 'open' | 'pursued' | 'dropped';
  /** Missing when there's no clear room for it. */
  label?: Label;
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
  /** How big each kind of label is drawn, which the layout kept clear for: `LABEL_SIZE` times the plot's scale. */
  sizes: Record<keyof typeof LABEL_SIZE, number>;
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

/** Each kind of label's font size on the chart panel, in the plot's units; the briefing room's wall draws them bigger. */
export const LABEL_SIZE = { waypoint: 17, idea: 15, contact: 15, scrubbed: 14, launch: 15 } as const;

/** How many characters each kind of label keeps at the panel's size (fewer when drawn bigger); a waypoint's on each of its two lines. */
const LABEL_CHARS = { waypoint: 28, idea: 30, contact: 26, scrubbed: 34 } as const;

/** How far apart the lines of a label wrapped onto two are, as a share of its size. */
export const LINE_GAP = 1.15;

/** About how wide a character of a chart label is, for keeping labels clear of the objective. */
const TEXT_W = 7.2;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Roughly where a label's text lies, in Antonio (about 0.47em a character) at `size`: one line, or several under it. */
export const labelBox = (l: Label, text: string | readonly string[], size: number): Box => {
  const lines = typeof text === 'string' ? [text] : text;
  const w = Math.max(0, ...lines.map((t) => t.length)) * size * 0.47;
  const x0 = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - w : l.x - w / 2;
  return { x0, y0: l.y - size, x1: x0 + w, y1: l.y + size * 0.18 + (lines.length - 1) * size * LINE_GAP };
};
export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
/** How far a point is from a box (none, inside it). */
export const distanceTo = (b: Box, p: Pt) => Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1));
/**
 * Whether a label at `b` reads as another mark's: one of `others` is nearer it than its own mark at `own` (a reader
 * takes a name for the nearest mark's, as a cartographer knows).
 */
export const misread = (b: Box, own: Pt, others: readonly Pt[]) => others.some((q) => distanceTo(b, q) < distanceTo(b, own));
const square = (p: Pt, r: number): Box => ({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });

/** How many of `boxes` a box overlaps, counted in loops rather than filtered (no array for each of thousands of spots). */
export function hitsAmong(boxes: Box[], b: Box): number {
  let hits = 0;
  for (const o of boxes) if (overlaps(o, b)) hits++;
  return hits;
}

/**
 * `hitsAmong(boxes, b)` for boxes that don't change, kept in columns `column` wide by their left edge, so a box is only
 * weighed against those in the columns it spans (and, to its left, as far as the widest of them reaches).
 */
export function hitCounter(boxes: Box[], column = 32): (b: Box) => number {
  const reach = boxes.reduce((w, o) => Math.max(w, o.x1 - o.x0), 0);
  const columns = new Map<number, Box[]>();
  for (const o of boxes) {
    const k = Math.floor(o.x0 / column);
    const inColumn = columns.get(k);
    if (inColumn) inColumn.push(o);
    else columns.set(k, [o]);
  }
  return (b) => {
    let hits = 0;
    for (let k = Math.floor((b.x0 - reach) / column); k <= Math.floor(b.x1 / column); k++) hits += hitsAmong(columns.get(k) ?? [], b);
    return hits;
  };
}

/**
 * The first of `tries` that costs least, where a try costs `least(t, i)`, which never falls further down the list, plus
 * `first(t)` and then `then(t)`, none of them negative: the same as weighing every try, but it stops once none further
 * down can beat the best, and doesn't weigh `then` for a try that `first` has already put out of the running.
 */
export function cheapest<T>(tries: readonly T[], least: (t: T, i: number) => number, first: (t: T) => number, then: (t: T) => number = () => 0): { at: T; cost: number } | undefined {
  let best: { at: T; cost: number } | undefined;
  for (const [i, t] of tries.entries()) {
    const floor = least(t, i);
    if (best && best.cost <= floor) break;
    const before = first(t);
    if (best && before + floor >= best.cost) continue;
    const cost = before + then(t) + floor;
    if (!best || cost < best.cost) best = { at: t, cost };
  }
  return best;
}

/** A label off to one side of the course (`out` 1 to its right as it heads up the chart, -1 to its left), `extra` taller than a line. */
const beside = (p: Pt, side: Pt, out: number, d = 26, extra = 0): Label => ({ x: p.x + side.x * d * out, y: p.y + side.y * d * out + 5 - extra / 2, anchor: out > 0 ? 'start' : 'end' });

/**
 * Every spot round a mark at `p` a label of `size` could go, `d` out, in the cartographer's order of preference (Imhof's):
 * above right, below right, above left, below left, then to either side, above and below. A label of `lines` lines
 * grows up from those above the mark and stays centred on those beside it.
 */
function around(p: Pt, d: number, size: number, lines = 1): Label[] {
  const k = d * 0.75;
  const extra = (lines - 1) * size * LINE_GAP;
  return [
    { x: p.x + k, y: p.y - k - extra, anchor: 'start' },
    { x: p.x + k, y: p.y + k + size * 0.7, anchor: 'start' },
    { x: p.x - k, y: p.y - k - extra, anchor: 'end' },
    { x: p.x - k, y: p.y + k + size * 0.7, anchor: 'end' },
    { x: p.x + d, y: p.y + size * 0.35 - extra / 2, anchor: 'start' },
    { x: p.x - d, y: p.y + size * 0.35 - extra / 2, anchor: 'end' },
    { x: p.x, y: p.y - d - 2 - extra, anchor: 'middle' },
    { x: p.x, y: p.y + d + size * 0.75, anchor: 'middle' },
  ];
}

/** Where a leader from a mark at `p` to its label `l` of `size` (and `lines` lines) ends: just short of the text's nearest edge. */
export function leaderEnd(p: Pt, l: Label, size: number, lines = 1): Pt {
  const extra = (lines - 1) * size * LINE_GAP;
  const y = l.anchor === 'middle' ? (l.y < p.y ? l.y + extra + 4 : l.y - size) : l.y - size * 0.35 + extra / 2;
  const x = l.anchor === 'start' ? l.x - 4 : l.anchor === 'end' ? l.x + 4 : l.x;
  return { x, y };
}

/** Little boxes along a straight line, `r` either side of it, for keeping labels off what's drawn there. */
function along(a: Pt, b: Pt, r = 3): Box[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (r * 2.5)));
  return Array.from({ length: n + 1 }, (_, i) => square({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, r));
}

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

/**
 * Broken at words into at most `lines` lines of `max` characters, the last cut short with an ellipsis if it all won't
 * fit: a name keeps what it means rather than losing its second half.
 */
export function wrap(text: string, max: number, lines = 2): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest && out.length < lines - 1 && rest.length > max) {
    const cut = rest.lastIndexOf(' ', max);
    if (cut <= max / 3) break;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut + 1).trim();
  }
  return [...out, clip(rest, max)];
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

/** The closest waypoints come along the course on a chart that grows (`chartSize`). */
export const STEP = 110;

/**
 * How big a chart a voyage of `n` waypoints is laid out on: `CHART`'s size, or, when it may `grow` (the chart panel,
 * which can be zoomed and dragged about, unlike the wall), as much bigger, the same shape, as keeps its waypoints
 * `STEP` apart rather than squeezing them closer.
 */
export function chartSize(n: number, grow: boolean): { width: number; height: number } {
  const { width, height, pad, objectiveR } = CHART;
  const diagonal = Math.hypot(width - 2 * pad - objectiveR + 12, height - 2 * pad - objectiveR - 8);
  const k = grow ? Math.max(1, ((n + 1.3) * STEP + objectiveR + 70) / diagonal) : 1;
  return { width: width * k, height: height * k };
}

/**
 * Lays the voyage out on a chart of `chartSize`, its labels `scale` times `LABEL_SIZE` (bigger on the briefing
 * room's wall). Waypoints step along the line from the launch point to the objective, never reaching it (how far is left
 * is anyone's guess), each drifting a little to one side of it; after a course correction the course swings over to the
 * other side, and the old heading carries on from the turn, scrubbed.
 *
 * Then every label is placed in one pass, the ones that matter most first: the scrubbed headings, the waypoint under
 * way and the rest newest first, what's next, and the contacts. Each takes the spot round its mark that runs into nothing
 * already placed, and crosses the fewest lines (a waypoint's name sits nearer its own waypoint than any other, or it'd be
 * read as that one's, so it goes without); one with no clear spot left goes without (its name's still on hover), so
 * on a long voyage the oldest waypoints are the ones that shrink to their numbers.
 */
export function plotCourse(voyage: Voyage, scale = 1, grow = false): CoursePlot {
  const { pad, objectiveR } = CHART;
  const { width, height } = chartSize(voyage.waypoints.length, grow);
  const sizes = { waypoint: LABEL_SIZE.waypoint * scale, idea: LABEL_SIZE.idea * scale, contact: LABEL_SIZE.contact * scale, scrubbed: LABEL_SIZE.scrubbed * scale, launch: LABEL_SIZE.launch * scale };
  const chars = (kind: keyof typeof LABEL_CHARS) => Math.round(LABEL_CHARS[kind] / Math.sqrt(scale));
  const rand = seeded(voyage.seed);
  const launch = { x: pad + 8, y: height - pad - 24 };
  const objective = { x: width - pad - objectiveR + 20, y: pad + objectiveR - 16, r: objectiveR };
  const ahead = { x: objective.x - launch.x, y: objective.y - launch.y };
  const total = Math.hypot(ahead.x, ahead.y);
  const dir = { x: ahead.x / total, y: ahead.y / total };
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
  const outs: number[] = [];
  const points: PlottedWaypoint[] = voyage.waypoints.map((waypoint, i) => {
    const before = voyage.waypoints[i - 1];
    const wander = Math.max(-swing, Math.min(swing, drift * 0.5 + (rand() * 2 - 1) * swing * 0.6));
    drift = waypoint.turnedFrom ? (Math.sign(drift) || 1) * swing : before?.turnedFrom ? -Math.sign(drift) * swing * 0.25 : wander;
    const s = step * (i + 1);
    const x = clampX(launch.x + dir.x * s + side.x * drift);
    const y = clampY(launch.y + dir.y * s + side.y * drift);
    // a label would rather sit out on the side its waypoint drifted to (in towards the course at a turn, whose scrubbed
    // heading takes the outside), or alternate while the course runs straight, so neighbours don't run into each other
    const outward = Math.abs(drift) > swing * 0.3 ? Math.sign(drift) : i % 2 ? 1 : -1;
    outs.push(waypoint.turnedFrom ? -outward : outward);
    const state = waypoint.landedAt ? 'landed' : waypoint.slice === voyage.current ? 'now' : 'open';
    const { name, named } = waypointName(waypoint, state === 'now');
    const lines = wrap(name, chars('waypoint'));
    return { x, y, waypoint, name: lines.join(' '), lines, named, state };
  });

  // each correction's old heading: on from the turn, further off course, to a cross
  const turns = points.flatMap((p) => {
    const from = p.waypoint.turnedFrom;
    if (!from) return [];
    const off = Math.sign((p.x - launch.x) * side.x + (p.y - launch.y) * side.y) || 1;
    const veer = 0.75;
    const heading = { x: dir.x * Math.cos(veer) + side.x * off * Math.sin(veer), y: dir.y * Math.cos(veer) + side.y * off * Math.sin(veer) };
    const reach = Math.max(70, step * 0.8);
    const to = { x: clampX(p.x + heading.x * reach), y: clampY(p.y + heading.y * reach) };
    return [{ from: { x: p.x, y: p.y }, to, off, text: clip(from, chars('scrubbed')) }];
  });

  // what's next fans out ahead of the last waypoint, towards the objective but stopping short of it
  const last = points.at(-1) ?? launch;
  const heading = Math.atan2(objective.y - last.y, objective.x - last.x);
  const gap = Math.hypot(objective.x - last.x, objective.y - last.y) - objectiveR;
  const reach = Math.max(80, Math.min(170, gap * 0.7));
  const ideas = voyage.next.slice(0, 3);
  const spread = ideas.length === 1 ? [0] : ideas.length === 2 ? [-0.4, 0.4] : [-0.7, 0, 0.7];
  const projected: Projected[] = ideas.map((idea, i) => {
    const a = heading + spread[i];
    return { to: { x: clampX(last.x + Math.cos(a) * reach), y: clampY(last.y + Math.sin(a) * reach) }, text: clip(idea, chars('idea')) };
  });

  // what labels must never cover (the marks, the objective and the launch caption), and what they'd rather not: lines
  const solid: Box[] = [
    ...points.map((p) => square(p, 14)),
    square(launch, 8),
    labelBox({ x: launch.x - 20, y: launch.y + 30, anchor: 'start' }, 'LAUNCH · SD 00.00.00', sizes.launch),
    { x0: objective.x - objectiveR, y0: objective.y - objectiveR - 18 * scale - 8, x1: objective.x + objectiveR, y1: objective.y + objectiveR },
    ...turns.map((t) => square(t.to, 8)),
    ...projected.map((p) => square(p.to, 7)),
  ];
  const lines: Box[] = [
    ...[launch, ...points].slice(1).flatMap((p, i) => along([launch, ...points][i], p)),
    ...turns.flatMap((t) => along(t.from, t.to)),
    ...projected.flatMap((p) => along(last, p.to)),
  ];
  const inChart = (b: Box) => b.x0 >= 4 && b.x1 <= width - 4 && b.y0 >= 4 && b.y1 <= height - 4;
  // a voyage with contacts weighs a few thousand spots against the lines, which don't change, so they're kept in columns
  const linesHit = hitCounter(lines);
  const cost = (b: Box) => (inChart(b) ? 0 : 1000) + hitsAmong(solid, b) * 100 + linesHit(b);
  // the first of the candidates (in order of preference) that's clear, crossing the fewest lines; none if none is clear
  // a line crossed costs more than any spot further down the list (there are never 100), a mark covered more than any lines
  // (`also` weighs what else a spot gets wrong, as many lines' worth)
  const spot = (candidates: Label[], text: string | string[], size: number, also: (b: Box) => number = () => 0) =>
    cheapest(candidates, (_, i) => i, (label) => {
      const b = labelBox(label, text, size);
      return (cost(b) + also(b)) * 100;
    });
  const CROSSES = 100;
  const COVERS = 10_000;
  const place = (candidates: Label[], text: string | string[], size: number, claim = true): Label | undefined => {
    const best = spot(candidates, text, size);
    if (!best || best.cost >= COVERS) return undefined;
    if (claim) solid.push(labelBox(best.at, text, size));
    return best.at;
  };

  const scrubbed: Scrubbed[] = turns.map((t) => {
    const text = `SCRUBBED ${t.text}`;
    const natural = { x: t.to.x + side.x * 14 * t.off, y: t.to.y + side.y * 14 * t.off + 5, anchor: t.off > 0 ? ('start' as const) : ('end' as const) };
    const label = place([natural, ...around(t.to, 14, sizes.scrubbed)], text, sizes.scrubbed);
    return { from: t.from, to: t.to, text: t.text, ...(label && { label }) };
  });

  const order = points.map((_, i) => i).sort((a, b) => (points[b].state === 'now' ? 1 : 0) - (points[a].state === 'now' ? 1 : 0) || b - a);
  // each waypoint's name on one line, cut shorter where that won't fit anywhere; then, where there's room, in full on
  // two lines, which keeps what it means rather than losing its second half
  const d = 26 + 4 * (scale - 1);
  const spots = (p: PlottedWaypoint, i: number, n: number) => {
    const extra = (n - 1) * sizes.waypoint * LINE_GAP;
    return [beside(p, side, outs[i], d, extra), beside(p, side, -outs[i], d, extra), ...around(p, d, sizes.waypoint, n), ...around(p, d * 1.8, sizes.waypoint, n).map((l) => ({ ...l, leader: true }))];
  };
  const wrapped = points.map((p) => p.lines);
  // a name nearer another waypoint than its own would be read as that one's: as bad as covering a mark, so it's left off
  // (on hover, and named again once zoomed in) rather than misleading
  const others = (i: number) => points.filter((_, j) => j !== i);
  const owned = (i: number) => (b: Box) => (misread(b, points[i], others(i)) ? 100 : 0);
  const claimed = new Map<number, Box>();
  const name = (i: number, lines: string[], label: Label) => {
    const box = labelBox(label, lines, sizes.waypoint);
    solid.push(box);
    claimed.set(i, box);
    Object.assign(points[i], { label, lines, name: lines.join(' ') });
  };
  for (const i of order) {
    const p = points[i];
    const short = Math.round(chars('waypoint') * 0.55);
    const tries = [[clip(p.name, chars('waypoint'))], [clip(p.waypoint.title ?? p.waypoint.heading ?? '', short)]].filter((lines) => lines[0]);
    // the first that's clear of every line, else the first that's clear of everything else
    const weighed = tries.map((lines) => ({ lines, best: spot(spots(p, i, 1), lines, sizes.waypoint, owned(i)) }));
    const pick = weighed.find((t) => t.best && t.best.cost < CROSSES) ?? weighed.find((t) => t.best && t.best.cost < COVERS);
    if (pick?.best) name(i, pick.lines, pick.best.at);
  }
  for (const i of order) {
    const box = claimed.get(i);
    if (!box || wrapped[i].length < 2) continue;
    solid.splice(solid.indexOf(box), 1);
    const best = spot(spots(points[i], i, 2), wrapped[i], sizes.waypoint, owned(i));
    if (best && best.cost < CROSSES) name(i, wrapped[i], best.at);
    else solid.push(box);
  }

  for (const p of projected) {
    const label = place([clearOf(objective, p.to, p.text.length * TEXT_W * scale, width), ...around(p.to, 12, sizes.idea)], p.text, sizes.idea);
    if (label) p.label = label;
  }

  // contacts sit off to the side of the waypoint that noticed them, away from its label where there's room, each placed
  // where it and its label run into the least that's already on the chart: its mark above all, since its label can go
  const at = (slice: number) => points.find((p) => p.waypoint.slice === slice);
  const nearby = new Map<number, number>();
  const contacts: PlottedContact[] = (voyage.contacts ?? []).map((contact) => {
    const wp = at(contact.slice) ?? points.at(-1);
    const by = wp ?? launch;
    const k = nearby.get(contact.slice) ?? 0;
    nearby.set(contact.slice, k + 1);
    const away = wp?.label && wp.label.x < wp.x ? 1 : -1;
    const text = clip(contact.text, chars('contact'));
    const tries = [away, -away].flatMap((out) => [58, 92, 126, 170].flatMap((d) => [0, -0.35, 0.35, -0.7, 0.7].map((t) => {
      const spot = { x: clampX(by.x + side.x * d * out + dir.x * step * (t + (k % 3) * 0.12)), y: clampY(by.y + side.y * d * out + dir.y * step * (t + (k % 3) * 0.12)) };
      const label: Label = out > 0 ? { x: spot.x + 12, y: spot.y + 5, anchor: 'start' } : { x: spot.x - 12, y: spot.y + 5, anchor: 'end' };
      return { spot, label, further: 0 };
    })));
    // failing those, anywhere further round it, nearest first
    for (let r = 60; r <= 300; r += 40) {
      for (let a = 0; a < 12; a++) {
        const spot = { x: clampX(by.x + Math.cos((a * Math.PI) / 6) * r), y: clampY(by.y + Math.sin((a * Math.PI) / 6) * r) };
        tries.push({ spot, label: { x: spot.x + 12, y: spot.y + 5, anchor: 'start' }, further: r / 1000 });
      }
    }
    // its mark matters most, weighed before its label; a try further out costs a touch more, so the nearest wins a tie
    const best = cheapest(tries, (t) => t.further, (t) => cost(square(t.spot, 9)) * 3, (t) => cost(labelBox(t.label, text, sizes.contact)))?.at ?? tries[0];
    solid.push(square(best.spot, 9));
    const label = place([best.label, ...around(best.spot, 12, sizes.contact)], text, sizes.contact);
    const closed = contact.closed;
    const pursued = closed?.as === 'pursued' ? at(closed.slice) : undefined;
    return { ...best.spot, contact, state: closed?.as ?? 'open', ...(label && { label }), text, ...(pursued && { pursuedAt: { x: pursued.x, y: pursued.y } }) };
  });

  return { width, height, launch, objective, points, path: smoothPath([launch, ...points]), scrubbed, projected, contacts, sizes };
}

/** Where a waypoint's name came from: what it shipped as, the lead's heading for it, what the lead's at in it, or nothing yet. */
export type Named = 'shipped' | 'heading' | 'work' | 'unset';

/**
 * A waypoint's name: the title it shipped under, or before it ships, the heading the lead gave it, else what the lead's
 * at in it (the task it's doing now, else its last commit), else just its number (and, under way, that it's under way).
 */
export function waypointName(w: Waypoint, underWay = false): { name: string; named: Named } {
  if (w.title) return { name: w.title, named: 'shipped' };
  if (w.heading) return { name: w.heading, named: 'heading' };
  const work = w.tasks?.find((t) => t.status === 'in_progress')?.subject ?? w.lastCommit;
  if (work) return { name: work, named: 'work' };
  return { name: underWay ? `Slice ${w.slice} · under way` : `Slice ${w.slice}`, named: 'unset' };
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

/**
 * How a slice's guardrails stood: down while QA or CI is failing one of its pull requests, absorbed once each passes
 * but one had failed first (a hit the shields took), held when everything passed first time; none before QA's looked.
 */
export function shieldState(shields: readonly Shield[] | undefined): 'none' | 'held' | 'absorbed' | 'down' {
  if (!shields?.length) return 'none';
  if (shields.some((s) => s.verdict === 'fail' || s.ci === 'failing')) return 'down';
  return shields.some((s) => s.failedRounds > 0) ? 'absorbed' : 'held';
}

/** How long a probe takes to transmit what it found back to its waypoint, once it reports, before it's gone. */
export const TRANSMIT_MS = 6000;
/** How far out a probe ends up, and how long it takes to get most of the way there: a script, run in seconds, hops. */
const PROBE_REACH = { helper: 190, script: 110 };
const PROBE_PACE = { helper: 20_000, script: 3_000 };

/**
 * The probes a lead has out: its helpers still working, and the scripts it's running, while it's at work (one left
 * without a result when the session stopped never reports).
 */
export function probesOut(lead: Pick<Agent, 'status' | 'helpers' | 'lead'> | undefined): Set<string> {
  const out = new Set((lead?.helpers ?? []).filter((x) => x.status === 'working').map((x) => x.id));
  if (lead && (lead.status === 'working' || lead.status === 'testing')) {
    for (const w of lead.lead?.waypoints ?? []) for (const p of w.probes ?? []) if (p.type === 'script' && !p.endedAt) out.add(p.id);
  }
  return out;
}

/** A probe in flight on the chart: out from its waypoint, or transmitting home (`sent` of the way through) before it's gone. */
export interface ProbeFlight extends Pt {
  probe: Probe;
  slice: number;
  from: Pt;
  /** Which way it's heading, in radians. */
  angle: number;
  phase: 'out' | 'transmitting';
  sent: number;
  label: Label;
}

/**
 * Where each of the voyage's probes is at `now`: one still out (`out` says which helpers are still working) drifts on
 * away from the waypoint that launched it, slowing as it goes, off to one side of the way ahead; one that has
 * reported sits where it was, transmitting, for `TRANSMIT_MS`; after that, or if it never reported, it's not drawn.
 */
export function probeFlights(plot: CoursePlot, waypoints: Waypoint[], out: ReadonlySet<string>, now: number, scale = 1): ProbeFlight[] {
  const { pad } = CHART;
  const { width, height } = plot;
  // each label is two lines (what it was sent to find, and what it's doing), moved up or down off any before it
  const size = LABEL_SIZE.contact * scale;
  const taken: Box[] = [];
  const twoLines = (l: Label): Box => {
    const b = labelBox(l, 'PROBE · '.padEnd(48, 'x'), size * 0.95);
    return { ...b, y1: b.y1 + size };
  };
  const clear = (l: Label): Label => {
    const tries = [0, 1, -1, 2, -2].map((n) => ({ ...l, y: l.y + n * size * 2.2 }));
    const found = tries.find((t) => !taken.some((b) => overlaps(b, twoLines(t)))) ?? l;
    taken.push(twoLines(found));
    return found;
  };
  return waypoints.flatMap((w) => {
    const from = plot.points.find((p) => p.waypoint.slice === w.slice);
    if (!from) return [];
    return (w.probes ?? []).flatMap((probe, k) => {
      const phase = probe.endedAt ? 'transmitting' : 'out';
      if (phase === 'out' ? !out.has(probe.id) : now - probe.endedAt! > TRANSMIT_MS) return [];
      // a waypoint's probes fan out either side of the way ahead, each a little wider than the pair before, so ones
      // launched together part company
      const ahead = Math.atan2(plot.objective.y - from.y, plot.objective.x - from.x);
      const angle = ahead + (k % 2 ? 1 : -1) * (0.6 + 0.4 * Math.floor(k / 2)) + (seeded(probe.id)() - 0.5) * 0.15;
      const kind = probe.type === 'script' ? 'script' : 'helper';
      const flown = Math.max(0, (probe.endedAt ?? now) - probe.launchedAt);
      const d = 40 + (PROBE_REACH[kind] - 40) * (1 - Math.exp(-flown / PROBE_PACE[kind]));
      const x = Math.max(pad / 2, Math.min(width - pad / 2, from.x + Math.cos(angle) * d));
      const y = Math.max(pad / 2, Math.min(height - pad / 2, from.y + Math.sin(angle) * d));
      const sent = phase === 'out' ? 0 : Math.min(1, (now - probe.endedAt!) / TRANSMIT_MS);
      const label = clear(x < width - 260 * scale ? { x: x + 16, y: y - 8, anchor: 'start' } : { x: x - 16, y: y - 8, anchor: 'end' });
      return [{ x, y, probe, slice: w.slice, from: { x: from.x, y: from.y }, angle, phase, sent, label }];
    });
  });
}

