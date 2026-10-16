// What a goal's slice does to the architecture (README.md): its lead's checkout against the map of the default branch.
// Which parts its changed files fall in, which parts its model adds or drops, and which imports between parts it
// makes or breaks. Pure: server.ts runs git and maps the checkout.
import { isSource, ownerOf } from './graph';
import type { Marks } from './draw';
import type { GoalSlice, MapConnection, MapView, RepoMap, SliceChange } from './shared';

/** A file the slice changed, and how many lines (added and removed; 0 for a new file not yet counted, or a binary one). */
export interface ChangedFile {
  path: string;
  lines: number;
}

/** `git diff --numstat` read: each file changed, and its lines. */
export function readNumstat(text: string): ChangedFile[] {
  return text
    .split('\n')
    .map((line) => /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line))
    .filter((m): m is RegExpExecArray => !!m)
    .map(([, added, removed, path]) => ({ path, lines: (Number(added) || 0) + (Number(removed) || 0) }));
}

const pairOf = (c: Pick<MapConnection, 'from' | 'to'>) => `${c.from} ${c.to}`;

/** What `branch` (a lead's checkout, with `changed` files) does to `main` (the default branch's map). */
export function sliceChange(main: RepoMap, branch: RepoMap, changed: readonly ChangedFile[]): SliceChange {
  const touched = new Map<string, { part: string; files: number; lines: number }>();
  const unowned: string[] = [];
  for (const file of changed) {
    if (!isSource(file.path)) continue;
    const part = branch.model && ownerOf(file.path, branch.model);
    if (!part) {
      unowned.push(file.path);
      continue;
    }
    const t = touched.get(part) ?? { part, files: 0, lines: 0 };
    t.files++;
    t.lines += file.lines;
    touched.set(part, t);
  }
  const ids = (m: RepoMap) => new Set((m.model?.parts ?? []).map((p) => p.id));
  const [before, after] = [ids(main), ids(branch)];
  const pairs = (m: RepoMap) => new Set(m.connections.map(pairOf));
  const [was, is] = [pairs(main), pairs(branch)];
  return {
    repo: branch.repo,
    touched: [...touched.values()].sort((a, b) => b.lines - a.lines || b.files - a.files || a.part.localeCompare(b.part)),
    unowned,
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
    gained: branch.connections.filter((c) => !was.has(pairOf(c))),
    lost: main.connections.filter((c) => !is.has(pairOf(c))),
  };
}

/** Whether a slice changes anything a map can show. */
export const changesAnything = (c: SliceChange): boolean => !!(c.touched.length || c.added.length || c.removed.length || c.gained.length || c.lost.length);

/** The most parts a slice's view shows: the ones it touches most, then those its new and lost imports run between. */
export const SLICE_PARTS = 9;

/**
 * The view of a slice: the parts it touches (the most lines first), the parts it adds, and those its gained and lost
 * imports run between, at most SLICE_PARTS; and the map to draw it on, the branch's, with the imports it lost put back
 * (and the parts they ran between, should the branch have dropped them) so the drawing can show them going.
 */
export function sliceView(main: RepoMap, branch: RepoMap, change: SliceChange, question: string): { map: RepoMap; view: MapView } {
  const ends = [...change.gained, ...change.lost].flatMap((c) => [c.from, c.to]);
  const parts = [...new Set([...change.touched.map((t) => t.part), ...change.added, ...ends, ...change.removed])].slice(0, SLICE_PARTS);
  const kept = new Set((branch.model?.parts ?? []).map((p) => p.id));
  const gone = (main.model?.parts ?? []).filter((p) => !kept.has(p.id));
  const model = branch.model && { ...branch.model, parts: [...branch.model.parts, ...gone] };
  return { map: { ...branch, model, connections: [...branch.connections, ...change.lost] }, view: { id: `slice-${branch.repo}`, question, parts } };
}

/** What `change` marks on its view. */
export function marksOf(change: SliceChange): Marks {
  const pairs = (cs: readonly MapConnection[]) => new Set(cs.map(pairOf));
  return { touched: new Map(change.touched.map((t) => [t.part, t.lines])), added: new Set(change.added), removed: new Set(change.removed), gained: pairs(change.gained), lost: pairs(change.lost) };
}

/** Each goal's slice as views, one per repo it changes, against the project's maps `mains`: what to draw, and a key that changes when it does. */
export function sliceViews(slices: readonly GoalSlice[], mains: readonly RepoMap[]): { slice: GoalSlice; map: RepoMap; view: MapView; marks: Marks; key: string }[] {
  return slices.flatMap((slice) =>
    slice.repos.flatMap(({ change, branch }) => {
      const main = mains.find((m) => m.repo === change.repo);
      if (!main) return [];
      const { map, view } = sliceView(main, branch, change, `What does “${slice.heading ?? slice.title}” change?`);
      return [{ slice, map, view, marks: marksOf(change), key: `${slice.leadId}|${change.repo}|${slice.at}` }];
    }),
  );
}
