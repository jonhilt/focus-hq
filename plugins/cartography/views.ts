// A map's views as system models, so the studio's drawing (shared/modelDrawing.ts) lays them out. Pure, and free of
// Node, since the browser draws them.
import type { SystemModel } from '../../shared/types';
import type { MapView, RepoMap } from './shared';

/** The view every map has: all its parts. */
export const WHOLE: MapView = { id: 'whole', question: 'What are its parts, and which depend on which?', parts: [] };

/** A map's views, the whole of it first. */
export const viewsOf = (map: RepoMap): MapView[] => (map.model ? [{ ...WHOLE, parts: map.model.parts.map((p) => p.id) }, ...map.model.views] : []);

/** View `view` of `map` as a model: its parts, and the connections the code makes between them, labelled with their imports. */
export function viewModel(map: RepoMap, view: MapView): SystemModel {
  const shown = new Set(view.parts);
  const parts = (map.model?.parts ?? []).filter((p) => shown.has(p.id));
  return {
    question: view.question,
    nodes: parts.map((p) => ({ id: p.id, label: p.label, kind: p.kind, layer: p.layer, symbol: p.paths.length > 1 ? `${p.paths[0]} +${p.paths.length - 1}` : p.paths[0] })),
    edges: map.connections
      .filter((c) => shown.has(c.from) && shown.has(c.to))
      .map((c) => ({ from: c.from, to: c.to, kind: 'calls', label: `${c.imports} import${c.imports === 1 ? '' : 's'}` })),
    trace: [],
    simplified: [],
  };
}

/** The view a map opens on: its model's first, since the whole of a big map is more lines than anyone can follow. */
export const openingView = (map: RepoMap): string => map.model?.views[0]?.id ?? WHOLE.id;
