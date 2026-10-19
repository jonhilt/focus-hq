// The cartography plugin in the browser (README.md): each project's architecture map on the engineering station, its
// views drawn by draw.ts, each with how to read it, and in sentences; and a stellar cartography screen in the
// project's holodeck, its map as a star chart, which takes you into the architecture space, where its views float
// round you.
import * as THREE from 'three';
import { callPlugin, canvasTexture, type ClientPlugin, h, Hologram, hover, makeCanvas, office, OVERLAY_LAYER, pluginOn, pluginState, type ShipHost, type ShipPart, type Ui } from '../../plugin-api/client';
import { drawChart } from './chart';
import { miniature, miniatureKey } from './miniature';
import { TIES_QUESTION } from './draw';
import { drawingBody, viewBody } from './panel';
import { CARTOGRAPHY, type CartographyState, MODEL_FILE, type RepoMap } from './shared';
import { NO_TIES, NOT_MAPPED, offNote, type ProjectCard, projectCard, SLICES_HEAD, type SliceView } from './shown';
import { ArchitectureSpace } from './space';
import { HALL_CHART, hallChart } from './spaceLayout';
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

/** What each goal under way does to a project's maps, each closed until the captain opens it. */
function sliceCards(slices: readonly SliceView[], open: Set<string>): HTMLElement[] {
  const cards = slices.map(({ slice, map, view, marks }) => {
    const id = `slice#${slice.leadId}#${map.repo}`;
    const details = h('details', { class: 'card', open: open.has(id), attrs: { 'data-key': id } },
      h('summary', null, h('span', { class: 'chip' }, `TS-${slice.station + 1}`), ' ', h('strong', null, view.question), h('small', { class: 'muted' }, ` · ${view.parts.length} parts · ${map.repo}`)),
      ...viewBody(map, view, marks));
    details.addEventListener('toggle', () => (details.open ? open.add(id) : open.delete(id)));
    return details;
  });
  return cards.length ? [h('small', { class: 'muted' }, SLICES_HEAD), ...cards] : [];
}

/** A project of more than one repo: what ties them together, closed until the captain opens it, or that nothing does yet. */
function tiesCard(projectId: string, ties: ProjectCard['ties'], open: Set<string>): HTMLElement[] {
  if (ties.kind === 'none') return [];
  if (ties.kind === 'unfound') return [h('small', { class: 'muted' }, NO_TIES)];
  const id = `ties#${projectId}`;
  const details = h('details', { class: 'card', open: open.has(id), attrs: { 'data-key': id } }, h('summary', null, h('strong', null, TIES_QUESTION), h('small', { class: 'muted' }, ` · ${ties.drawing.view.parts.length} parts`)), ...drawingBody(ties.drawing));
  details.addEventListener('toggle', () => (details.open ? open.add(id) : open.delete(id)));
  return [details];
}

function projectMaps(ui: Ui, open: Set<string>): HTMLElement[] {
  const now = maps();
  const on = office.projects.filter((p) => pluginOn(p, CARTOGRAPHY));
  // the projects it's off for are only counted: switching it on is in each project's settings
  const off = offNote(office.projects.length - on.length);
  return [...on.map((project) => {
    const card = projectCard(project, now);
    const remap = h('button', { class: 'btn small', onclick: () => void callPlugin(CARTOGRAPHY, '/map', { projectId: project.id }).catch((err: Error) => ui.error(err.message)) }, card.remap);
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', { class: 'grow' }, project.name), remap),
      ...tiesCard(project.id, card.ties, open),
      ...(card.repos ? card.repos.flatMap((m) => repoMap(m, open)) : [h('small', { class: 'muted' }, NOT_MAPPED)]),
      ...sliceCards(card.slices, open));
  }), ...(off ? [h('small', { class: 'muted' }, off)] : [])];
}

/** The chart's canvas. */
const CHART_PX = { w: 1280, h: 800 } as const;

/**
 * The architecture space, and a stellar cartography screen in the holodeck of each project it's on for, its map as a
 * star chart, to go there: built with the ship, so again whenever a project's switched on or off.
 */
function ship(host: ShipHost): ShipPart | null {
  const on = office.projects.filter((p) => pluginOn(p, CARTOGRAPHY));
  if (!on.length) return null;
  const space: ArchitectureSpace = new ArchitectureSpace(host.space(() => space.label()), host, maps);
  const spot = hallChart();
  const charts = on.flatMap((project) => {
    const hall = host.hall(project.id);
    if (!hall) return [];
    const { canvas, ctx } = makeCanvas(CHART_PX.w, CHART_PX.h);
    const texture = canvasTexture(canvas);
    const hologram = new Hologram(texture, HALL_CHART.aspect);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(HALL_CHART.width, HALL_CHART.width / HALL_CHART.aspect), hologram.material);
    mesh.position.set(spot.at.x, spot.at.y, spot.at.z);
    mesh.rotation.y = spot.yaw;
    // drawn over the outlines (frame.ts), like the holodeck's other screens; solid while you aim at it
    mesh.layers.set(OVERLAY_LAYER);
    mesh.userData.aim = (on: boolean) => (hologram.aimed = on);
    hall.mount(mesh);
    const back = { label: project.name, projectId: project.id, position: hall.toWorld(new THREE.Vector3(spot.back.at.x, 0, spot.back.at.z)), lookAt: hall.toWorld(new THREE.Vector3(spot.back.lookAt.x, spot.back.lookAt.y, spot.back.lookAt.z)), unlisted: true };
    host.interactive(mesh, () => `Step into stellar cartography: ${project.name}'s architecture`, (ui) => space.enter(ui, project.id, project.name, back), HALL_CHART.reach);
    return [{ project, mesh, hologram, texture, ctx, shown: '' }];
  });
  let checked = -Infinity;
  let last = 0;
  return {
    update: (t, camera) => {
      space.update(t, camera);
      const dt = Math.min(0.1, t - last);
      last = t;
      for (const c of charts) {
        hover(c.mesh, spot.at.y, t, 7);
        c.hologram.update(dt);
      }
      // each chart follows its project's maps
      if (t - checked < 1) return;
      checked = t;
      for (const c of charts) {
        const repos = maps()?.maps[c.project.id] ?? [];
        const key = miniatureKey(repos) || 'unmapped';
        if (key === c.shown) continue;
        c.shown = key;
        drawChart(c.ctx, CHART_PX.w, CHART_PX.h, c.project.name, miniature(repos));
        c.texture.needsUpdate = true;
      }
    },
    dispose: () => {
      space.dispose();
      for (const c of charts) {
        c.mesh.geometry.dispose();
        c.hologram.dispose();
        c.texture.dispose();
      }
    },
  };
}

const cartography: ClientPlugin = {
  id: CARTOGRAPHY,
  project: {
    label: 'Architecture map',
    about: `Maps the project's architecture from the model each repo keeps in ${MODEL_FILE}: on the engineering station, in a space you reach through the stellar cartography screen in its holodeck, and its leads' map tool`,
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
