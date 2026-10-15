// A map drawn to be read (README.md): a view as its parts in a column per layer, each arrow saying what one part takes
// from another, and the whole map as a dependency matrix. Pure SVG strings, free of Node and the DOM.
import type { MapConnection, MapFlow, MapPart, MapView, RepoMap } from './shared';

/** Each layer's colour, by its place among the map's layers. */
const LAYER_COLOURS = ['#8fd3ff', '#ffcc66', '#c9a0ff', '#99dd88', '#ff9f80', '#80e0d0'];
const INK = { flow: '#ffcc66', bg: '#0b1020', panel: '#121a33', text: '#e8ecf5', muted: '#9aa6c4', line: '#cfe3ff', grid: '#0f1630', self: '#1c2340', tangle: '255,140,60', oneWay: '120,190,255' };

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** About how wide `text` runs at `size` px, for fitting labels without a DOM. */
const width = (text: string, size: number, mono = false): number => text.length * size * (mono ? 0.6 : 0.52);

/** `text` cut to fit `max` px at `size`, with an ellipsis. */
export function fit(text: string, size: number, max: number, mono = false): string {
  if (width(text, size, mono) <= max) return text;
  const keep = Math.max(1, Math.floor(max / (size * (mono ? 0.6 : 0.52))) - 1);
  return `${text.slice(0, keep)}…`;
}

/** The layers in the order the model first names them, each with its colour. */
export function layerColours(parts: readonly MapPart[]): Map<string, string> {
  const colours = new Map<string, string>();
  for (const p of parts) if (!colours.has(p.layer)) colours.set(p.layer, LAYER_COLOURS[colours.size % LAYER_COLOURS.length]);
  return colours;
}

/** What a connection takes, for a label: its first few names, and how many more. */
export function namesLabel(c: Pick<MapConnection, 'names'>, keep = 3): string {
  const shown = c.names.slice(0, keep).map((n) => (n === '*' ? 'all of it' : n));
  const more = c.names.length - shown.length;
  return shown.join(', ') + (more > 0 ? ` +${more}` : '');
}

/** One line in a view: an import between two of its parts, or what one sends another at runtime. */
export interface ViewLine {
  from: string;
  to: string;
  kind: 'import' | 'flow';
  /** How many imports, or messages in the recorded run: the line's thickness. */
  weight: number;
  sentence: string;
}

const times = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function flowSentence(f: MapFlow, label: (id: string) => string): string {
  const what = f.names.slice(0, 5).join(', ') + (f.names.length > 5 ? ` +${f.names.length - 5}` : '');
  return f.via === 'ws'
    ? `${label(f.from)} sends ${what} to ${label(f.to)} over the WebSocket (${times(f.count, 'event')} in the recorded run)`
    : `${label(f.from)} calls ${what} on ${label(f.to)} (${times(f.count, 'request')} in the recorded run)`;
}

/** A view's lines, numbered as viewSvg draws them: its imports, the busiest first, then its recorded flows. */
export function viewLines(map: RepoMap, view: MapView): ViewLine[] {
  const shown = new Set(view.parts);
  const label = (id: string) => map.model?.parts.find((p) => p.id === id)?.label ?? id;
  const inView = (x: { from: string; to: string }) => shown.has(x.from) && shown.has(x.to);
  return [
    ...map.connections.filter(inView).map((c): ViewLine => ({ from: c.from, to: c.to, kind: 'import', weight: c.imports, sentence: `${label(c.from)} uses ${namesLabel(c, 6)} from ${label(c.to)} (${times(c.imports, 'import')})` })),
    ...(map.flows ?? []).filter(inView).map((f): ViewLine => ({ from: f.from, to: f.to, kind: 'flow', weight: f.count, sentence: flowSentence(f, label) })),
  ];
}

/** A view's lines as sentences: what one part uses from another, then what it sends another as it runs. */
export const viewSentences = (map: RepoMap, view: MapView): string[] => viewLines(map, view).map((l) => l.sentence);

const VIEW = { colW: 400, pad: 70, top: 60, rowH: 140, boxH: 100, gutter: 120, bulge: 40 } as const;

interface Placed {
  part: MapPart;
  x: number;
  y: number;
  col: number;
}

/** Where each of a view's parts stands: a column per layer, in the model's order of layers and parts. */
export function placeView(map: RepoMap, view: MapView): { placed: Map<string, Placed>; cols: number; rows: number } {
  const shown = new Set(view.parts);
  const parts = (map.model?.parts ?? []).filter((p) => shown.has(p.id));
  const layers = [...layerColours(parts).keys()];
  const placed = new Map<string, Placed>();
  const counts = layers.map(() => 0);
  for (const part of parts) {
    const col = layers.indexOf(part.layer);
    placed.set(part.id, { part, col, x: VIEW.pad + VIEW.colW * (col + 0.5), y: VIEW.top + VIEW.rowH * (counts[col] + 0.5) });
    counts[col]++;
  }
  return { placed, cols: layers.length, rows: Math.max(1, ...counts) };
}

/** `text` in at most `lines` lines of `max` px at `size`, broken between words, the last cut to fit. */
export function wrap(text: string, size: number, max: number, lines = 2): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next, size) > max) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out.length > lines ? [...out.slice(0, lines - 1), fit(out.slice(lines - 1).join(' '), size, max)] : out;
}

/**
 * The curve from part `a` to part `b`, and its middle, where its number goes. It's line `slot` of `of` between the two
 * (either way), moved aside so each gets a line of its own.
 */
function edgePath(a: Placed, b: Placed, cols: number, slot: number, of: number): { d: string; mid: { x: number; y: number } } {
  const half = (VIEW.colW - VIEW.gutter) / 2;
  const lane = slot - (of - 1) / 2;
  const curve = (p0: number[], p1: number[], p2: number[], p3: number[]) => ({
    d: `M${p0.join(',')} C${p1.join(',')} ${p2.join(',')} ${p3.join(',')}`,
    // a cubic Bézier's middle (t = 0.5)
    mid: { x: (p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8, y: (p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8 },
  });
  if (a.col === b.col) {
    // within a column, round its outer side (the right, for a middle one), each further line further out
    const side = a.col === 0 && cols > 1 ? -1 : 1;
    const x = a.x + side * half;
    const ox = x + side * (VIEW.bulge + slot * 26);
    const dy = lane * 12;
    return curve([x, a.y + dy], [ox, a.y + dy], [ox, b.y + dy], [x, b.y + dy]);
  }
  const dir = b.x > a.x ? 1 : -1;
  const sx = a.x + dir * half;
  const ex = b.x - dir * half;
  const mx = (sx + ex) / 2;
  const dy = lane * 14;
  return curve([sx, a.y + dy], [mx, a.y + dy], [mx, b.y + dy], [ex, b.y + dy]);
}

function numbered(x: number, y: number, n: number, colour: string): string {
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="${INK.bg}" stroke="${colour}" stroke-width="1.5"/><text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${n}</text>`;
}

/**
 * View `view` of `map`: a column per layer, each part with what it does, an arrow from each part to each part whose
 * code it uses, as thick as its imports, and a dashed gold one for what it sends another as it runs (a recorded run's
 * flows). Each arrow carries the number of its sentence in `viewSentences`; every line between two parts gets its own.
 */
export function viewSvg(map: RepoMap, view: MapView): string {
  const { placed, cols, rows } = placeView(map, view);
  const colours = layerColours([...placed.values()].map((p) => p.part));
  const W = VIEW.pad * 2 + Math.max(cols, 2) * VIEW.colW;
  const H = VIEW.top + rows * VIEW.rowH + 10;
  const boxW = VIEW.colW - VIEW.gutter;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,sans-serif">`,
    `<defs>${[['cg-arrow', INK.line], ['cg-flow', INK.flow]].map(([id, fill]) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${fill}"/></marker>`).join('')}</defs>`,
  ];
  [...colours].forEach(([layer, colour], i) =>
    out.push(`<text x="${VIEW.pad + VIEW.colW * (i + 0.5)}" y="30" text-anchor="middle" font-size="17" font-weight="700" letter-spacing="2" fill="${colour}">${esc(layer.toUpperCase())}</text>`));
  const lines = viewLines(map, view);
  const pair = (l: ViewLine) => [l.from, l.to].sort().join(' ');
  const numbers: string[] = [];
  lines.forEach((line, i) => {
    const a = placed.get(line.from);
    const b = placed.get(line.to);
    if (!a || !b) return;
    // every line between the same two parts, either way and of either kind, gets a lane of its own
    const same = lines.filter((l) => pair(l) === pair(line));
    const { d, mid } = edgePath(a, b, cols, same.indexOf(line), same.length);
    const sw = 1.5 + Math.log2(line.weight + 1) * (line.kind === 'flow' ? 0.9 : 1.4);
    const [colour, marker, dash] = line.kind === 'flow' ? [INK.flow, 'cg-flow', ' stroke-dasharray="10 7"'] : [INK.line, 'cg-arrow', ''];
    out.push(`<path d="${d}" fill="none" stroke="${colour}" stroke-opacity="0.75" stroke-width="${sw.toFixed(1)}"${dash} marker-end="url(#${marker})"><title>${esc(line.sentence)}</title></path>`);
    numbers.push(numbered(mid.x, mid.y, i + 1, colour));
  });
  out.push(...numbers);
  for (const { part, x, y } of placed.values()) {
    const colour = colours.get(part.layer) ?? INK.muted;
    const does = wrap(part.does ?? part.paths.join(', '), 15, boxW - 24);
    out.push(
      `<g><title>${esc(`${part.label}: ${part.paths.join(', ')}`)}</title>`,
      `<rect x="${x - boxW / 2}" y="${y - VIEW.boxH / 2}" width="${boxW}" height="${VIEW.boxH}" rx="10" fill="${INK.panel}" stroke="${colour}" stroke-width="2.5"/>`,
      `<text x="${x}" y="${y - 16}" text-anchor="middle" font-size="21" font-weight="650" fill="#fff">${esc(fit(part.label, 21, boxW - 20))}</text>`,
      ...does.map((line, i) => `<text x="${x}" y="${y + 12 + i * 19}" text-anchor="middle" font-size="15" fill="${INK.muted}">${esc(line)}</text>`),
      '</g>',
    );
  }
  out.push('</svg>');
  return out.join('');
}

const GRID = { cell: 32, labels: 270, top: 40, key: 40 } as const;

/** The busiest connection, as the matrix's key reads it out: where to look, and what it says. */
export function matrixExample(map: RepoMap): string | undefined {
  const parts = matrixOrder(map);
  const c = map.connections[0];
  if (!c) return undefined;
  const row = parts.findIndex((p) => p.id === c.from) + 1;
  const col = parts.findIndex((p) => p.id === c.to) + 1;
  const label = (n: number) => parts[n - 1]?.label ?? '';
  return `Row ${row}, column ${col}: ${c.imports} means ${label(row)} imports from ${label(col)} ${c.imports} times (${namesLabel(c)}).`;
}

/** The map's parts in the matrix's order: grouped by layer, in the model's order. */
export function matrixOrder(map: RepoMap): MapPart[] {
  const parts = map.model?.parts ?? [];
  const layers = [...layerColours(parts).keys()];
  return [...parts].sort((a, b) => layers.indexOf(a.layer) - layers.indexOf(b.layer));
}

/**
 * The whole map as a dependency matrix: a row and a column per part, grouped by layer. The number where a row meets a
 * column is how often the row's part imports the column's, shaded by it; orange when the two import each other.
 */
export function matrixSvg(map: RepoMap): string {
  const parts = matrixOrder(map);
  const colours = layerColours(parts);
  const n = parts.length;
  const { cell: C, labels: L, top: T } = GRID;
  const at = new Map(map.connections.map((c) => [`${c.from} ${c.to}`, c]));
  const max = Math.max(1, ...map.connections.map((c) => c.imports));
  const W = L + n * C + 10;
  const H = T + n * C + 10;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,sans-serif">`, `<rect x="${L}" y="${T}" width="${n * C}" height="${n * C}" fill="${INK.grid}"/>`];
  parts.forEach((p, i) => {
    const colour = colours.get(p.layer) ?? INK.muted;
    out.push(`<text x="${L - 10}" y="${T + i * C + C / 2 + 5}" text-anchor="end" font-size="15" fill="${colour}">${esc(fit(`${i + 1}  ${p.label}`, 15, L - 16))}</text>`);
    out.push(`<text x="${L + i * C + C / 2}" y="${T - 12}" text-anchor="middle" font-size="13" fill="${colour}">${i + 1}</text>`);
  });
  parts.forEach((a, i) =>
    parts.forEach((b, j) => {
      const x = L + j * C;
      const y = T + i * C;
      if (i === j) return void out.push(`<rect x="${x}" y="${y}" width="${C}" height="${C}" fill="${INK.self}"/>`);
      const c = at.get(`${a.id} ${b.id}`);
      if (!c) return;
      const tangled = at.has(`${b.id} ${a.id}`);
      const shade = (0.2 + 0.8 * Math.sqrt(c.imports / max)).toFixed(2);
      out.push(
        `<g><title>${esc(`${a.label} imports ${b.label} ${c.imports}×: ${namesLabel(c, 8)}${tangled ? ' (they import each other)' : ''}`)}</title>`,
        `<rect x="${x + 1}" y="${y + 1}" width="${C - 2}" height="${C - 2}" fill="rgba(${tangled ? INK.tangle : INK.oneWay},${shade})"/>`,
        `<text x="${x + C / 2}" y="${y + C / 2 + 5}" text-anchor="middle" font-size="13" fill="#fff">${c.imports}</text></g>`,
      );
    }));
  let from = 0;
  for (const [layer, colour] of colours) {
    const k = parts.filter((p) => p.layer === layer).length;
    out.push(`<rect x="${L + from * C}" y="${T + from * C}" width="${k * C}" height="${k * C}" fill="none" stroke="${colour}" stroke-width="2"/>`);
    from += k;
  }
  out.push('</svg>');
  return out.join('');
}
