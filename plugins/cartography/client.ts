// The cartography plugin in the browser (README.md): each project's architecture map on the engineering station: its
// views drawn by draw.ts, each with how to read it, and in sentences.
import { api } from '../../client/src/net/api';
import { state } from '../../client/src/net/state';
import { type ClientPlugin, pluginState } from '../../client/src/plugins';
import type { Ui } from '../../client/src/ui/context';
import { h } from '../../client/src/ui/dom';
import { matrixExample, matrixSvg, viewSentences, viewSvg } from './draw';
import { CARTOGRAPHY, type CartographyState, MODEL_FILE, type MapView, type RepoMap } from './shared';
import { coverage, MATRIX_KEY, openingView, VIEW_KEY, viewsOf, WHOLE } from './views';

const maps = () => pluginState<CartographyState>(CARTOGRAPHY);

/** An SVG drawing, at its own size (readable), scrolling sideways when it's wider than the station. */
function drawing(svg: string): HTMLElement {
  const box = h('div', { class: 'cg-drawing' });
  box.innerHTML = svg;
  return box;
}

/** A view's body: the drawing, how to read it, and (for a view of a few parts) what it shows in sentences. */
function viewBody(map: RepoMap, view: MapView): HTMLElement[] {
  if (view.id === WHOLE.id) {
    const example = matrixExample(map);
    return [h('small', { class: 'muted' }, MATRIX_KEY, example ? ` ${example}` : ''), drawing(matrixSvg(map))];
  }
  return [h('small', { class: 'muted' }, VIEW_KEY), drawing(viewSvg(map, view)), h('ol', { class: 'cg-sentences' }, ...viewSentences(map, view).map((s) => h('li', null, s)))];
}

function repoMap(map: RepoMap, open: Set<string>): HTMLElement[] {
  const head = h('div', { class: 'row' }, h('strong', { class: 'grow' }, map.repo), map.commit ? h('small', { class: 'muted' }, map.commit.slice(0, 7)) : null);
  if (map.error) return [head, h('small', { class: 'muted' }, map.error)];
  const drift = map.problems.map((p) => h('div', null, h('span', { class: 'chip warn' }, 'drift'), ' ', p));
  const opening = openingView(map);
  const views = viewsOf(map).map((view) => {
    // the opening view starts open and the others closed: `open` keeps the ones the captain flipped
    const key = `${map.repo}#${view.id}`;
    const byDefault = view.id === opening;
    const details = h('details', { class: 'card', open: byDefault !== open.has(key), attrs: { 'data-key': key } },
      h('summary', null, h('strong', null, view.question), h('small', { class: 'muted' }, ` · ${view.parts.length} parts`)),
      ...viewBody(map, view));
    details.addEventListener('toggle', () => (details.open !== byDefault ? open.add(key) : open.delete(key)));
    return details;
  });
  return [head, h('small', { class: 'muted' }, coverage(map)), ...drift, ...views];
}

function projectMaps(ui: Ui, open: Set<string>): HTMLElement[] {
  const now = maps();
  return state.projects.map((project) => {
    const remap = h('button', { class: 'btn small', onclick: () => void api.plugin(CARTOGRAPHY, '/map', { projectId: project.id }).catch((err: Error) => ui.error(err.message)) },
      now?.mapping.includes(project.id) ? 'Mapping…' : 'Map again');
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
        render: (ui, _go, open) => projectMaps(ui, open),
      },
    ],
  },
};

export default cartography;
