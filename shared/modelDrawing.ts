// A system model drawn flat, the one fixed way (docs/studio.md), as three coordinated views of the same model: its
// structure (the parts and their connections), the scenario as a sequence diagram, and the data that moves at each step.
// A drawing is a list of shapes, not pixels, so the same drawing goes to SVG (the live panel up close) and to a canvas
// (the holodeck's boards, and their contact sheet), and can be tested here. Each view shows the step under way and the
// part picked, so picking a part or a step in one lights it up in the others.

import { edgeFor, layoutModel } from './systemModel';
import type { ModelEdgeKind, ModelKind, ModelNode, SystemModel } from './types';

export type Shape =
  | { t: 'rect'; x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: string; sw?: number; dash?: boolean; part?: string }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: string; sw?: number; dash?: boolean; part?: string }
  | { t: 'poly'; pts: number[]; fill?: string; stroke?: string; sw?: number; dash?: boolean; part?: string }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; dash?: boolean; arrow?: boolean }
  | { t: 'text'; x: number; y: number; text: string; size: number; fill: string; bold?: boolean; mono?: boolean; anchor?: 'start' | 'middle' | 'end'; part?: string };

export interface Drawing {
  w: number;
  h: number;
  shapes: Shape[];
}

/** Where the viewer is in the model: the scenario's step under way (from 0; none before it starts), and the part picked. */
export interface ModelFocus {
  step?: number;
  picked?: string;
}

export const INK = { bg: '#050b18', panel: '#0d1430', text: '#e8fbff', muted: '#8fa3b8', gold: '#ffcc66', red: '#ff5c5c', line: '#2a3555' } as const;
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
const STRUCT = { w: 1600, h: 1000, legend: 150, strip: 70, pad: 50 };

/** The parts as shapes for their kinds, coloured by layer, and their connections as arrows, the step under way gold. */
export function structureView(m: SystemModel, focus: ModelFocus = {}): Drawing {
  const shapes: Shape[] = [];
  const colours = layerColours(m);
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
    const colour = on ? INK.gold : e.backed === false ? INK.red : EDGE_COLOURS[e.kind];
    shapes.push({ t: 'line', x1, y1, x2, y2, stroke: colour, sw: on ? 7 : lit ? 5 : 3, dash: e.backed === false, arrow: true });
    // its label only where the line's long enough to carry it
    const room = Math.hypot(x2 - x1, y2 - y1) - 30;
    const label = e.label ?? e.kind;
    if (room > width(label, 18) || room > 120) shapes.push({ t: 'text', x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 10, text: fit(label, 18, room), size: 18, fill: on ? INK.gold : INK.muted, anchor: 'middle' });
  }
  for (const n of m.nodes) {
    const c = centres.get(n.id);
    if (!c) continue;
    const inStep = !!step && (step.from === n.id || step.to === n.id);
    const stroke = touches(n.id) ? INK.text : inStep ? INK.gold : n.found === false ? INK.red : (colours.get(n.layer) ?? INK.muted);
    shapes.push(...partShape(n.kind, c.x, c.y, { fill: INK.panel, stroke, sw: touches(n.id) || inStep ? 6 : 3, dash: n.found === false, part: n.id }));
    shapes.push({ t: 'text', x: c.x, y: c.y - 2, text: fit(n.label, 22, BOX.w - 20), size: 22, fill: colours.get(n.layer) ?? INK.text, bold: true, anchor: 'middle', part: n.id });
    shapes.push({ t: 'text', x: c.x, y: c.y + 26, text: fit(citeText(n), 17, BOX.w - 20), size: 17, fill: n.found === false ? INK.red : INK.muted, mono: true, anchor: 'middle', part: n.id });
  }
  // the token, halfway along the step's connection, and the step in words over the legend, its payload with it
  if (step && focus.step !== undefined) {
    const a = centres.get(step.from);
    const b = centres.get(step.to);
    if (a && b) shapes.push({ t: 'ellipse', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: 13, ry: 13, fill: INK.gold });
    const y = STRUCT.h - STRUCT.legend - STRUCT.strip / 2 + 8;
    const head = `STEP ${focus.step + 1} OF ${m.trace.length} · ${step.label}`;
    shapes.push({ t: 'text', x: 40, y, text: fit(head, 26, 760), size: 26, fill: INK.gold, bold: true });
    if (step.payload) shapes.push({ t: 'text', x: STRUCT.w - 40, y, text: fit(step.payload, 21, 760), size: 21, fill: INK.gold, mono: true, anchor: 'end' });
  }
  shapes.push(...legend(m, colours, STRUCT.h - STRUCT.legend, STRUCT.w));
  return { w: STRUCT.w, h: STRUCT.h, shapes: [{ t: 'rect', x: 0, y: 0, w: STRUCT.w, h: STRUCT.h, fill: INK.bg }, ...shapes] };
}

/** Each part's middle on the structure view: layoutModel's columns and stacks, flattened (its depth folded across). */
export function structurePositions(m: SystemModel): Map<string, { x: number; y: number }> {
  const at = layoutModel(m, 100);
  const xs = [...at.values()].map((p) => p.x + p.z * 0.35);
  const ys = [...at.values()].map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const left = STRUCT.pad + BOX.w / 2;
  const right = STRUCT.w - STRUCT.pad - BOX.w / 2;
  const top = STRUCT.pad + BOX.h / 2;
  const bottom = STRUCT.h - STRUCT.legend - STRUCT.strip - STRUCT.pad - BOX.h / 2;
  const span = (v: number, lo: number, hi: number, from: number, to: number) => (hi - lo < 1e-6 ? (from + to) / 2 : from + ((v - lo) / (hi - lo)) * (to - from));
  return new Map([...at].map(([id, p]) => [id, { x: span(p.x + p.z * 0.35, minX, maxX, left, right), y: span(p.y, minY, maxY, bottom, top) }]));
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
  const kinds = (Object.keys(KIND_SHAPES) as ModelKind[]).filter((k) => m.nodes.some((n) => n.kind === k));
  out.push({ t: 'text', x: 40, y: top + 34, text: `SHAPE = KIND: ${kinds.map((k) => `${k} ${KIND_SHAPES[k]}`).join(' · ')}`, size: 19, fill: INK.muted });
  row(top + 76, [...colours].map(([l, c]) => [l, c]));
  const kindsUsed = (Object.keys(EDGE_COLOURS) as ModelEdgeKind[]).filter((k) => m.edges.some((e) => e.kind === k));
  row(top + 118, [...kindsUsed.map((k): [string, string] => [k, EDGE_COLOURS[k]]), ['the step under way', INK.gold], ['not found in the code', INK.red]]);
  return out;
}

// ------------------------------------------------------------------ sequence

const SEQ = { w: 1600, head: 150, row: 92, pad: 40, foot: 40 };

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
  const gap = (SEQ.w - SEQ.pad * 2) / Math.max(1, who.length);
  const xOf = (id: string) => SEQ.pad + gap * (who.indexOf(id) + 0.5);
  const shapes: Shape[] = [{ t: 'rect', x: 0, y: 0, w: SEQ.w, h, fill: INK.bg }];
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
    if (on) shapes.push({ t: 'rect', x: 8, y: y - 52, w: SEQ.w - 16, h: SEQ.row - 6, r: 8, fill: '#2a2410' });
    shapes.push({ t: 'text', x: 20, y: y - 18, text: String(i + 1), size: 22, fill: on ? INK.gold : INK.muted, bold: true });
    shapes.push({ t: 'line', x1, y1: y, x2, y2: y, stroke: on ? INK.gold : edgeFor(m.edges, s.from, s.to)?.backed === false ? INK.red : INK.text, sw: on ? 5 : 3, arrow: true });
    const mid = (x1 + x2) / 2;
    const room = Math.max(560, Math.abs(x2 - x1) - 20);
    shapes.push({ t: 'text', x: mid, y: y - 30, text: fit(s.label, 21, room), size: 21, fill: on ? INK.gold : INK.text, anchor: 'middle' });
    if (s.payload) shapes.push({ t: 'text', x: mid, y: y - 8, text: fit(s.payload, 17, room), size: 17, fill: on ? INK.gold : INK.muted, mono: true, anchor: 'middle' });
  });
  return { w: SEQ.w, h, shapes };
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
    if (on) shapes.push({ t: 'rect', x: 20, y: y - 38, w: DATA.w - 40, h: DATA.row - 4, r: 8, fill: '#2a2410' });
    shapes.push({ t: 'text', x: 40, y: y - 10, text: `${i + 1}`, size: 20, fill: on ? INK.gold : INK.muted, bold: true });
    shapes.push({ t: 'text', x: 80, y: y - 12, text: fit(`${name(s.from)} → ${name(s.to)}`, 18, 420), size: 18, fill: on ? INK.gold : INK.muted });
    shapes.push({ t: 'text', x: 520, y: y - 12, text: fit(s.payload ?? '—', 19, DATA.w - 560), size: 19, fill: on ? INK.gold : INK.text, mono: true });
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
  const part = 'part' in s && s.part ? ` data-part="${esc(s.part)}" style="cursor:pointer"` : '';
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
      return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${s.stroke}" stroke-width="${s.sw}"${s.dash ? ' stroke-dasharray="10 7"' : ''}${s.arrow ? ' marker-end="url(#arrow)"' : ''}/>`;
    case 'text':
      return `<text x="${s.x}" y="${s.y}" font-size="${s.size}" fill="${s.fill}"${s.bold ? ' font-weight="600"' : ''}${s.mono ? ' font-family="JetBrains Mono, monospace"' : ''} text-anchor="${s.anchor ?? 'start'}"${part}>${esc(s.text)}</text>`;
  }
}
