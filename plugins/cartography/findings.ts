// Where to look on the whole map (README.md): the dependency matrix is every connection at once, accurate but with no
// "so what", so it heads with a few findings, the worst first, each said in a sentence and numbered on the cells it's
// about. Three kinds, from the imports and the history the map already has. Pure.
import type { RepoMap } from './shared';

/** How many findings the matrix heads with. */
export const FINDINGS_MAX = 5;
/** A part imported by at least this many others is a hub. */
const HUB = 3;

/** One thing worth a look on the whole map, and the matrix cells (row part, column part) it's about. */
export interface Finding {
  kind: 'tangle' | 'ripple' | 'hidden';
  sentence: string;
  cells: { from: string; to: string }[];
  /** How bad it is, to order them: the worst first. */
  weight: number;
}

const times = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The whole map's findings, the worst first, at most FINDINGS_MAX, with no more than two of a kind before every kind
 * has had one:
 * - a tangle: two parts that import each other, so a change to either tends to need the other;
 * - a ripple: a part many others import (a hub) that changes often, so its changes reach furthest;
 * - a hidden tie: two parts that keep changing together with no import between them, so what ties them isn't on the map.
 */
export function findings(map: RepoMap): Finding[] {
  const label = (id: string) => map.model?.parts.find((p) => p.id === id)?.label ?? id;
  const at = new Map(map.connections.map((c) => [`${c.from} ${c.to}`, c]));
  const tangles = map.connections
    .filter((c) => c.from < c.to && at.has(`${c.to} ${c.from}`))
    .map((c): Finding => {
      const back = at.get(`${c.to} ${c.from}`)?.imports ?? 0;
      return {
        kind: 'tangle',
        sentence: `${label(c.from)} and ${label(c.to)} import each other (${c.imports} one way, ${back} back): a change to either tends to need the other.`,
        cells: [{ from: c.from, to: c.to }, { from: c.to, to: c.from }],
        weight: Math.min(c.imports, back),
      };
    });
  const changed = new Map((map.history?.parts ?? []).map((p) => [p.id, p.commits]));
  const importers = (id: string) => map.connections.filter((c) => c.to === id);
  const ripples = (map.model?.parts ?? [])
    .map((p) => ({ part: p.id, by: importers(p.id), commits: changed.get(p.id) ?? 0 }))
    .filter((r) => r.by.length >= HUB && r.commits > 0)
    .map((r): Finding => ({
      kind: 'ripple',
      sentence: `${label(r.part)} is imported by ${r.by.length} parts and changed in ${times(r.commits, 'commit')} in ${map.history?.days ?? 0} days: its changes reach furthest.`,
      cells: r.by.map((c) => ({ from: c.from, to: r.part })),
      weight: (r.by.length * r.commits) / 10,
    }));
  // a recorded run may say what ties them: they talk over the wire, which the matrix (imports only) doesn't show
  const talk = (a: string, b: string) => (map.flows ?? []).some((f) => (f.from === a && f.to === b) || (f.from === b && f.to === a));
  const hidden = (map.history?.coupling ?? [])
    .filter((c) => !c.imports)
    .map((c): Finding => ({
      kind: 'hidden',
      sentence: `${label(c.a)} and ${label(c.b)} changed together in ${c.together} of ${times(c.either, 'commit')} with no import between them: ${talk(c.a, c.b) ? 'they talk over the wire, which this grid doesn’t show' : 'what ties them isn’t on the map'}.`,
      cells: [{ from: c.a, to: c.b }],
      weight: c.together,
    }));
  const each = [tangles, ripples, hidden].map((list) => [...list].sort((a, b) => b.weight - a.weight));
  // the worst of each kind first, then the rest by weight
  const firsts = each.flatMap((list) => list.slice(0, 1)).sort((a, b) => b.weight - a.weight);
  const rest = each.flatMap((list) => list.slice(1, 2)).sort((a, b) => b.weight - a.weight);
  return [...firsts, ...rest].slice(0, FINDINGS_MAX);
}

/** The whole map's headline, in a line: how big it is, and how many of each finding there are. */
export function headline(map: RepoMap): string {
  const parts = map.model?.parts.length ?? 0;
  const tangled = map.connections.filter((c) => c.from < c.to && map.connections.some((d) => d.from === c.to && d.to === c.from)).length;
  const hidden = (map.history?.coupling ?? []).filter((c) => !c.imports).length;
  const said = [
    tangled ? `${times(tangled, 'pair')} ${tangled === 1 ? 'imports' : 'import'} each other` : 'no two parts import each other',
    ...(hidden ? [`${times(hidden, 'pair')} ${hidden === 1 ? 'changes' : 'change'} together with no import between them`] : []),
  ];
  return `${times(parts, 'part')}, ${times(map.connections.length, 'connection')}: ${said.join('; ')}.`;
}
