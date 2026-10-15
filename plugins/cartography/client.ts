// The cartography plugin in the browser (README.md): each project's architecture map on the engineering station, its
// views drawn by draw.ts, each with how to read it, and in sentences; and a screen per view in the project's holodeck.
import { pluginOn } from '../../shared/projectPlugins';
import { api } from '../../client/src/net/api';
import { state } from '../../client/src/net/state';
import { type ClientPlugin, pluginState } from '../../client/src/plugins';
import type { Ui } from '../../client/src/ui/context';
import { h } from '../../client/src/ui/dom';
import { hallMaps } from './hall';
import { viewBody } from './panel';
import { CARTOGRAPHY, type CartographyState, MODEL_FILE, type RepoMap } from './shared';
import { coverage, openingView, viewsOf } from './views';
import './cartography.css';

const maps = () => pluginState<CartographyState>(CARTOGRAPHY);

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
  const on = state.projects.filter((p) => pluginOn(p, CARTOGRAPHY));
  const off = state.projects.length - on.length;
  // the projects it's off for are only counted: switching it on is in each project's settings
  const offNote = off
    ? h('small', { class: 'muted' }, `Switched off for ${off} project${off === 1 ? '' : 's'}: switch Architecture map on in a project's settings (the manager's Projects tab) to map it.`)
    : null;
  return [...on.map((project) => {
    const remap = h('button', { class: 'btn small', onclick: () => void api.plugin(CARTOGRAPHY, '/map', { projectId: project.id }).catch((err: Error) => ui.error(err.message)) },
      now?.mapping.includes(project.id) ? 'Mapping…' : 'Map again');
    const repos = now?.maps[project.id];
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', { class: 'grow' }, project.name), remap),
      ...(repos ? repos.flatMap((m) => repoMap(m, open)) : [h('small', { class: 'muted' }, `Not mapped yet. Each repo keeps its model in ${MODEL_FILE}.`)]));
  }), ...(offNote ? [offNote] : [])];
}

const cartography: ClientPlugin = {
  id: CARTOGRAPHY,
  project: {
    label: 'Architecture map',
    about: `Maps the project's architecture from the model each repo keeps in ${MODEL_FILE}: on the engineering station, a screen per view in its holodeck, and its leads' map tool`,
  },
  engineering: {
    views: [
      {
        key: 'maps',
        label: 'Maps',
        readout: () => {
          const drift = Object.values(maps()?.maps ?? {}).flat().reduce((n, m) => n + m.problems.length, 0);
          return drift ? `${drift} DRIFT` : '';
        },
        standby: () => !state.projects.some((p) => pluginOn(p, CARTOGRAPHY)),
        render: (ui, _go, open) => projectMaps(ui, open),
      },
    ],
  },
  // a screen per view round the project's holodeck
  hall: (projectId) => hallMaps(maps()?.maps[projectId] ?? []),
};

export default cartography;
