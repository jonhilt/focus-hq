// A map's views, and what the Maps view says about a map in words. Pure, and free of Node, since the browser shows them.
import type { MapView, RepoMap } from './shared';

/** The view every map has: all its parts, drawn as a matrix (draw.ts). */
export const WHOLE: MapView = { id: 'whole', question: 'What are its parts, and which depend on which?', parts: [] };

/** The view a map with a history has: how its parts have changed, and which change together. */
export const CHANGES: MapView = { id: 'changes', question: 'Where does the code change, and what changes with what?', parts: [] };

/** The views every map has, by the model's say or the history's, not the model's own. */
export const isBuiltIn = (view: MapView): boolean => view.id === WHOLE.id || view.id === CHANGES.id;

/** A map's views: the whole of it first, then how it changes (with a history), then the model's own. */
export function viewsOf(map: RepoMap): MapView[] {
  if (!map.model) return [];
  const every = map.model.parts.map((p) => p.id);
  return [{ ...WHOLE, parts: every }, ...(map.history ? [{ ...CHANGES, parts: every }] : []), ...map.model.views];
}

/** The view a map opens on: its model's first, since the whole of a big map is a lot to take in first. */
export const openingView = (map: RepoMap): string => map.model?.views[0]?.id ?? WHOLE.id;

/** How much of the repo the map covers, in a line. */
export function coverage(map: RepoMap): string {
  const share = map.files ? Math.round((map.mapped / map.files) * 100) : 0;
  const flows = map.flows ? ` · ${map.flows.length} flows, from ${map.flowsRun?.run ?? 'a recorded run'}${map.flowsRun?.commit ? ` (at ${map.flowsRun.commit.slice(0, 7)})` : ''}` : '';
  return `${map.model?.parts.length ?? 0} parts own ${map.mapped} of ${map.files} source files (${share}%) · ${map.connections.length} connections, read from the imports${flows}`;
}

/** How to read a view, under its question. */
export const VIEW_KEY =
  'An arrow goes from a part to a part whose code it uses, labelled with how many imports: the thicker, the more. A dashed gold one is what a part sends another as it runs, labelled with how many messages in a recorded run. Point at one, or find its number below, for what crosses it.';
export const MATRIX_KEY = 'Each row imports from the columns it has a number in: the number is how many imports. Orange: two parts that import each other.';
export const CHANGES_KEY =
  'From git: each part\'s commits over time as a line, every line on one scale, the latest a gold dot, the busiest part first. Beside it, the parts that keep changing together; in gold, those with no import between them, whose tie the map\'s arrows don\'t show.';

/**
 * A project's views in its architecture space, in the order they're placed (spaceLayout.ts): each repo's whole map
 * first (the first straight ahead), then every repo's own views, the questions someone chose to ask, then how each repo
 * changes.
 */
export function spaceViews(maps: readonly RepoMap[]): { map: RepoMap; view: MapView }[] {
  const drawn = maps.filter((m) => m.model && !m.error);
  const each = drawn.map((map) => viewsOf(map).map((view) => ({ map, view })));
  const of = (id: string) => each.flatMap((views) => views.filter((v) => v.view.id === id));
  return [...of(WHOLE.id), ...each.flatMap((views) => views.filter((v) => !isBuiltIn(v.view))), ...of(CHANGES.id)];
}

/** What a view's screen shows changes only with the commit it was mapped from and the view itself. */
export const screenVersion = (map: RepoMap, view: MapView): string =>
  `${map.commit ?? ''}|${view.id}|${view.parts.join(',')}|${map.connections.length}|${map.flows?.length ?? 0}|${map.history?.commits ?? 0}`;

/** Where a drawing `w` × `h` goes in `box`, as big as fits without stretching, in the middle. */
export function fitInto(w: number, h: number, box: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(box.w / w, box.h / h);
  return { x: box.x + (box.w - w * scale) / 2, y: box.y + (box.h - h * scale) / 2, w: w * scale, h: h * scale };
}

/** What the map tool says when asked for the views: each repo's, with its question, or why it has none. */
export function viewList(maps: readonly RepoMap[]): string {
  return maps
    .map((map) => {
      if (map.error || !map.model) return `${map.repo}: no views (${map.error ?? 'no model'}).`;
      const said = (v: MapView) =>
        v.id === WHOLE.id ? 'every part, as a dependency matrix' : v.id === CHANGES.id ? `how its parts changed in git over ${map.history?.days ?? 0} days, and which change together` : `${v.question} (${v.parts.length} parts)`;
      const lines = viewsOf(map).map((v) => `- ${v.id}: ${said(v)}`);
      return `${map.repo}'s views:\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

/** The view with id `id` in one of `maps`: the first repo with one, or why there's none. */
export function pickView(maps: readonly RepoMap[], id: string): { map: RepoMap; view: MapView } | { error: string } {
  const found = maps.flatMap((map) => viewsOf(map).filter((v) => v.id === id).map((view) => ({ map, view })));
  if (!found.length) return { error: `There's no view "${id}".` };
  if (found.length > 1) return { error: `More than one repo has a view "${id}": say which with repo (${found.map((f) => f.map.repo).join(', ')}).` };
  return found[0];
}

/** A view's question as a screen's title, which has at most `max` characters: cut short with an ellipsis when it's longer. */
export const screenTitle = (question: string, max: number): string => (question.length <= max ? question : `${question.slice(0, max - 1).trimEnd()}…`);
