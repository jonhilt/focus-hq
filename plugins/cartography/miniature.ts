// A project's map in miniature, for the stellar cartography screen in its holodeck (chart.ts): pure, so it can be tested without a browser.
// Each layer is a ring of its parts, one ring above the next in the order the model names its layers (the first on
// top), each part as big as its share of the code, and a line for each part that imports another. Every repo's parts
// stand together, their layers joined by name.
import { layerColours } from './draw';
import type { RepoMap } from './shared';

/** How big the miniature is: `radius` round its middle, its layers from `low` to `high` (the chart sees it from above). */
export const MINIATURE = { radius: 0.95, low: 0.2, high: 1.0, smallest: 0.05, biggest: 0.13 } as const;

export interface MiniPart {
  /** The repo and the part's id, and its name. */
  key: string;
  label: string;
  x: number;
  y: number;
  z: number;
  /** Its edge, in metres. */
  size: number;
  colour: string;
}

export interface Miniature {
  parts: MiniPart[];
  /** Each import between two parts, as the places of the two in `parts`. */
  links: [number, number][];
}

/** The miniature of `maps` (those with a model). */
export function miniature(maps: readonly RepoMap[]): Miniature {
  const drawn = maps.filter((m) => m.model && !m.error);
  const all = drawn.flatMap((m) => (m.model?.parts ?? []).map((part) => ({ repo: m.repo, part, files: m.sizes[part.id] ?? 0 })));
  const colours = layerColours(all.map((a) => a.part));
  const layers = [...colours.keys()];
  const most = Math.max(1, ...all.map((a) => a.files));
  const parts: MiniPart[] = [];
  layers.forEach((layer, l) => {
    const ring = all.filter((a) => a.part.layer === layer);
    const y = layers.length === 1 ? (MINIATURE.low + MINIATURE.high) / 2 : MINIATURE.high - (l / (layers.length - 1)) * (MINIATURE.high - MINIATURE.low);
    // the rings grow outwards as they go down, so each can be seen past the one above
    const r = ring.length === 1 ? 0 : MINIATURE.radius * (0.45 + (0.5 * l) / Math.max(1, layers.length - 1));
    ring.forEach((a, i) => {
      const angle = (i / ring.length) * Math.PI * 2 + l * 0.6;
      const size = MINIATURE.smallest + (MINIATURE.biggest - MINIATURE.smallest) * Math.sqrt(a.files / most);
      parts.push({ key: `${a.repo}#${a.part.id}`, label: a.part.label, x: r * Math.cos(angle), y, z: r * Math.sin(angle), size, colour: colours.get(layer) ?? '#ffffff' });
    });
  });
  const at = new Map(parts.map((p, i) => [p.key, i]));
  const links = drawn.flatMap((m) =>
    m.connections.flatMap((c): [number, number][] => {
      const from = at.get(`${m.repo}#${c.from}`);
      const to = at.get(`${m.repo}#${c.to}`);
      return from === undefined || to === undefined || from === to ? [] : [[from, to]];
    }),
  );
  return { parts, links };
}

/** Changes whenever the miniature of `maps` would. */
export const miniatureKey = (maps: readonly RepoMap[]): string =>
  maps.map((m) => `${m.repo}@${m.commit ?? ''}:${m.model?.parts.length ?? 0}:${m.connections.length}`).join('|');
