import './styles.css';
import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { api } from './net/api';
import { state } from './net/state';
import { Player } from './player';
import { openAgentPanel } from './ui/agentPanel';
import { openBoardPanel } from './ui/boardPanel';
import { briefingPanelOpen, openBriefingPanel } from './ui/briefingPanel';
import type { Ui } from './ui/context';
import { h } from './ui/dom';
import { Hud } from './ui/hud';
import { openManagerPanel } from './ui/managerPanel';
import { Panels } from './ui/panels';
import { openPreviewPanel } from './ui/previewPanel';
import { openQaPanel } from './ui/qaPanel';
import { openNewIssuePanel, openPausePanel, openTeleportPanel } from './ui/travelPanel';
import type { Interaction } from './world/builder';
import { plannerFor } from '../../shared/crew';
import { previewIncludes } from '../../shared/previewSet';
import { sound } from './sound';
import { SUN_POSITION } from './world/layout';
import { World } from './world/office';

async function fontsReady(): Promise<void> {
  const loads = ['700 40px Fredoka', '500 40px Fredoka', '15px "JetBrains Mono"', '600 40px Antonio', '500 40px Antonio'].map((f) => document.fonts.load(f));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 2500))]).catch(() => undefined);
}

async function main() {
  // ---------------------------------------------------------------- renderer & scene
  const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true }); // stencil: room landscapes
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'world';
  document.getElementById('app')!.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9ad7ff');
  scene.add(new THREE.HemisphereLight('#ffffff', '#d9c7a8', 1.9));
  const sun = new THREE.DirectionalLight('#fff4e0', 1.3);
  sun.position.copy(SUN_POSITION);
  scene.add(sun);
  scene.add(new THREE.AmbientLight('#ffffff', 0.35));

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 250);
  const effect = new OutlineEffect(renderer, { defaultThickness: 0.004, defaultColor: [0.1, 0.1, 0.12], defaultAlpha: 1 });

  await fontsReady();

  const world = new World(scene);
  const player = new Player(camera, renderer.domElement);
  camera.lookAt(0, 1.6, 0);
  const hud = new Hud();
  const panels = new Panels();

  // ---------------------------------------------------------------- ui wiring
  const ui: Ui = {
    panels,
    hud,
    error: (message) => hud.toast('error', message),
    places: () => world.places(),
    goTo: (place) => {
      sound.beam();
      panels.close(false);
      player.teleport(place.position, place.lookAt);
      player.lock();
    },
    goToAgent: (id) => {
      const agent = state.agents.get(id);
      const view = agent && world.room(agent.projectId)?.viewpoint(id);
      if (!view) return;
      sound.beam();
      panels.close(false);
      player.teleport(view.position, view.lookAt);
      player.lock();
    },
    openAgent: (id) => openAgentPanel(ui, id),
    openBoard: (projectId, tab) => openBoardPanel(ui, projectId, tab),
    previewPr: (projectId, repo, number) => {
      const running = state.previews.get(projectId);
      if (running && previewIncludes(running, repo, number) && running.status !== 'failed') return openPreviewPanel(ui, projectId);
      api.startPreview(projectId, repo, number).then(
        (preview) => openPreviewPanel(ui, projectId, preview),
        (err: Error) => ui.error(err.message),
      );
    },
    openPreview: (projectId) => openPreviewPanel(ui, projectId),
    openNewIssue: (projectId) => openNewIssuePanel(ui, projectId),
    openBriefing: (projectId) => openBriefingPanel(ui, projectId),
    openQa: (projectId) => openQaPanel(ui, projectId),
    goToLounge: () => {
      const lounge = world.places().find((p) => p.label.includes('lounge'));
      if (lounge) ui.goTo(lounge);
      openBriefingPanel(ui);
    },
    openManager: (tab) => openManagerPanel(ui, tab),
    openTeleport: () => openTeleportPanel(ui),
  };

  panels.onOpen = () => {
    sound.chirp('open');
    player.unlock();
  };
  panels.onClose = () => {
    sound.chirp('close');
    player.lock();
  };

  // splash screen until the first click
  let started = false;
  const splashStatus = h('p', { class: 'muted' }, 'Hailing the ship…');
  const enter = h('button', { class: 'big-button' }, 'Come aboard');
  const splash = h('div', { class: 'splash' },
    h('div', { class: 'card' },
      h('h1', null, 'FOCUS HQ'),
      h('p', null, 'A starship crewed by Claude Code agents. Every project gets a holodeck, every agent a station and a laptop you can look over their shoulder at.'),
      h('div', { class: 'keys' },
        h('span', null, h('kbd', { class: 'k' }, 'WASD'), 'walk'),
        h('span', null, h('kbd', { class: 'k' }, 'Mouse'), 'look around'),
        h('span', null, h('kbd', { class: 'k' }, 'E'), 'use / talk'),
        h('span', null, h('kbd', { class: 'k' }, 'T'), 'teleport'),
        h('span', null, h('kbd', { class: 'k' }, 'M'), 'ready room'),
        h('span', null, h('kbd', { class: 'k' }, 'Esc'), 'pause'),
      ),
      enter,
      splashStatus,
    ),
  );
  splash.querySelector('.card')!.classList.add('panel');
  (splash.querySelector('.card') as HTMLElement).style.padding = '28px';
  document.body.append(splash);
  enter.onclick = () => {
    started = true;
    sound.start();
    splash.remove();
    player.lock();
    if (state.projects.length === 0) {
      hud.toast('info', 'Welcome aboard, Captain! Head north into your ready room to set up your first project.', { label: 'Open console', run: () => ui.openManager('new-project') });
    }
  };

  player.controls.addEventListener('unlock', () => {
    if (started && !panels.isOpen) openPausePanel(ui, () => panels.close());
  });
  renderer.domElement.addEventListener('click', () => {
    if (!started || panels.isOpen) return;
    if (!player.locked) player.lock();
    else interact();
  });

  // ---------------------------------------------------------------- state → world
  const syncWorld = () => {
    world.sync(state.projects);
    player.colliders = world.colliders;
    for (const room of world.rooms.values()) {
      room.syncAgents();
      room.syncPlanner();
      room.syncQa();
    }
    world.lounge?.sync();
    world.markPanels();
  };
  state.on('snapshot', () => {
    syncWorld();
    const info = state.info;
    splashStatus.textContent = info
      ? `${info.mode === 'demo' ? 'Demo mode – simulated GitHub and agents.' : 'Live mode.'} ${info.github.ok ? `GitHub: ${info.github.login}` : 'GitHub not connected – run "gh auth login".'}`
      : '';
  });
  state.on('projects', syncWorld);
  state.on('info', () => world.markPanels());
  const agentChanged = (a: { projectId: string }) => {
    world.room(a.projectId)?.syncAgents();
    world.room(a.projectId)?.syncQa();
    world.lounge?.sync(); // QA joins a briefing when their review is done
    world.markPanels();
  };
  state.on('agent', agentChanged);
  state.on('agent-removed', agentChanged);
  state.on('lines', ({ id }) => {
    const a = state.agents.get(id);
    if (a) world.room(a.projectId)?.markScreen(id);
  });
  state.on('browser', (id) => {
    const a = state.agents.get(id);
    if (a) world.room(a.projectId)?.markScreen(id);
  });
  state.on('board', (projectId) => {
    world.room(projectId)?.markBoard();
    world.markPanels();
  });
  state.on('draft', (projectId) => world.room(projectId)?.syncPlanner());
  state.on('review', (projectId) => {
    world.room(projectId)?.markBoard();
    world.room(projectId)?.syncQa();
  });
  let briefingStatus = state.briefing?.status;
  state.on('briefing', () => {
    world.lounge?.sync();
    for (const room of world.rooms.values()) {
      room.syncPlanner();
      room.syncQa();
    }
    const b = state.briefing;
    if (b && b.status !== briefingStatus && !briefingPanelOpen()) {
      const name = plannerFor(b.projectId).name;
      if (b.status === 'waiting') hud.toast('info', `🖖 ${name} has a question for you in the observation lounge`, { label: 'Answer', run: () => ui.openBriefing() });
      if (b.status === 'failed') hud.toast('error', `${name} lost the thread of the briefing: ${b.error ?? ''}`, { label: 'Open', run: () => ui.openBriefing() });
    }
    briefingStatus = b?.status;
  });
  state.on('toast', (e) => {
    const agentId = e.agentId;
    hud.toast(e.level, e.text, agentId && state.agents.has(agentId) ? { label: 'Go there', run: () => ui.goToAgent(agentId) } : undefined);
  });
  state.on('preview', ({ preview: p, before }) => {
    if (!p || before?.startedAt !== p.startedAt || before.status === p.status) return;
    const link = p.links[0];
    if (p.status === 'running' && link) {
      const open = { label: `Open${link.name ? ` ${link.name}` : ''} ↗`, run: () => window.open(link.url, '_blank', 'noopener') };
      if (p.warning) hud.toast('info', `▶ ${p.repo}#${p.number} is up, but: ${p.warning}`, open);
      else hud.toast('success', `▶ ${p.repo}#${p.number} is running`, open);
    } else if (p.status === 'failed') {
      hud.toast('error', `Preview of ${p.repo}#${p.number} failed: ${p.error ?? 'see the log'}`, { label: 'Log', run: () => ui.openPreview(p.projectId) });
    }
  });
  state.connect();

  // ---------------------------------------------------------------- interaction
  const raycaster = new THREE.Raycaster();
  raycaster.far = 4.5;
  const center = new THREE.Vector2(0, 0);
  let target: { interaction: Interaction; label: () => string } | null = null;

  const pick = () => {
    if (!player.locked) {
      target = null;
      hud.setHint(null);
      return;
    }
    raycaster.setFromCamera(center, camera);
    const hits = raycaster.intersectObject(world.root, true);
    target = null;
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.interaction) o = o.parent;
      if (o) {
        target = { interaction: o.userData.interaction as Interaction, label: o.userData.label as () => string };
        break;
      }
      if (!(hit.object as THREE.Mesh).isMesh) continue;
      break; // first solid thing blocks the view
    }
    hud.setHint(target ? target.label() : null);
  };

  const interact = () => {
    if (!target) return;
    const i = target.interaction;
    switch (i.kind) {
      case 'agent':
        ui.openAgent(i.id);
        break;
      case 'desk':
        ui.openBoard(i.projectId, 'todo');
        break;
      case 'board':
        ui.openBoard(i.projectId, i.tab);
        break;
      case 'new-issue':
        ui.openNewIssue(i.projectId);
        break;
      case 'briefing':
        ui.openBriefing();
        break;
      case 'qa':
        ui.openQa(i.projectId);
        break;
      case 'manager':
        ui.openManager(i.tab);
        break;
      case 'teleport':
        ui.openTeleport();
        break;
      case 'vacant':
        ui.openManager('new-project');
        break;
    }
  };

  window.addEventListener('keydown', (e) => {
    if (!started || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (panels.isOpen) return;
    if (e.code === 'KeyE') interact();
    else if (e.code === 'KeyT') ui.openTeleport();
    else if (e.code === 'KeyM') ui.openManager();
    else if (e.code === 'KeyN') ui.openNewIssue(world.locationOf(camera.position).projectId);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------------------------------------------------------------- loop
  const timer = new THREE.Timer();
  let lastPick = 0;
  let lastLocation = 0;
  const loop = (time?: number) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    const now = performance.now();
    player.enabled = !panels.isOpen;
    player.update(dt);
    world.update(t, now, camera.position);
    sound.listen(camera);
    if (now - lastPick > 90) {
      lastPick = now;
      pick();
    }
    if (now - lastLocation > 300) {
      lastLocation = now;
      const where = world.locationOf(camera.position);
      hud.setLocation(where.label, where.projectId ? state.project(where.projectId)?.color : undefined);
    }
    effect.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();

  // handy for debugging from the console
  Object.assign(window, { focusHQ: { state, world, player, ui } });
}

void main();
