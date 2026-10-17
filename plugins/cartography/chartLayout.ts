// Where everything on the stellar cartography screen goes (chart.ts draws it): its bands, its stars and their names,
// its lines and the key along the bottom, in px on a `w` × `h` canvas. Pure, so it's tested without a canvas.
import type { Miniature } from './miniature';

/** The LCARS frame's bars, and the chart's edges inside it. */
export const FRAME = { bar: 64, left: 190, right: 50, top: 70 } as const;

export interface ChartBand {
  layer: string;
  colour: string;
  y: number;
}

export interface ChartStar {
  x: number;
  y: number;
  r: number;
  /** How opaque it is: as bright as its share of the commits, never quite out. */
  alpha: number;
  colour: string;
  label: string;
  /** Where its name goes, above or below it by turns along its band, and how wide it may run. */
  labelY: number;
  room: number;
}

export interface ChartLine {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Both control points' height: halfway between bands, or arching over its own. */
  bend: number;
  width: number;
}

export interface ChartLayout {
  key: string;
  bands: ChartBand[];
  stars: ChartStar[];
  /** The lightest first, so the heaviest lie on top. */
  lines: ChartLine[];
}

/** How big a star of `size` (0 to 1 of the biggest part) is, in px. */
export const starRadius = (size: number): number => 3 + 11 * size;

/** What the bottom bar says: how to read the chart, and how many of the imports it shows. */
export const chartKey = (mini: Miniature): string =>
  mini.parts.length ? `BAND: LAYER · SIZE: FILES · BRIGHTNESS: COMMITS · LINES: THE ${mini.links.length} HEAVIEST OF ${mini.imports} IMPORTS` : 'ARCHITECTURE';

/** Each band's height on the canvas, evenly from the top of the chart to the bottom; one band stands in the middle. */
export function bandHeights(count: number, h: number): number[] {
  const top = FRAME.bar + FRAME.top;
  const bottom = h - FRAME.bar - FRAME.top;
  return Array.from({ length: count }, (_, i) => (count > 1 ? top + (i * (bottom - top)) / (count - 1) : h / 2));
}

/** Where `mini` goes on a `w` × `h` canvas. */
export function chartLayout(mini: Miniature, w: number, h: number): ChartLayout {
  const heights = bandHeights(mini.bands.length, h);
  const span = { from: FRAME.left + 40, width: w - FRAME.right - FRAME.left - 80 };
  const at = mini.parts.map((p) => ({ x: span.from + p.at * span.width, y: heights[p.band] }));
  const stars: ChartStar[] = [];
  mini.bands.forEach((_, band) => {
    const mine = mini.parts.map((p, i) => ({ p, i })).filter(({ p }) => p.band === band).sort((x, y) => x.p.at - y.p.at);
    // names alternate above and below, so the nearest name on the same side is two stars along
    const room = Math.max(40, (2 * span.width) / Math.max(1, mine.length) - 10);
    mine.forEach(({ p, i }, k) => {
      const r = starRadius(p.size);
      stars.push({ ...at[i], r, alpha: 0.35 + 0.65 * p.bright, colour: p.colour, label: p.label, labelY: k % 2 ? at[i].y - r - 10 : at[i].y + r + 24, room });
    });
  });
  const lines = [...mini.links].reverse().map((l): ChartLine => {
    const [from, to] = [at[l.from], at[l.to]];
    return { from, to, bend: (from.y + to.y) / 2 - (from.y === to.y ? 60 : 0), width: 0.8 + l.imports / 14 };
  });
  return { key: chartKey(mini), bands: mini.bands.map((b, i) => ({ ...b, y: heights[i] })), stars, lines };
}
