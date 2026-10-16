// How legible a drawing is where it's seen, measured from its SVG alone, so a test can hold every view to a budget
// (legibility.test.ts) rather than anyone noticing it's got hard to read. Pure.

/** The page width a drawing is shown in on a station's screen (page.ts: 1280 less its padding). */
export const SHOWN_AT = 1216;

/** What a scenario's sequence may hold and still be read at a glance, and the smallest text it may show. */
export const SEQUENCE_BUDGET = { lifelines: 7, steps: 8, smallestPx: 13 } as const;

export interface Legibility {
  /** Its drawn width, before it's shrunk to fit. */
  width: number;
  /** Its smallest text, in px as it's seen: shrunk with the drawing when it's wider than `shownAt`. */
  smallestPx: number;
  /** Texts cut short with an ellipsis. */
  cut: string[];
}

/** How `svg` reads when shown `shownAt` px wide, never blown up. */
export function legibility(svg: string, shownAt = SHOWN_AT): Legibility {
  const width = Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? shownAt);
  const scale = Math.min(1, shownAt / width);
  const sizes = [...svg.matchAll(/<text[^>]*\sfont-size="([\d.]+)"/g)].map((m) => Number(m[1]));
  const cut = [...svg.matchAll(/<text[^>]*>([^<]*…)<\/text>/g)].map((m) => m[1]);
  return { width, smallestPx: Math.round(Math.min(...sizes, Infinity) * scale * 10) / 10, cut };
}
