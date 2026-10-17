// A map drawn to be read (README.md): a view as its parts in a column per layer, each arrow saying what one part takes
// from another, the whole map as a dependency matrix, and how it changes as bars and sentences. Pure SVG strings, free of Node and the DOM.
import type { CrossCall, CrossCoupling, MapConnection, MapFlow, MapPart, MapView, RepoMap } from './shared';
import { type Finding, findings, headline } from './findings';
import { CHANGES, CHANGES_KEY, MATRIX_KEY, VIEW_KEY, WHOLE } from './views';

/** Each layer's colour, by its place among the map's layers. */
const LAYER_COLOURS = ['#8fd3ff', '#ffcc66', '#c9a0ff', '#99dd88', '#ff9f80', '#80e0d0'];
/**
 * What a slice changes, marked on a view of it (slice.ts): the parts its files fall in, with their lines; the parts it
 * adds and drops; and the imports between parts it makes and breaks (`from to`).
 */
export interface Marks {
  touched: Map<string, number>;
  added: Set<string>;
  removed: Set<string>;
  gained: Set<string>;
  lost: Set<string>;
}
const MARK = { touched: '#ffcc66', added: '#7ee08a', removed: '#ff7a7a', coupled: '#c9a0ff' } as const;

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
  /** An import, a recorded run's flow, or two parts in different repos that change together (crossRepo.ts). */
  kind: 'import' | 'flow' | 'coupled';
  /** On a slice's view: an import the slice makes, or one it breaks. */
  change?: 'gained' | 'lost';
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

/**
 * A view's lines, numbered as viewSvg draws them: its imports, the busiest first, then its recorded flows. On a slice's
 * view (`marks`), the imports it makes and breaks say so.
 */
export function viewLines(map: RepoMap, view: MapView, marks?: Marks): ViewLine[] {
  const shown = new Set(view.parts);
  const label = (id: string) => map.model?.parts.find((p) => p.id === id)?.label ?? id;
  const inView = (x: { from: string; to: string }) => shown.has(x.from) && shown.has(x.to);
  const changeOf = (c: MapConnection) => (marks?.gained.has(`${c.from} ${c.to}`) ? 'gained' : marks?.lost.has(`${c.from} ${c.to}`) ? 'lost' : undefined);
  const said = { gained: ', new in this slice', lost: ', which this slice takes out' } as const;
  return [
    ...map.connections.filter(inView).map((c): ViewLine => {
      const change = changeOf(c);
      return { from: c.from, to: c.to, kind: 'import', weight: c.imports, change, sentence: `${label(c.from)} uses ${namesLabel(c, 6)} from ${label(c.to)} (${times(c.imports, 'import')}${change ? said[change] : ''})` };
    }),
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
export function viewSvg(map: RepoMap, view: MapView, marks?: Marks, extra: readonly ViewLine[] = []): string {
  const { placed, cols, rows } = placeView(map, view);
  const colours = layerColours([...placed.values()].map((p) => p.part));
  const W = VIEW.pad * 2 + Math.max(cols, 2) * VIEW.colW;
  const H = VIEW.top + rows * VIEW.rowH + 10;
  const boxW = VIEW.colW - VIEW.gutter;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,sans-serif">`,
    `<defs>${[['cg-arrow', INK.line], ['cg-flow', INK.flow], ['cg-gained', MARK.added], ['cg-lost', MARK.removed]].map(([id, fill]) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${fill}"/></marker>`).join('')}</defs>`,
  ];
  [...colours].forEach(([layer, colour], i) =>
    out.push(`<text x="${VIEW.pad + VIEW.colW * (i + 0.5)}" y="30" text-anchor="middle" font-size="17" font-weight="700" letter-spacing="2" fill="${colour}">${esc(layer.toUpperCase())}</text>`));
  const lines = [...viewLines(map, view, marks), ...extra];
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
    const [colour, marker, dash] =
      line.kind === 'coupled' ? [MARK.coupled, '', ' stroke-dasharray="3 7" stroke-linecap="round"']
      : line.change === 'gained' ? [MARK.added, 'cg-gained', '']
      : line.change === 'lost' ? [MARK.removed, 'cg-lost', ' stroke-dasharray="6 6"']
      : line.kind === 'flow' ? [INK.flow, 'cg-flow', ' stroke-dasharray="10 7"']
      : [INK.line, 'cg-arrow', ''];
    out.push(`<path d="${d}" fill="none" stroke="${colour}" stroke-opacity="0.75" stroke-width="${sw.toFixed(1)}"${dash} ${marker ? ` marker-end="url(#${marker})"` : ''}><title>${esc(line.sentence)}</title></path>`);
    numbers.push(numbered(mid.x, mid.y, i + 1, colour));
  });
  out.push(...numbers);
  for (const { part, x, y } of placed.values()) {
    const colour = colours.get(part.layer) ?? INK.muted;
    const does = wrap(part.does ?? part.paths.join(', '), 15, boxW - 24);
    // on a slice's view, a part it adds, drops or touches wears that colour, and says so on a tab over its corner
    const lines = marks?.touched.get(part.id);
    const mark = marks?.added.has(part.id) ? { colour: MARK.added, tab: 'NEW' } : marks?.removed.has(part.id) ? { colour: MARK.removed, tab: 'GONE' } : lines !== undefined ? { colour: MARK.touched, tab: lines ? `${lines} LINES` : 'CHANGED' } : undefined;
    const left = x - boxW / 2;
    const top = y - VIEW.boxH / 2;
    out.push(
      `<g><title>${esc(`${part.label}: ${part.paths.join(', ')}`)}</title>`,
      `<rect x="${left}" y="${top}" width="${boxW}" height="${VIEW.boxH}" rx="10" fill="${INK.panel}" stroke="${mark?.colour ?? colour}" stroke-width="${mark ? 4.5 : 2.5}"${marks?.removed.has(part.id) ? ' stroke-dasharray="8 6"' : ''}/>`,
      ...(mark
        ? [
            `<rect x="${left + boxW - 112}" y="${top - 13}" width="104" height="24" rx="12" fill="${mark.colour}"/>`,
            `<text x="${left + boxW - 60}" y="${top + 4}" text-anchor="middle" font-size="13" font-weight="800" letter-spacing="1" fill="${INK.bg}">${esc(fit(mark.tab, 13, 96))}</text>`,
          ]
        : []),
      `<text x="${x}" y="${y - 16}" text-anchor="middle" font-size="21" font-weight="650" fill="#fff">${esc(fit(part.label, 21, boxW - 20))}</text>`,
      ...does.map((line, i) => `<text x="${x}" y="${y + 12 + i * 19}" text-anchor="middle" font-size="15" fill="${INK.muted}">${esc(line)}</text>`),
      '</g>',
    );
  }
  out.push('</svg>');
  return out.join('');
}

const GRID = { cell: 32, labels: 270, top: 40, key: 40, gap: 36, findings: 470 } as const;
/** Where to look: a finding's numbers and outlines on the matrix. */
const LOOK = '#ffcc66';

/** The map's parts in the matrix's order: grouped by layer, in the model's order. */
export function matrixOrder(map: RepoMap): MapPart[] {
  const parts = map.model?.parts ?? [];
  const layers = [...layerColours(parts).keys()];
  return [...parts].sort((a, b) => layers.indexOf(a.layer) - layers.indexOf(b.layer));
}

/**
 * The whole map as a dependency matrix: a row and a column per part, grouped by layer. The number where a row meets a
 * column is how often the row's part imports the column's, shaded by it; orange when the two import each other. Its
 * `found` (findings.ts) head it in a column beside it, where to look, each numbered on the cells it's about: outlined in
 * gold, and dashed where there's no import to show. Each cell names its two parts (`data-cell`), to say more on a click.
 */
export function matrixSvg(map: RepoMap, found: readonly Finding[] = []): string {
  const parts = matrixOrder(map);
  const colours = layerColours(parts);
  const n = parts.length;
  const { cell: C, labels: L, top: T } = GRID;
  const at = new Map(map.connections.map((c) => [`${c.from} ${c.to}`, c]));
  const max = Math.max(1, ...map.connections.map((c) => c.imports));
  const side = found.length ? GRID.gap + GRID.findings : 0;
  // each finding's sentence, wrapped to the column beside the grid
  const said = found.map((f) => wrap(f.sentence, 16, GRID.findings - 44, 5));
  const sideH = 40 + said.reduce((h, lines) => h + lines.length * 21 + 16, 0);
  const W = L + n * C + 10 + side;
  const H = Math.max(T + n * C + 10, sideH);
  const out = [`<svg data-matrix="1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,sans-serif">`, `<rect x="${L}" y="${T}" width="${n * C}" height="${n * C}" fill="${INK.grid}"/>`];
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
        `<g data-cell="${esc(`${a.id} ${b.id}`)}" style="cursor:pointer"><title>${esc(`${a.label} imports ${b.label} ${c.imports}×: ${namesLabel(c, 8)}${tangled ? ' (they import each other)' : ''}`)}</title>`,
        `<rect x="${x + 1}" y="${y + 1}" width="${C - 2}" height="${C - 2}" fill="rgba(${tangled ? INK.tangle : INK.oneWay},${shade})"/>`,
        `<text x="${x + C / 2}" y="${y + C / 2 + 5}" text-anchor="middle" font-size="13" fill="#fff">${c.imports}</text></g>`,
      );
    }));
  const index = new Map(parts.map((p, i) => [p.id, i]));
  const marks: string[] = [];
  found.forEach((f, k) => {
    const cells = f.cells.flatMap(({ from, to }) => {
      const i = index.get(from);
      const j = index.get(to);
      return i === undefined || j === undefined ? [] : [{ x: L + j * C, y: T + i * C, dashed: !at.has(`${from} ${to}`) }];
    });
    // its cells' outlines show as it's pointed at (wireMatrix): a column of them at once is more than a glance takes
    out.push(`<g data-look="${k + 1}" opacity="0">`, ...cells.map((c) => `<rect x="${c.x + 1}" y="${c.y + 1}" width="${C - 2}" height="${C - 2}" fill="none" stroke="${LOOK}" stroke-width="2.5"${c.dashed ? ' stroke-dasharray="4 3"' : ''}/>`), '</g>');
    // its number by the first of its cells, over every outline
    const first = cells[0];
    if (first) marks.push(`<circle cx="${first.x + C - 3}" cy="${first.y + 3}" r="10" fill="${LOOK}"/><text x="${first.x + C - 3}" y="${first.y + 8}" text-anchor="middle" font-size="13" font-weight="800" fill="${INK.bg}">${k + 1}</text>`);
  });
  if (found.length) {
    const x = L + n * C + 10 + GRID.gap;
    out.push(`<text x="${x}" y="22" font-size="15" font-weight="700" letter-spacing="2" fill="${LOOK}">WHERE TO LOOK</text>`);
    let y = 54;
    said.forEach((lines, k) => {
      out.push(`<g data-finding="${k + 1}" style="cursor:pointer"><rect x="${x - 6}" y="${y - 20}" width="${GRID.findings - 4}" height="${lines.length * 21 + 10}" fill="transparent"/>`);
      out.push(`<circle cx="${x + 12}" cy="${y - 5}" r="12" fill="${LOOK}"/><text x="${x + 12}" y="${y}" text-anchor="middle" font-size="14" font-weight="800" fill="${INK.bg}">${k + 1}</text>`);
      lines.forEach((line, i) => out.push(`<text x="${x + 34}" y="${y + i * 21}" font-size="16" fill="${INK.text}">${esc(line)}</text>`));
      out.push('</g>');
      y += lines.length * 21 + 16;
    });
  }
  let from = 0;
  for (const [layer, colour] of colours) {
    const k = parts.filter((p) => p.layer === layer).length;
    out.push(`<rect x="${L + from * C}" y="${T + from * C}" width="${k * C}" height="${k * C}" fill="none" stroke="${colour}" stroke-width="2"/>`);
    from += k;
  }
  out.push(...marks, '</svg>');
  return out.join('');
}

const TABLE = { labels: 250, spark: 220, sparkH: 18, row: 26, top: 44, gap: 56, coupling: 470, coupled: 46 } as const;

/** `values` as a sparkline `w` × `h` from (`x`, `y`), on a scale up to `max`, its last value marked. */
function sparkline(values: readonly number[], x: number, y: number, w: number, h: number, max: number): string {
  const at = (v: number, i: number) => [x + (i * w) / Math.max(1, values.length - 1), y + h - (v / Math.max(1, max)) * h].map((n) => n.toFixed(1));
  const points = values.map((v, i) => at(v, i).join(',')).join(' ');
  const [lx, ly] = at(values[values.length - 1] ?? 0, values.length - 1);
  return `<polyline points="${points}" fill="none" stroke="${INK.line}" stroke-opacity="0.8" stroke-width="1.3" stroke-linejoin="round"/><circle cx="${lx}" cy="${ly}" r="2.6" fill="${LOOK}"/>`;
}

/**
 * How a map's parts changed in git, as a table: each part that changed, the busiest first, named in its layer's colour,
 * with its commits over time as a sparkline (every line on one scale, so they compare; the latest point gold), its
 * commits and lines; the whole repo's first. Beside it, the pairs that keep changing together, and what ties them, gold
 * where nothing on the map does.
 */
export function changesSvg(map: RepoMap): string {
  const parts = map.model?.parts ?? [];
  const colours = layerColours(parts);
  const h = map.history;
  const changed = h?.parts ?? [];
  const max = Math.max(1, ...changed.flatMap((c) => c.series ?? []));
  const coupling = h?.coupling ?? [];
  const sentences = changeSentences(map);
  const [cSpark, cCommits, cLines] = [TABLE.labels + 16, TABLE.labels + 16 + TABLE.spark + 70, TABLE.labels + 16 + TABLE.spark + 160];
  const tableW = cLines + 10;
  const W = tableW + (coupling.length ? TABLE.gap + TABLE.coupling : 0);
  const rows = 1 + changed.length;
  const H = Math.max(TABLE.top + rows * TABLE.row + 16, TABLE.top + coupling.length * TABLE.coupled + 10);
  const num = 'font-variant-numeric="tabular-nums" text-anchor="end"';
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,sans-serif" style="font-variant-numeric:tabular-nums">`,
    `<text x="${cSpark}" y="20" font-size="13" font-style="italic" fill="${INK.muted}">commits ${(h?.step ?? 1) === 1 ? 'a day' : `every ${h?.step} days`}, one scale</text>`,
    `<text x="${cCommits}" y="20" ${num} font-size="13" font-style="italic" fill="${INK.muted}">commits</text>`,
    `<text x="${cLines}" y="20" ${num} font-size="13" font-style="italic" fill="${INK.muted}">lines</text>`,
  ];
  const row = (i: number, label: string, colour: string, series: readonly number[] | undefined, scale: number, commits: number, lines: number | undefined, title: string, bold = false) => {
    const y = TABLE.top + i * TABLE.row;
    const weight = bold ? ' font-weight="700"' : '';
    out.push(
      `<g><title>${esc(title)}</title>`,
      `<text x="${TABLE.labels}" y="${y + 14}" text-anchor="end" font-size="15"${weight} fill="${colour}">${esc(fit(label, 15, TABLE.labels - 10))}</text>`,
      series ? sparkline(series, cSpark, y + 14 - TABLE.sparkH + 2, TABLE.spark, TABLE.sparkH, scale) : '',
      `<text x="${cCommits}" y="${y + 14}" ${num} font-size="15"${weight} fill="${INK.text}">${commits}</text>`,
      lines === undefined ? '' : `<text x="${cLines}" y="${y + 14}" ${num} font-size="15" fill="${INK.muted}">${lines.toLocaleString('en')}</text>`,
      '</g>',
    );
  };
  const span = (h?.step ?? 1) === 1 ? 'day' : `${h?.step} days`;
  const latest = (series?: readonly number[]) => (series?.length ? `, ${times(series[series.length - 1], 'commit')} in the last ${span}` : '');
  // the repo as a whole, on a scale of its own, ruled off from its parts
  row(0, 'Every part', INK.text, h?.series, Math.max(1, ...(h?.series ?? [])), h?.commits ?? 0, undefined, `${times(h?.commits ?? 0, 'commit')} in ${h?.days ?? 0} days${latest(h?.series)}`, true);
  out.push(`<line x1="${TABLE.labels - 140}" x2="${tableW}" y1="${TABLE.top + TABLE.row - 4}" y2="${TABLE.top + TABLE.row - 4}" stroke="${INK.muted}" stroke-opacity="0.35"/>`);
  changed.forEach((c, i) => {
    const part = parts.find((p) => p.id === c.id);
    const label = part?.label ?? c.id;
    row(i + 1, label, (part && colours.get(part.layer)) ?? INK.muted, c.series, max, c.commits, c.lines, `${label}: ${times(c.commits, 'commit')}, ${times(c.lines, 'line')} changed${latest(c.series)}`);
  });
  if (coupling.length) {
    const x = tableW + TABLE.gap;
    const label = (id: string) => parts.find((p) => p.id === id)?.label ?? id;
    const talk = (a: string, b: string) => (map.flows ?? []).some((f) => (f.from === a && f.to === b) || (f.from === b && f.to === a));
    out.push(`<text x="${x}" y="20" font-size="13" font-style="italic" fill="${INK.muted}">changed together, and what ties them</text>`);
    coupling.forEach((c, i) => {
      const y = TABLE.top + i * TABLE.coupled;
      const tie = c.imports ? 'an import' : talk(c.a, c.b) ? 'no import: they talk over the wire' : 'no import: nothing on the map says why';
      const share = Math.round((c.together / c.either) * 100);
      out.push(
        `<g><title>${esc(sentences[i])}</title>`,
        `<text x="${x}" y="${y + 14}" font-size="15" fill="${INK.text}">${esc(fit(`${label(c.a)} & ${label(c.b)}`, 15, TABLE.coupling))}</text>`,
        `<text x="${x}" y="${y + 33}" font-size="13" fill="${c.imports ? INK.muted : LOOK}"><tspan fill="${INK.muted}">${c.together} of ${c.either} commits (${share}%) · </tspan>${esc(tie)}</text>`,
        '</g>',
      );
    });
  }
  out.push('</svg>');
  return out.join('');
}

/** Under the matrix, until a cell's clicked: how to dig in. */
export const MATRIX_HINT = 'Point at a finding to outline its cells; click a cell for what one part takes from the other.';

/**
 * Makes the matrix in `root` answer the pointer (a function on its own, so a page can carry it as a script, page.ts):
 * a finding pointed at or clicked outlines its cells, and a cell clicked says what it takes in the `[data-said]` line.
 */
export function wireMatrix(root: ParentNode): void {
  const svg = root.querySelector('svg[data-matrix]');
  if (!svg) return;
  const show = (k: string | null) => svg.querySelectorAll('[data-look]').forEach((g) => g.setAttribute('opacity', g.getAttribute('data-look') === k ? '1' : '0'));
  svg.querySelectorAll('[data-finding]').forEach((el) => {
    el.addEventListener('mouseenter', () => show(el.getAttribute('data-finding')));
    el.addEventListener('click', () => show(el.getAttribute('data-finding')));
  });
  const said = root.querySelector('[data-said]');
  svg.querySelectorAll('[data-cell]').forEach((el) => el.addEventListener('click', () => {
    if (said) said.textContent = el.querySelector('title')?.textContent ?? '';
  }));
}

/** A map's change coupling as sentences: which parts keep changing together, and whether an import says why. */
export function changeSentences(map: RepoMap): string[] {
  const label = (id: string) => map.model?.parts.find((p) => p.id === id)?.label ?? id;
  const talk = (a: string, b: string) => (map.flows ?? []).some((f) => (f.from === a && f.to === b) || (f.from === b && f.to === a));
  return (map.history?.coupling ?? []).map((c) => {
    const share = Math.round((c.together / c.either) * 100);
    // an import says why two parts change together; failing that, a recorded run's flow between them; failing both, nothing on the map does
    const why = c.imports ? '' : talk(c.a, c.b) ? ', with no import between them: they talk over the wire (the recorded run\'s flows)' : ', with no import between them: what ties them isn\'t on the map';
    return `${label(c.a)} and ${label(c.b)} changed together in ${c.together} of the ${c.either} commits that changed either (${share}%)${why}`;
  });
}

/** How to read a slice's view. */
export const SLICE_KEY =
  'What this slice does to the architecture, from its lead\'s checkout against the default branch. Gold: a part its changes fall in, with how many lines. Green: a part or import it adds. Red, dashed: one it takes out. Grey arrows are imports it leaves as they were.';

/** How to read the view of how a project's repos connect. */
export const TIES_KEY =
  'A column per repo. A dashed gold arrow goes from a part to the part in another repo whose HTTP routes it calls (the routes one repo declares, matched to the paths another names). A dotted lilac line joins two parts that keep changing together: repos don\'t import each other, so a change that needs two shows as one person\'s commits to each, within two hours.';

/** The question the view of a project's repos answers. */
export const TIES_QUESTION = 'How do its repos connect?';

/**
 * The view of how a project's repos connect: a column per repo, with the parts its `calls` (routes.ts) and `ties`
 * (crossRepo.ts) join, each line numbered and said in a sentence, the calls first. Undefined when nothing does.
 */
export function tiesDrawing(maps: readonly RepoMap[], ties: readonly CrossCoupling[], calls: readonly CrossCall[] = []): { map: RepoMap; view: MapView; svg: string; key: string; sentences: string[] } | undefined {
  if (!ties.length && !calls.length) return undefined;
  const id = (repo: string, part: string) => `${repo}#${part}`;
  const ends = [...calls.flatMap((c) => [c.from, c.to]), ...ties.flatMap((t) => [t.a, t.b])];
  const used = new Set(ends.map((e) => id(e.repo, e.part)));
  // each repo's parts the lines join, the repos in the project's order, each its own column; a spec whose routes no
  // part implements stands in for one
  const parts = maps.flatMap((m) => {
    const own = (m.model?.parts ?? []).filter((p) => used.has(id(m.repo, p.id))).map((p) => ({ ...p, id: id(m.repo, p.id), layer: m.repo }));
    const specs = [...new Set(ends.filter((e) => e.repo === m.repo && !(m.model?.parts ?? []).some((p) => p.id === e.part)).map((e) => e.part))];
    return [...own, ...specs.map((file): MapPart => ({ id: id(m.repo, file), label: file.slice(file.lastIndexOf('/') + 1), layer: m.repo, kind: 'route', paths: [file], does: 'Its API spec' }))];
  });
  const label = (repo: string, part: string) => parts.find((p) => p.id === id(repo, part))?.label ?? part;
  const map: RepoMap = { repo: maps.map((m) => m.repo).join(' + '), files: 0, mapped: 0, sizes: {}, connections: [], problems: [], model: { parts, views: [], ignore: [] } };
  const view: MapView = { id: 'repos', question: TIES_QUESTION, parts: parts.map((p) => p.id) };
  const listed = (routes: readonly string[]) => routes.slice(0, 4).join(', ') + (routes.length > 4 ? ` +${routes.length - 4}` : '');
  const lines = [
    ...calls.map((c): ViewLine => ({
      from: id(c.from.repo, c.from.part),
      to: id(c.to.repo, c.to.part),
      kind: 'flow',
      weight: c.routes.length,
      sentence: `${label(c.from.repo, c.from.part)} (${c.from.repo}) calls ${listed(c.routes)} on ${label(c.to.repo, c.to.part)} (${c.to.repo})`,
    })),
    ...ties.map((t): ViewLine => ({
      from: id(t.a.repo, t.a.part),
      to: id(t.b.repo, t.b.part),
      kind: 'coupled',
      weight: t.together,
      sentence: `${label(t.a.repo, t.a.part)} (${t.a.repo}) and ${label(t.b.repo, t.b.part)} (${t.b.repo}) changed together in ${t.together} of the ${t.either} change sets that touched either`,
    })),
  ];
  return { map, view, svg: viewSvg(map, view, undefined, lines), key: TIES_KEY, sentences: lines.map((l) => l.sentence) };
}

/**
 * Any view of a map as the browser and the screens show it: its drawing, how to read it, and its numbered sentences.
 * A slice's view (slice.ts `sliceView`) comes with `marks`, what the slice changes.
 */
export function viewDrawing(map: RepoMap, view: MapView, marks?: Marks): { svg: string; key: string; sentences: string[] } {
  if (marks) return { svg: viewSvg(map, view, marks), key: SLICE_KEY, sentences: viewLines(map, view, marks).map((l) => l.sentence) };
  if (view.id === WHOLE.id) {
    const found = findings(map);
    return { svg: matrixSvg(map, found), key: `${headline(map)} ${MATRIX_KEY}`, sentences: [] };
  }
  if (view.id === CHANGES.id) {
    const h = map.history;
    return { svg: changesSvg(map), key: `${CHANGES_KEY} The last ${h?.days ?? 0} days: ${times(h?.commits ?? 0, 'commit')}.`, sentences: [] };
  }
  return { svg: viewSvg(map, view), key: VIEW_KEY, sentences: viewSentences(map, view) };
}
