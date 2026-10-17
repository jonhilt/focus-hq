// A system model drawn flat, the one fixed way (docs/studio.md), as three coordinated views of the same model: its
// structure (the parts and their connections), the scenario as a sequence diagram, and the data that moves at each step.
// A drawing is a list of shapes, not pixels, so the same drawing goes to SVG (the live panel up close) and to a canvas
// (the holodeck's boards, and their contact sheet), and can be tested here. Each view shows the step under way and the
// part picked, so picking a part or a step in one lights it up in the others.

import { keysOf } from './records';
import { edgeFor, layoutLayers } from './systemModel';
import type { ModelChange, ModelEdge, ModelEdgeKind, ModelKind, ModelNode, SystemModel } from './types';

/** What any shape can carry for a page that steps and picks by CSS alone: the scenario's steps it belongs to, and a class. */
type Marks = { steps?: number[]; cls?: string };

export type Shape = Marks &
  (
    | { t: 'rect'; x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: string; sw?: number; dash?: boolean; part?: string }
    | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: string; sw?: number; dash?: boolean; part?: string }
    | { t: 'poly'; pts: number[]; fill?: string; stroke?: string; sw?: number; dash?: boolean; part?: string }
    | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; dash?: boolean; arrow?: boolean }
    | { t: 'text'; x: number; y: number; text: string; size: number; fill: string; bold?: boolean; mono?: boolean; anchor?: 'start' | 'middle' | 'end'; part?: string }
  );

export interface Drawing {
  w: number;
  h: number;
  shapes: Shape[];
}

/** Where the viewer is in the model: the scenario's step under way (from 0; none before it starts), and the part picked. */
export interface ModelFocus {
  step?: number;
  picked?: string;
  /**
   * For a page that steps by CSS (server/agents/modelPage.ts): each shape the scenario lights is marked with its steps,
   * and the rows' highlights are always drawn, empty until a step's on.
   */
  marks?: boolean;
}

export const INK = { bg: '#050b18', panel: '#0d1430', text: '#e8fbff', muted: '#8fa3b8', gold: '#ffcc66', red: '#ff5c5c', line: '#2a3555', added: '#99cc66', changed: '#ff9900' } as const;
/** How a change's marks read: a tag over the part, in a colour of its own. */
export const CHANGE_TAGS: Record<ModelChange, { text: string; colour: string }> = { added: { text: 'NEW', colour: INK.added }, changed: { text: 'CHANGED', colour: INK.changed }, removed: { text: 'REMOVED', colour: INK.muted } };

/** The steps of the scenario that move along connection `e`. */
export function stepsAlong(m: SystemModel, e: ModelEdge): number[] {
  return m.trace.flatMap((s, i) => (edgeFor(m.edges, s.from, s.to) === e ? [i] : []));
}
/** Layers take these colours, in the order they first appear. */
const LAYER_COLOURS = ['#99ccff', '#ff9966', '#cc99cc', '#99cc66', '#ffcc66', '#9999ff', '#ff9900', '#e8fbff'];
/** What each kind of connection is drawn in. */
export const EDGE_COLOURS: Record<ModelEdgeKind, string> = { calls: '#99ccff', reads: '#99cc66', writes: '#ff9900', emits: '#cc99cc', renders: '#9999ff' };
/** What each kind of part is drawn as, for the legend. */
export const KIND_SHAPES: Record<ModelKind, string> = { ui: 'window', route: 'hexagon', handler: 'square', service: 'rounded box', store: 'cylinder', queue: 'pill', external: 'ellipse', job: 'triangle', type: 'diamond' };

/** Each layer's colour, by the order the model's parts bring them in. */
export function layerColours(m: SystemModel): Map<string, string> {
  const layers = [...new Set(m.nodes.map((n) => n.layer))];
  return new Map(layers.map((l, i) => [l, LAYER_COLOURS[i % LAYER_COLOURS.length]]));
}

const file = (path: string) => path.split(/[\\/]/).pop() ?? path;
const citeText = (n: ModelNode) => (n.cite ? `${file(n.cite.file)}:${n.cite.line}` : 'no cite');
/** A rough width for `text` at `size`, for laying things out without a font to measure with. */
const width = (text: string, size: number) => text.length * size * 0.56;

/** `text` cut to fit `max` px at `size`, with an ellipsis. */
export function fit(text: string, size: number, max: number): string {
  if (width(text, size) <= max) return text;
  const keep = Math.max(1, Math.floor(max / (size * 0.56)) - 1);
  return `${text.slice(0, keep)}…`;
}

// ------------------------------------------------------------------ structure

const BOX = { w: 270, h: 96 };
/** The structure view's frame: at least `w` × `h`, growing a column (`cellW`) or a row (`cellH`) at a time as the model needs. */
const STRUCT = { w: 1600, h: 1000, legend: 150, strip: 70, pad: 50, cellW: 330, cellH: 150 };

/** How big a structure view of `m` is: wide and tall enough for its layers' columns and rows, never squeezed. */
export function structureSize(m: SystemModel): { w: number; h: number } {
  const { cols, rows } = layoutLayers(m);
  return {
    w: Math.max(STRUCT.w, STRUCT.pad * 2 + cols * STRUCT.cellW),
    h: Math.max(STRUCT.h, STRUCT.pad * 2 + rows * STRUCT.cellH + STRUCT.strip + STRUCT.legend),
  };
}

/** The parts as shapes for their kinds, coloured by layer, and their connections as arrows, the step under way gold. */
export function structureView(m: SystemModel, focus: ModelFocus = {}): Drawing {
  const shapes: Shape[] = [];
  const colours = layerColours(m);
  const { w: W, h: H } = structureSize(m);
  const centres = structurePositions(m);
  const step = focus.step !== undefined ? m.trace[focus.step] : undefined;
  const active = step && edgeFor(m.edges, step.from, step.to);
  const touches = (id: string) => focus.picked === id;

  for (const e of m.edges) {
    const a = centres.get(e.from);
    const b = centres.get(e.to);
    if (!a || !b) continue;
    const [x1, y1] = clipToBox(a, b);
    const [x2, y2] = clipToBox(b, a);
    const on = e === active;
    const lit = touches(e.from) || touches(e.to);
    const gone = e.change === 'removed';
    const colour = on ? INK.gold : gone ? INK.muted : e.backed === false ? INK.red : EDGE_COLOURS[e.kind];
    const steps = focus.marks ? stepsAlong(m, e) : undefined;
    shapes.push({ t: 'line', x1, y1, x2, y2, stroke: colour, sw: on ? 7 : lit ? 5 : 3, dash: e.backed === false || gone, arrow: true, steps, cls: steps && 'edge' });
    // its label only where the line's long enough to carry it, a change's mark before it
    const room = Math.hypot(x2 - x1, y2 - y1) - 30;
    const label = `${e.change ? `${CHANGE_TAGS[e.change].text} · ` : ''}${e.label ?? e.kind}`;
    const labelColour = on ? INK.gold : e.change ? CHANGE_TAGS[e.change].colour : INK.muted;
    if (room > width(label, 18) || room > 120) shapes.push({ t: 'text', x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 10, text: fit(label, 18, room), size: 18, fill: labelColour, anchor: 'middle', steps });
  }
  for (const n of m.nodes) {
    const c = centres.get(n.id);
    if (!c) continue;
    const inStep = !!step && (step.from === n.id || step.to === n.id);
    const gone = n.change === 'removed';
    const stroke = touches(n.id) ? INK.text : inStep ? INK.gold : gone ? INK.muted : n.found === false ? INK.red : (colours.get(n.layer) ?? INK.muted);
    shapes.push(...partShape(n.kind, c.x, c.y, { fill: INK.panel, stroke, sw: touches(n.id) || inStep ? 6 : 3, dash: n.found === false || gone, part: n.id }));
    if (n.change) shapes.push(...changeTag(n.change, c.x, c.y - BOX.h / 2 - 16));
    shapes.push({ t: 'text', x: c.x, y: c.y - 2, text: fit(n.label, 22, BOX.w - 20), size: 22, fill: colours.get(n.layer) ?? INK.text, bold: true, anchor: 'middle', part: n.id });
    shapes.push({ t: 'text', x: c.x, y: c.y + 26, text: fit(citeText(n), 17, BOX.w - 20), size: 17, fill: n.found === false ? INK.red : INK.muted, mono: true, anchor: 'middle', part: n.id });
  }
  // the token, halfway along the step's connection, and the step in words over the legend, its payload with it
  if (step && focus.step !== undefined && !focus.marks) {
    const a = centres.get(step.from);
    const b = centres.get(step.to);
    if (a && b) shapes.push({ t: 'ellipse', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: 13, ry: 13, fill: INK.gold });
    const y = H - STRUCT.legend - STRUCT.strip / 2 + 8;
    const head = `STEP ${focus.step + 1} OF ${m.trace.length} · ${step.label}`;
    shapes.push({ t: 'text', x: 40, y, text: fit(head, 26, 760), size: 26, fill: INK.gold, bold: true });
    if (step.payload) shapes.push({ t: 'text', x: W - 40, y, text: fit(step.payload, 21, 760), size: 21, fill: INK.gold, mono: true, anchor: 'end' });
  }
  shapes.push(...legend(m, colours, H - STRUCT.legend, W));
  return { w: W, h: H, shapes: [{ t: 'rect', x: 0, y: 0, w: W, h: H, fill: INK.bg }, ...shapes] };
}

/**
 * Each part's middle on the structure view: its layer's column and its row in it (layoutLayers), the columns spread
 * evenly across and each column's parts centred down the space above the step strip, so no two parts ever share a place.
 */
export function structurePositions(m: SystemModel): Map<string, { x: number; y: number }> {
  const { at, cols } = layoutLayers(m);
  const { w, h } = structureSize(m);
  const counts = new Map<number, number>();
  for (const s of at.values()) counts.set(s.col, (counts.get(s.col) ?? 0) + 1);
  const cellW = (w - STRUCT.pad * 2) / cols;
  const top = STRUCT.pad;
  const bottom = h - STRUCT.legend - STRUCT.strip - STRUCT.pad;
  return new Map([...at].map(([id, s]) => {
    const n = counts.get(s.col) ?? 1;
    const cellH = (bottom - top) / n;
    return [id, { x: STRUCT.pad + cellW * (s.col + 0.5), y: top + cellH * (s.row + 0.5) }];
  }));
}

/** A change's tag, a capsule centred on (x, y). */
function changeTag(change: ModelChange, x: number, y: number): Shape[] {
  const { text, colour } = CHANGE_TAGS[change];
  const w = width(text, 16) + 24;
  return [{ t: 'rect', x: x - w / 2, y: y - 14, w, h: 26, r: 13, fill: colour }, { t: 'text', x, y: y + 5, text, size: 16, fill: INK.bg, bold: true, anchor: 'middle' }];
}

/** Where the line from `a` towards `b` leaves `a`'s box. */
function clipToBox(a: { x: number; y: number }, b: { x: number; y: number }): [number, number] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k = Math.min(Math.abs(dx) > 1e-6 ? BOX.w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? BOX.h / 2 / Math.abs(dy) : Infinity, 1);
  return [a.x + dx * k * 1.04, a.y + dy * k * 1.04];
}

type Paint = { fill?: string; stroke?: string; sw?: number; dash?: boolean; part?: string };

/** A part's outline for its kind, round (x, y), about a box in size. */
export function partShape(kind: ModelKind, x: number, y: number, p: Paint, w = BOX.w, h = BOX.h): Shape[] {
  const [l, r, t, b] = [x - w / 2, x + w / 2, y - h / 2, y + h / 2];
  switch (kind) {
    case 'ui':
      return [{ t: 'rect', x: l, y: t, w, h, r: 6, ...p }, { t: 'line', x1: l, y1: t + 16, x2: r, y2: t + 16, stroke: p.stroke ?? INK.muted, sw: 2 }];
    case 'route':
      return [{ t: 'poly', pts: [l + 22, t, r - 22, t, r, y, r - 22, b, l + 22, b, l, y], ...p }];
    case 'handler':
      return [{ t: 'rect', x: l, y: t, w, h, r: 2, ...p }];
    case 'service':
      return [{ t: 'rect', x: l, y: t, w, h, r: 22, ...p }];
    case 'store':
      return [{ t: 'rect', x: l, y: t + 10, w, h: h - 10, r: 4, ...p }, { t: 'ellipse', cx: x, cy: t + 10, rx: w / 2, ry: 12, ...p }];
    case 'queue':
      return [{ t: 'rect', x: l, y: t, w, h, r: h / 2, ...p }];
    case 'external':
      return [{ t: 'ellipse', cx: x, cy: y, rx: w / 2, ry: h / 2, ...p }];
    case 'job':
      return [{ t: 'poly', pts: [l, b, x, t - 14, r, b], ...p }];
    case 'type':
      return [{ t: 'poly', pts: [x, t - 12, r, y, x, b + 12, l, y], ...p }];
  }
}

/** The key along a view's foot: shapes for the kinds there are, the layers' colours, the connections' colours, red. */
function legend(m: SystemModel, colours: Map<string, string>, top: number, w: number): Shape[] {
  const out: Shape[] = [{ t: 'rect', x: 0, y: top, w, h: STRUCT.legend, fill: '#0a1124' }];
  let x = 40;
  const row = (y: number, items: [string, string][]) => {
    x = 40;
    for (const [text, colour] of items) {
      out.push({ t: 'ellipse', cx: x + 9, cy: y - 7, rx: 9, ry: 9, fill: colour });
      out.push({ t: 'text', x: x + 26, y, text, size: 20, fill: INK.text });
      x += 46 + width(text, 20);
    }
  };
  const kinds = keysOf(KIND_SHAPES).filter((k) => m.nodes.some((n) => n.kind === k));
  out.push({ t: 'text', x: 40, y: top + 34, text: `SHAPE = KIND: ${kinds.map((k) => `${k} ${KIND_SHAPES[k]}`).join(' · ')}`, size: 19, fill: INK.muted });
  row(top + 76, [...colours].map(([l, c]) => [l, c]));
  const kindsUsed = keysOf(EDGE_COLOURS).filter((k) => m.edges.some((e) => e.kind === k));
  const changes = keysOf(CHANGE_TAGS).filter((c) => m.nodes.some((n) => n.change === c) || m.edges.some((e) => e.change === c));
  row(top + 118, [...kindsUsed.map((k): [string, string] => [k, EDGE_COLOURS[k]]), ['the step under way', INK.gold], ['not found in the code', INK.red], ...changes.map((c): [string, string] => [`${CHANGE_TAGS[c].text.toLowerCase()} in this change`, CHANGE_TAGS[c].colour])]);
  return out;
}

// ------------------------------------------------------------------ sequence

/** The sequence view: at least `w` wide, each lifeline at least `lane` apart, so names don't shrink to nothing. */
const SEQ = { w: 1600, lane: 190, head: 150, row: 92, pad: 40, foot: 40 };

/** The parts the scenario passes through, in the order it first reaches them. */
export function participants(m: SystemModel): string[] {
  const seen: string[] = [];
  for (const s of m.trace) for (const id of [s.from, s.to]) if (!seen.includes(id)) seen.push(id);
  return seen;
}

/** The scenario as a sequence diagram: a lifeline for each part it passes through, an arrow for each step, its payload over it. */
export function sequenceView(m: SystemModel, focus: ModelFocus = {}): Drawing {
  const who = participants(m);
  const colours = layerColours(m);
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  const h = SEQ.head + Math.max(1, m.trace.length) * SEQ.row + SEQ.foot;
  const W = Math.max(SEQ.w, SEQ.pad * 2 + who.length * SEQ.lane);
  const gap = (W - SEQ.pad * 2) / Math.max(1, who.length);
  const xOf = (id: string) => SEQ.pad + gap * (who.indexOf(id) + 0.5);
  const shapes: Shape[] = [{ t: 'rect', x: 0, y: 0, w: W, h, fill: INK.bg }];
  for (const id of who) {
    const n = byId.get(id);
    const x = xOf(id);
    const picked = focus.picked === id;
    shapes.push({ t: 'line', x1: x, y1: SEQ.head - 20, x2: x, y2: h - SEQ.foot, stroke: picked ? INK.text : INK.line, sw: picked ? 4 : 2, dash: true });
    shapes.push({ t: 'rect', x: x - gap / 2 + 10, y: 24, w: gap - 20, h: 90, r: 10, fill: INK.panel, stroke: picked ? INK.text : (colours.get(n?.layer ?? '') ?? INK.muted), sw: picked ? 5 : 3, part: id });
    shapes.push({ t: 'text', x, y: 66, text: fit(n?.label ?? id, 22, gap - 36), size: 22, fill: colours.get(n?.layer ?? '') ?? INK.text, bold: true, anchor: 'middle', part: id });
    shapes.push({ t: 'text', x, y: 96, text: n ? fit(citeText(n), 16, gap - 36) : '', size: 16, fill: n?.found === false ? INK.red : INK.muted, mono: true, anchor: 'middle', part: id });
  }
  m.trace.forEach((s, i) => {
    const y = SEQ.head + i * SEQ.row + 56;
    const on = focus.step === i;
    const x1 = xOf(s.from);
    const x2 = xOf(s.to);
    const steps = focus.marks ? [i] : undefined;
    if (on || focus.marks) shapes.push({ t: 'rect', x: 8, y: y - 52, w: W - 16, h: SEQ.row - 6, r: 8, fill: on ? '#2a2410' : 'none', steps, cls: steps && 'row' });
    shapes.push({ t: 'text', x: 20, y: y - 18, text: String(i + 1), size: 22, fill: on ? INK.gold : INK.muted, bold: true, steps });
    shapes.push({ t: 'line', x1, y1: y, x2, y2: y, stroke: on ? INK.gold : edgeFor(m.edges, s.from, s.to)?.backed === false ? INK.red : INK.text, sw: on ? 5 : 3, arrow: true, steps, cls: steps && 'edge' });
    const mid = (x1 + x2) / 2;
    const room = Math.max(560, Math.abs(x2 - x1) - 20);
    shapes.push({ t: 'text', x: mid, y: y - 30, text: fit(s.label, 21, room), size: 21, fill: on ? INK.gold : INK.text, anchor: 'middle', steps });
    if (s.payload) shapes.push({ t: 'text', x: mid, y: y - 8, text: fit(s.payload, 17, room), size: 17, fill: on ? INK.gold : INK.muted, mono: true, anchor: 'middle', steps });
  });
  return { w: W, h, shapes };
}

// ------------------------------------------------------------------ data

const DATA = { w: 1100, row: 64, head: 110 };

/** The data at each step (what moves, from where to where), and the model's caveats: what's simplified, what to check. */
export function dataView(m: SystemModel, focus: ModelFocus = {}): Drawing {
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.label ?? id;
  const shapes: Shape[] = [];
  shapes.push({ t: 'text', x: 40, y: 58, text: fit(m.question, 30, DATA.w - 80), size: 30, fill: INK.text, bold: true });
  shapes.push({ t: 'text', x: 40, y: 96, text: 'WHAT MOVES AT EACH STEP', size: 20, fill: INK.gold, bold: true });
  let y = DATA.head + 20;
  m.trace.forEach((s, i) => {
    const on = focus.step === i;
    const steps = focus.marks ? [i] : undefined;
    if (on || focus.marks) shapes.push({ t: 'rect', x: 20, y: y - 38, w: DATA.w - 40, h: DATA.row - 4, r: 8, fill: on ? '#2a2410' : 'none', steps, cls: steps && 'row' });
    shapes.push({ t: 'text', x: 40, y: y - 10, text: `${i + 1}`, size: 20, fill: on ? INK.gold : INK.muted, bold: true, steps });
    shapes.push({ t: 'text', x: 80, y: y - 12, text: fit(`${name(s.from)} → ${name(s.to)}`, 18, 420), size: 18, fill: on ? INK.gold : INK.muted, steps });
    shapes.push({ t: 'text', x: 520, y: y - 12, text: fit(s.payload ?? '—', 19, DATA.w - 560), size: 19, fill: on ? INK.gold : INK.text, mono: true, steps });
    shapes.push({ t: 'text', x: 80, y: y + 12, text: fit(s.label, 17, DATA.w - 120), size: 17, fill: INK.muted });
    y += DATA.row;
  });
  const notes: [string, string[]][] = [['SIMPLIFIED', m.simplified], ['CHECK YOURSELF', (m.checks ?? []).map((c) => c.q)]];
  for (const [title, list] of notes) {
    if (!list.length) continue;
    y += 24;
    shapes.push({ t: 'text', x: 40, y, text: title, size: 20, fill: INK.gold, bold: true });
    for (const item of list) {
      y += 32;
      shapes.push({ t: 'text', x: 40, y, text: fit(`· ${item}`, 19, DATA.w - 80), size: 19, fill: INK.text });
    }
  }
  const h = y + 40;
  return { w: DATA.w, h, shapes: [{ t: 'rect', x: 0, y: 0, w: DATA.w, h, fill: INK.bg }, ...shapes] };
}

// ------------------------------------------------------------------ SVG

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A drawing as an SVG document, each part's shapes marked with data-part so a click can pick it. */
export function toSvg(d: Drawing): string {
  const body = d.shapes.map(svgShape).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.w} ${d.h}" font-family="Antonio, 'Arial Narrow', sans-serif"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>${body}</svg>`;
}

function svgShape(s: Shape): string {
  const part = ('part' in s && s.part ? ` data-part="${esc(s.part)}" style="cursor:pointer"` : '') + (s.steps?.length ? ` data-steps=" ${s.steps.join(' ')} "` : '') + (s.cls ? ` class="${esc(s.cls)}"` : '');
  const paint = (p: { fill?: string; stroke?: string; sw?: number; dash?: boolean }) =>
    ` fill="${p.fill ?? 'none'}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.sw ?? 2}"` : ''}${p.dash ? ' stroke-dasharray="10 7"' : ''}`;
  switch (s.t) {
    case 'rect':
      return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r ?? 0}"${paint(s)}${part}/>`;
    case 'ellipse':
      return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}"${paint(s)}${part}/>`;
    case 'poly':
      return `<polygon points="${s.pts.join(' ')}"${paint(s)}${part}/>`;
    case 'line':
      return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${s.stroke}" stroke-width="${s.sw}"${s.dash ? ' stroke-dasharray="10 7"' : ''}${s.arrow ? ' marker-end="url(#arrow)"' : ''}${part}/>`;
    case 'text':
      return `<text x="${s.x}" y="${s.y}" font-size="${s.size}" fill="${s.fill}"${s.bold ? ' font-weight="600"' : ''}${s.mono ? ' font-family="JetBrains Mono, monospace"' : ''} text-anchor="${s.anchor ?? 'start'}"${part}>${esc(s.text)}</text>`;
  }
}
