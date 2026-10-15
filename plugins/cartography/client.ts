// The cartography plugin in the browser (README.md): each project's architecture map on the engineering station, a
// view at a time, drawn as the studio draws its models.
import { structureView, toSvg } from '../../shared/modelDrawing';
import { api } from '../../client/src/net/api';
import { state } from '../../client/src/net/state';
import { type ClientPlugin, pluginState } from '../../client/src/plugins';
import type { Ui } from '../../client/src/ui/context';
import { h } from '../../client/src/ui/dom';
import { CARTOGRAPHY, type CartographyState, MODEL_FILE, type RepoMap } from './shared';
import { openingView, viewModel, viewsOf } from './views';

const maps = () => pluginState<CartographyState>(CARTOGRAPHY);

/** A view drawn as an SVG, scrolling sideways when it's wider than the station. */
function drawn(svg: string): HTMLElement {
  const box = h('div', { class: 'model-view' });
  box.innerHTML = svg;
  return box;
}

function repoMap(map: RepoMap, open: Set<string>): HTMLElement[] {
  const head = h('div', { class: 'row' },
    h('strong', { class: 'grow' }, map.repo),
    map.commit ? h('small', { class: 'muted' }, map.commit.slice(0, 7)) : null);
  if (map.error) return [head, h('small', { class: 'muted' }, map.error)];
  const share = map.files ? Math.round((map.mapped / map.files) * 100) : 0;
  const summary = h('small', { class: 'muted' }, `${map.model?.parts.length ?? 0} parts own ${map.mapped} of ${map.files} source files (${share}%) · ${map.connections.length} connections, from its imports`);
  const problems = map.problems.length
    ? h('div', null, ...map.problems.map((p) => h('div', null, h('span', { class: 'chip warn' }, 'drift'), ' ', p)))
    : null;
  const opening = openingView(map);
  const views = viewsOf(map).map((view) => {
    // the opening view starts open and the others closed: `open` keeps the ones the captain flipped
    const key = `${map.repo}#${view.id}`;
    const byDefault = view.id === opening;
    const details = h('details', { class: 'card', open: byDefault !== open.has(key), attrs: { 'data-key': key } },
      h('summary', null, h('strong', null, view.question), h('small', { class: 'muted' }, ` · ${view.parts.length} parts`)),
      drawn(toSvg(structureView(viewModel(map, view)))));
    details.addEventListener('toggle', () => (details.open !== byDefault ? open.add(key) : open.delete(key)));
    return details;
  });
  return [head, summary, problems, ...views].filter((el): el is HTMLElement => !!el);
}

function mapsView(ui: Ui, open: Set<string>): HTMLElement[] {
  const now = maps();
  return state.projects.map((project) => {
    const mapping = now?.mapping.includes(project.id);
    const remap = h('button', {
      class: 'btn small',
      onclick: () => void api.plugin(CARTOGRAPHY, '/map', { projectId: project.id }).catch((err: Error) => ui.error(err.message)),
    }, mapping ? 'Mapping…' : 'Map again');
    const repos = now?.maps[project.id];
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', { class: 'grow' }, project.name), remap),
      ...(repos ? repos.flatMap((m) => repoMap(m, open)) : [h('small', { class: 'muted' }, `Not mapped yet. Each repo keeps its model in ${MODEL_FILE}.`)]));
  });
}

const cartography: ClientPlugin = {
  id: CARTOGRAPHY,
  engineering: {
    views: [
      {
        key: 'maps',
        label: 'Maps',
        readout: () => {
          const drift = Object.values(maps()?.maps ?? {}).flat().reduce((n, m) => n + m.problems.length, 0);
          return drift ? `${drift} DRIFT` : '';
        },
        standby: () => !Object.keys(maps()?.maps ?? {}).length,
        render: (ui, _go, open) => mapsView(ui, open),
      },
    ],
  },
};

export default cartography;
