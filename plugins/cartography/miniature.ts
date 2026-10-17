// A project's map in miniature, for the stellar cartography screen in its holodeck (chart.ts): pure, so it can be tested without a browser.
// Each layer is a band, one under the next in the order the model names its layers, each part a star along its band,
// placed beside the parts it uses and is used by, so the lines between them run short and you can follow one. A star
// is as big as its share of the code and as bright as its share of the commits, and only the heaviest imports are
// drawn, as thick as they are. Every repo's parts stand together, their layers joined by name.
import { layerColours } from './draw';
import type { RepoMap } from './shared';

/** Imports drawn: every one of at least `heavy`, and the `least` heaviest whatever they weigh. */
export const MINI_LINKS = { heavy: 5, least: 12 } as const;

export interface MiniPart {
  /** The repo and the part's id, and its name. */
  key: string;
  label: string;
  /** Its layer's band (0 the top), and where along it it stands, from 0 to 1. */
  band: number;
  at: number;
  /** Its share of the code and of the commits, each from 0 to 1 of the most any part has. */
  size: number;
  bright: number;
  colour: string;
}

export interface MiniLink {
  /** The places of the two parts in `parts`, the one that imports first. */
  from: number;
  to: number;
  imports: number;
}

export interface Miniature {
  /** Each band's layer and its colour, the top first. */
  bands: { layer: string; colour: string }[];
  parts: MiniPart[];
  /** The imports drawn, the heaviest first, and how many there are in all. */
  links: MiniLink[];
  imports: number;
}

/**
 * Where each part stands along its band: band by band, down then back up, each part moves to the mean place of the
 * parts it's tied to, weighed by how many imports, and its band's parts are spaced evenly in that order. Parts with
 * no ties keep their place, so with none at all the model's order stands.
 */
export function bandOrder(bands: readonly number[], ties: readonly MiniLink[], rounds = 12): number[] {
  const mineOf = (band: number) => bands.flatMap((b, i) => (b === band ? [i] : []));
  const at = bands.map((b, i) => {
    const mine = mineOf(b);
    return (mine.indexOf(i) + 0.5) / mine.length;
  });
  const order = [...new Set(bands)].sort((x, y) => x - y);
  const settle = (band: number) => {
    const pull = new Map(mineOf(band).map((i) => {
      let weight = 0;
      let sum = 0;
      for (const t of ties) {
        const other = t.from === i ? t.to : t.to === i ? t.from : -1;
        if (other < 0 || bands[other] === band) continue;
        weight += t.imports;
        sum += t.imports * at[other];
      }
      return [i, weight ? sum / weight : at[i]];
    }));
    const mine = [...pull.keys()].sort((x, y) => (pull.get(x) ?? 0) - (pull.get(y) ?? 0) || at[x] - at[y] || x - y);
    mine.forEach((i, k) => (at[i] = (k + 0.5) / mine.length));
  };
  for (let r = 0; r < rounds; r++) for (const band of r % 2 ? [...order].reverse() : order) settle(band);
  return at;
}

/** The miniature of `maps` (those with a model). */
export function miniature(maps: readonly RepoMap[]): Miniature {
  const drawn = maps.filter((m) => m.model && !m.error);
  const all = drawn.flatMap((m) =>
    (m.model?.parts ?? []).map((part) => ({ repo: m.repo, part, files: m.sizes[part.id] ?? 0, commits: m.history ? (m.history.parts.find((c) => c.id === part.id)?.commits ?? 0) : undefined })),
  );
  const colours = layerColours(all.map((a) => a.part));
  const layers = [...colours.keys()];
  const most = { files: Math.max(1, ...all.map((a) => a.files)), commits: Math.max(1, ...all.map((a) => a.commits ?? 0)) };
  const keys = all.map((a) => `${a.repo}#${a.part.id}`);
  const index = new Map(keys.map((k, i) => [k, i]));
  const every = drawn
    .flatMap((m) =>
      m.connections.flatMap((c): MiniLink[] => {
        const from = index.get(`${m.repo}#${c.from}`);
        const to = index.get(`${m.repo}#${c.to}`);
        return from === undefined || to === undefined || from === to ? [] : [{ from, to, imports: c.imports }];
      }),
    )
    .sort((x, y) => y.imports - x.imports);
  const bands = all.map((a) => layers.indexOf(a.part.layer));
  const at = bandOrder(bands, every);
  // with no history, or none of it touching a part, every part is as bright as can be: nothing says one is quieter
  const quiet = all.every((a) => !a.commits);
  const parts = all.map((a, i): MiniPart => ({
    key: keys[i],
    label: a.part.label,
    band: bands[i],
    at: at[i],
    size: Math.sqrt(a.files / most.files),
    bright: quiet ? 1 : (a.commits ?? 0) / most.commits,
    colour: colours.get(a.part.layer) ?? '#ffffff',
  }));
  const links = every.filter((l, i) => l.imports >= MINI_LINKS.heavy || i < MINI_LINKS.least);
  return { bands: layers.map((layer) => ({ layer, colour: colours.get(layer) ?? '#ffffff' })), parts, links, imports: every.length };
}

/** Changes whenever the miniature of `maps` would. */
export const miniatureKey = (maps: readonly RepoMap[]): string =>
  maps.map((m) => `${m.repo}@${m.commit ?? ''}:${m.model?.parts.length ?? 0}:${m.connections.length}:${m.history?.commits ?? 0}`).join('|');
