// The astrometrics plugin in the browser (README.md): a screen in the holodeck of each project it's on for, showing one
// of the office's state machines with where that project's runs of it are now, lit; E on it opens it up close, with a
// tab for each machine to toggle through, and the screen follows the one picked.
import * as THREE from 'three';
import { callPlugin, canvasTexture, type ClientPlugin, h, Hologram, hover, type MachineRun, type MachineStep, makeCanvas, office, onPluginState, OVERLAY_LAYER, pluginOn, pluginState, type ShipHost, type ShipPart, timeAgo, type Ui } from '../../plugin-api/client';
import { INK, machineSvg } from './draw';
import { ASTROMETRICS, type Astrometrics, type MachineLayout } from './shared';
import { HALL_MACHINES, hallMachines } from './spot';
import { closeUpView, drawDue, fit, followedRun, type ScreenView, screenView, tabs, trailSteps } from './view';
import './astrometrics.css';

const now = () => pluginState<Astrometrics>(ASTROMETRICS);

/** The machine picked, by id: the holodecks' screens all show it, and up close opens on it. */
let picked = 'run';

/** An SVG drawing as an image, to draw on a canvas. */
async function image(svg: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

async function drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number, view: ScreenView): Promise<void> {
  ctx.fillStyle = INK.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK.lit;
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.fillText(view.title, 48, 32, w - 96);
  ctx.fillStyle = INK.label;
  ctx.font = '24px system-ui, sans-serif';
  ctx.fillText(view.sub, 48, 86, w - 96);
  if (!view.layout) return;
  const img = await image(machineSvg(view.layout, view.runs));
  const at = fit(img.naturalWidth, img.naturalHeight, { x: 32, y: 136, w: w - 64, h: h - 160 });
  ctx.drawImage(img, at.x, at.y, at.w, at.h);
}

/** The machine's runs in the project, each a button to follow its trail (the one followed on). */
function runButtons(layout: MachineLayout, runs: readonly MachineRun[], followed: string | undefined, follow: (key: string | undefined) => void): HTMLElement {
  if (!runs.length) return h('p', { class: 'muted' }, `No ${layout.runs} in this project is in this machine now.`);
  return h('div', { class: 'am-runs' },
    h('small', { class: 'muted' }, `Follow a ${layout.runs}’s trail: `),
    ...runs.map((r) => h('button', { class: `btn small${r.key === followed ? ' on' : ''}`, onclick: () => follow(r.key === followed ? undefined : r.key) }, `${r.label} · ${r.state}`)));
}

/** A followed run's last steps, numbered as its trail is, with when. */
function timeline(run: MachineRun, steps: readonly MachineStep[]): HTMLElement {
  return h('div', null, h('strong', null, `${run.label}’s last steps`), h('ol', { class: 'am-trail' },
    ...trailSteps(steps).map((s) => h('li', null, h('span', { class: 'am-n' }, String(s.n)), ' ', h('code', null, s.state), ' ', h('small', { class: 'muted' }, s.t ? timeAgo(s.t) : '')))));
}

/** The machines up close, on `projectId`'s runs: a tab each, the one picked drawn large, and its runs to follow. */
function closeUp(ui: Ui, projectId: string): void {
  const body = h('div', { class: 'am-close-up' });
  let followed: string | undefined;
  let steps: MachineStep[] = [];
  const pick = (id: string) => {
    picked = id;
    void load();
  };
  const follow = (key: string | undefined) => {
    followed = key;
    void load();
  };
  // the followed run's path, read afresh whenever it might have moved
  // only the latest load draws: an earlier one answering late would put back a trail that's moved on
  let loads = 0;
  const load = async () => {
    const mine = ++loads;
    const run = followedRun(screenView(now(), picked, projectId).runs, followed);
    const path = run ? await callPlugin<MachineStep[]>(ASTROMETRICS, '/path', { machine: run.machine, key: run.key }).catch(() => []) : [];
    if (mine !== loads) return;
    steps = path;
    render();
  };
  const render = () => {
    const view = closeUpView(now(), picked, projectId, followed, steps);
    if (!view.layout) {
      body.replaceChildren(h('p', { class: 'muted' }, view.sub));
      return;
    }
    const buttons = tabs(now(), picked, projectId).map((t) => h('button', { class: `btn small${t.on ? ' on' : ''}`, onclick: () => pick(t.id) }, t.label));
    const drawing = h('div', { class: 'am-drawing' });
    drawing.innerHTML = machineSvg(view.layout, view.lit, view.trail);
    body.replaceChildren(h('div', { class: 'am-tabs' }, ...buttons), h('p', { class: 'muted' }, view.layout.about), runButtons(view.layout, view.runs, view.run?.key, follow), drawing, ...(view.run ? [timeline(view.run, view.trail)] : []));
  };
  render();
  const project = office.project(projectId);
  ui.panels.open({ title: `State machines${project ? ` · ${project.name}` : ''}`, full: true, body });
  // it follows the runs while it's open
  ui.panels.own(onPluginState(ASTROMETRICS, () => void load()));
}

/** The screen's canvas. */
const SCREEN_PX = { w: 1280, h: 800 } as const;

/** A screen in the holodeck of each project it's on for, over the pull request rack: built with the ship. */
function ship(host: ShipHost): ShipPart | null {
  const on = office.projects.filter((p) => pluginOn(p, ASTROMETRICS));
  if (!on.length) return null;
  const spot = hallMachines();
  const screens = on.flatMap((project) => {
    const hall = host.hall(project.id);
    if (!hall) return [];
    const { canvas, ctx } = makeCanvas(SCREEN_PX.w, SCREEN_PX.h);
    const texture = canvasTexture(canvas);
    const hologram = new Hologram(texture, HALL_MACHINES.aspect);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(HALL_MACHINES.width, HALL_MACHINES.width / HALL_MACHINES.aspect), hologram.material);
    mesh.position.set(spot.at.x, spot.at.y, spot.at.z);
    mesh.rotation.y = spot.yaw;
    // drawn over the outlines (frame.ts), like the holodeck's other screens; solid while you aim at it
    mesh.layers.set(OVERLAY_LAYER);
    mesh.userData.aim = (aimed: boolean) => (hologram.aimed = aimed);
    hall.mount(mesh);
    host.interactive(mesh, () => 'Look at the ship’s state machines', (ui) => closeUp(ui, project.id), HALL_MACHINES.reach);
    return [{ projectId: project.id, mesh, hologram, texture, ctx, shown: '', drawing: false }];
  });
  type Screen = (typeof screens)[number];
  const redraw = (s: Screen) => {
    const view = screenView(now(), picked, s.projectId);
    if (!drawDue(s, view.version)) return;
    s.shown = view.version;
    s.drawing = true;
    void drawScreen(s.ctx, SCREEN_PX.w, SCREEN_PX.h, view)
      .then(() => (s.texture.needsUpdate = true), (err: unknown) => console.error('The machines’ screen:', err))
      .finally(() => (s.drawing = false));
  };
  let checked = -Infinity;
  let last = 0;
  return {
    update: (t) => {
      const dt = Math.min(0.1, t - last);
      last = t;
      for (const s of screens) {
        hover(s.mesh, spot.at.y, t, 5);
        s.hologram.update(dt);
      }
      // each screen follows the machine picked and where its project's runs are, looked at once a second
      if (t - checked < 1) return;
      checked = t;
      screens.forEach(redraw);
    },
    dispose: () => {
      for (const s of screens) {
        s.mesh.geometry.dispose();
        s.hologram.dispose();
        s.texture.dispose();
      }
    },
  };
}

const astrometrics: ClientPlugin = {
  id: ASTROMETRICS,
  project: {
    label: 'State machines',
    about: 'Draws the office’s state machines (a crew member’s run, what follows a turn, a goal’s slices, QA’s review) on a screen in the project’s holodeck, with where its runs of each are now',
  },
  ship,
};

export default astrometrics;
