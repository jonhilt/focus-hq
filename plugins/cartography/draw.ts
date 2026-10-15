// A map drawn to be read (README.md): a view as its parts in a column per layer, each arrow saying what one part takes
// from another, and the whole map as a dependency matrix. Pure SVG strings, free of Node and the DOM.
import type { MapConnection, MapPart, MapView, RepoMap } from './shared';

/** Each layer's colour, by its place among the map's layers. */
const LAYER_COLOURS = ['#8fd3ff', '#ffcc66', '#c9a0ff', '#99dd88', '#ff9f80', '#80e0d0'];
const INK = { bg: '#0b1020', panel: '#121a33', text: '#e8ecf5', muted: '#9aa6c4', line: '#cfe3ff', grid: '#0f1630', self: '#1c2340', tangle: '255,140,60', oneWay: '120,190,255' };

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

/** A view's connections, each as a sentence: what one part uses from another, the busiest first (as viewSvg numbers them). */
export function viewSentences(map: RepoMap, view: MapView): string[] {
  const shown = new Set(view.parts);
  const label = (id: string) => map.model?.parts.find((p) => p.id === id)?.label ?? id;
  return map.connections
    .filter((c) => shown.has(c.from) && shown.has(c.to))
    .map((c) => `${label(c.from)} uses ${namesLabel(c, 6)} from ${label(c.to)} (${c.imports} import${c.imports === 1 ? '' : 's'})`);
}

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
 * The curve from part `a` to part `b`, and its middle, where its number goes. `lane` (-1, 0 or 1) moves it aside so
 * two parts that use each other get a line each.
 */
function edgePath(a: Placed, b: Placed, cols: number, lane: number): { d: string; mid: { x: number; y: number } } {
  const half = (VIEW.colW - VIEW.gutter) / 2;
  const curve = (p0: number[], p1: number[], p2: number[], p3: number[]) => ({
    d: `M${p0.join(',')} C${p1.join(',')} ${p2.join(',')} ${p3.join(',')}`,
    // a cubic Bézier's middle (t = 0.5)
    mid: { x: (p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8, y: (p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8 },
  });
  if (a.col === b.col) {
    // within a column, round its outer side (the right, for a middle one), the second line further out
    const side = a.col === 0 && cols > 1 ? -1 : 1;
    const x = a.x + side * half;
    const ox = x + side * (VIEW.bulge + (lane > 0 ? 26 : 0));
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

function numbered(x: number, y: number, n: number): string {
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="${INK.bg}" stroke="${INK.line}" stroke-width="1.5"/><text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${n}</text>`;
}

/**
 * View `view` of `map`: a column per layer, each part with what it does, and an arrow from each part to each part whose
 * code it uses, as thick as its imports. Each arrow carries the number of its sentence in `viewSentences`, which says
 * what it takes; two parts that use each other get a line each.
 */
export function viewSvg(map: RepoMap, view: MapView): string {
  const { placed, cols, rows } = placeView(map, view);
  const colours = layerColours([...placed.values()].map((p) => p.part));
  const W = VIEW.pad * 2 + Math.max(cols, 2) * VIEW.colW;
  const H = VIEW.top + rows * VIEW.rowH + 10;
  const boxW = VIEW.colW - VIEW.gutter;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,sans-serif">`,
    `<defs><marker id="cg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${INK.line}"/></marker></defs>`,
  ];
  [...colours].forEach(([layer, colour], i) =>
    out.push(`<text x="${VIEW.pad + VIEW.colW * (i + 0.5)}" y="30" text-anchor="middle" font-size="17" font-weight="700" letter-spacing="2" fill="${colour}">${esc(layer.toUpperCase())}</text>`));
  const between = map.connections.filter((c) => placed.has(c.from) && placed.has(c.to));
  const sentences = viewSentences(map, view);
  const numbers: string[] = [];
  between.forEach((c, i) => {
    const a = placed.get(c.from);
    const b = placed.get(c.to);
    if (!a || !b) return;
    // of two parts that use each other, the busier line keeps to one side and the other to the other
    const back = between.findIndex((o) => o.from === c.to && o.to === c.from);
    const lane = back < 0 ? 0 : back > i ? -1 : 1;
    const { d, mid } = edgePath(a, b, cols, lane);
    const sw = 1.5 + Math.log2(c.imports + 1) * 1.4;
    out.push(`<path d="${d}" fill="none" stroke="${INK.line}" stroke-opacity="0.7" stroke-width="${sw.toFixed(1)}" marker-end="url(#cg-arrow)"><title>${esc(sentences[i] ?? '')}</title></path>`);
    numbers.push(numbered(mid.x, mid.y, i + 1));
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
