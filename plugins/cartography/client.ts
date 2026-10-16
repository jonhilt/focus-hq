// The cartography plugin in the browser (README.md): each project's architecture map on the engineering station, its
// views drawn by draw.ts, each with how to read it, and in sentences; and an astrometrics table in the project's
// holodeck, its map in miniature, which takes you into the architecture space, where its views float round you.
import * as THREE from 'three';
import { callPlugin, type ClientPlugin, h, office, pluginOn, pluginState, type ShipHost, type ShipPart, type Ui } from '../../plugin-api/client';
import { miniature, miniatureKey } from './miniature';
import { TIES_KEY, TIES_QUESTION, tiesDrawing } from './draw';
import { drawingBody, viewBody } from './panel';
import { CARTOGRAPHY, type CartographyState, MODEL_FILE, type RepoMap } from './shared';
import { ArchitectureSpace } from './space';
import { sliceViews } from './slice';
import { hallTable } from './spaceLayout';
import { AstrometricsTable, TABLE } from './table';
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
  const on = office.projects.filter((p) => pluginOn(p, CARTOGRAPHY));
  const off = office.projects.length - on.length;
  // the projects it's off for are only counted: switching it on is in each project's settings
  const offNote = off
    ? h('small', { class: 'muted' }, `Switched off for ${off} project${off === 1 ? '' : 's'}: switch Architecture map on in a project's settings (the manager's Projects tab) to map it.`)
    : null;
  return [...on.map((project) => {
    const remap = h('button', { class: 'btn small', onclick: () => void callPlugin(CARTOGRAPHY, '/map', { projectId: project.id }).catch((err: Error) => ui.error(err.message)) },
      now?.mapping.includes(project.id) ? 'Mapping…' : 'Map again');
    const repos = now?.maps[project.id];
    // what each goal under way does to it, each closed until the captain opens it
    const slices = sliceViews(now?.slices[project.id] ?? [], repos ?? []).map(({ slice, map, view, marks }) => {
      const id = `slice#${slice.leadId}#${map.repo}`;
      const details = h('details', { class: 'card', open: open.has(id), attrs: { 'data-key': id } },
        h('summary', null, h('span', { class: 'chip' }, `TS-${slice.station + 1}`), ' ', h('strong', null, view.question), h('small', { class: 'muted' }, ` · ${view.parts.length} parts · ${map.repo}`)),
        ...viewBody(map, view, marks));
      details.addEventListener('toggle', () => (details.open ? open.add(id) : open.delete(id)));
      return details;
    });
    // a project of more than one repo: what ties them together
    const ties = tiesDrawing(repos ?? [], now?.crossRepo[project.id] ?? [], now?.crossCalls[project.id] ?? []);
    const tied = (() => {
      if (project.repos.length < 2 || !repos) return [];
      if (!ties) return [h('small', { class: 'muted' }, `Nothing ties its repos together yet: neither calls a route the other declares, nor do they change together often enough to say. ${TIES_KEY}`)];
      const id = `ties#${project.id}`;
      const details = h('details', { class: 'card', open: open.has(id), attrs: { 'data-key': id } }, h('summary', null, h('strong', null, TIES_QUESTION), h('small', { class: 'muted' }, ` · ${ties.view.parts.length} parts`)), ...drawingBody(ties));
      details.addEventListener('toggle', () => (details.open ? open.add(id) : open.delete(id)));
      return [details];
    })();
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', { class: 'grow' }, project.name), remap),
      ...tied,
      ...(repos ? repos.flatMap((m) => repoMap(m, open)) : [h('small', { class: 'muted' }, `Not mapped yet. Each repo keeps its model in ${MODEL_FILE}.`)]),
      ...(slices.length ? [h('small', { class: 'muted' }, 'Goals under way, and what each slice does to the architecture so far:'), ...slices] : []));
  }), ...(offNote ? [offNote] : [])];
}

/**
 * The architecture space, and an astrometrics table in the holodeck of each project it's on for, its map in
 * miniature, to go there: built with the ship, so again whenever a project's switched on or off.
 */
function ship(host: ShipHost): ShipPart | null {
  const on = office.projects.filter((p) => pluginOn(p, CARTOGRAPHY));
  if (!on.length) return null;
  const space: ArchitectureSpace = new ArchitectureSpace(host.space(() => space.label()), host, maps);
  const spot = hallTable();
  const tables = on.flatMap((project) => {
    const hall = host.hall(project.id);
    if (!hall) return [];
    const table = new AstrometricsTable();
    table.group.position.set(spot.at.x, spot.at.y, spot.at.z);
    hall.mount(table.group);
    const at = hall.toWorld(new THREE.Vector3(spot.at.x, 0, spot.at.z));
    const r = TABLE.radius * 0.8;
    host.collide({ minX: at.x - r, maxX: at.x + r, minZ: at.z - r, maxZ: at.z + r });
    const back = { label: project.name, projectId: project.id, position: hall.toWorld(new THREE.Vector3(spot.back.at.x, 0, spot.back.at.z)), lookAt: hall.toWorld(new THREE.Vector3(spot.back.lookAt.x, spot.back.lookAt.y, spot.back.lookAt.z)), unlisted: true };
    host.interactive(table.group, () => `Step into the map: ${project.name}'s architecture`, (ui) => space.enter(ui, project.id, project.name, back));
    return [{ projectId: project.id, table, shown: '' }];
  });
  let checked = -Infinity;
  return {
    update: (t, camera) => {
      space.update(t, camera);
      for (const { table } of tables) table.update(t);
      // each table's miniature follows its project's maps
      if (t - checked < 1) return;
      checked = t;
      for (const at of tables) {
        const repos = maps()?.maps[at.projectId] ?? [];
        const key = miniatureKey(repos);
        if (key === at.shown) continue;
        at.shown = key;
        at.table.show(miniature(repos));
      }
    },
    dispose: () => {
      space.dispose();
      for (const { table } of tables) table.dispose();
    },
  };
}

const cartography: ClientPlugin = {
  id: CARTOGRAPHY,
  project: {
    label: 'Architecture map',
    about: `Maps the project's architecture from the model each repo keeps in ${MODEL_FILE}: on the engineering station, in a space you reach through the astrometrics table in its holodeck, and its leads' map tool`,
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
        standby: () => !office.projects.some((p) => pluginOn(p, CARTOGRAPHY)),
        render: (ui, _go, open) => projectMaps(ui, open),
      },
    ],
  },
  ship,
};

export default cartography;
