import './styles.css';
import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { api } from './net/api';
import { state } from './net/state';
import { Player } from './player';
import { agentPanelOpen, openAgentPanel } from './ui/agentPanel';
import { openHelperPanel } from './ui/helperPanel';
import { openBoardPanel } from './ui/boardPanel';
import type { Ui } from './ui/context';
import { h } from './ui/dom';
import { Hud } from './ui/hud';
import { openManagerPanel } from './ui/managerPanel';
import { openGoalsPanel } from './ui/goalsPanel';
import { numberOnePanelOpen, openNumberOnePanel } from './ui/numberOnePanel';
import { Panels } from './ui/panels';
import { openPreviewPanel } from './ui/previewPanel';
import { openQaPanel } from './ui/qaPanel';
import { openNewIssuePanel, openPausePanel, openTeleportPanel, openTurboliftPanel } from './ui/travelPanel';
import type { Interaction } from './world/builder';
import { numberOne } from '../../shared/crew';
import { toastShows } from '../../shared/hidden';
import { previewIncludes } from '../../shared/previewSet';
import { sound } from './sound';
import { Deck } from './world/deck';
import { HolodeckDeck } from './world/holodeckDeck';
import { COMMAND_DECK, SUN_POSITION } from './world/layout';
import { type Ship, World } from './world/office';
import { PortalView } from './world/portal';
import { loadTeamStation } from './world/teamStation';
import { stopAt } from './world/turbolift';

async function fontsReady(): Promise<void> {
  const loads = ['700 40px Fredoka', '500 40px Fredoka', '15px "JetBrains Mono"', '600 40px Antonio', '500 40px Antonio'].map((f) => document.fonts.load(f));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 2500))]).catch(() => undefined);
}

/** The ship as it is, or, behind ?ship=next, as it's being rebuilt in Blender, deck by deck. */
async function ship(): Promise<Ship> {
  if (new URLSearchParams(location.search).get('ship') !== 'next') return { kind: 'current' };
  try {
    const [command, holodecks] = await Promise.all([Deck.load('/ship/command-deck.glb', COMMAND_DECK), HolodeckDeck.load('/ship/holodeck-deck.glb')]);
    return { kind: 'next', command, holodecks };
  } catch (err) {
    console.error('The decks built in Blender failed to load; carrying on with the ship as it is.', err);
    return { kind: 'current' };
  }
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
  const portalView = new PortalView(renderer, effect);

  await fontsReady();

  const [theShip, teamStation] = await Promise.all([ship(), loadTeamStation('/ship/team-station.glb')]);
  const world = new World(scene, theShip, teamStation);
  const player = new Player(camera, renderer.domElement);
  const aboard = world.boarding();
  player.teleport(aboard.position, aboard.lookAt);
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
      // someone without a seat in the room to stand behind: their panel instead
      if (!view) return agent ? ui.openAgent(id) : undefined;
      sound.beam();
      panels.close(false);
      player.teleport(view.position, view.lookAt);
      player.lock();
    },
    openAgent: (id) => openAgentPanel(ui, id),
    openHelper: (leadId, id) => openHelperPanel(ui, leadId, id),
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
    openQa: (projectId) => openQaPanel(ui, projectId),
    openNumberOne: () => openNumberOnePanel(ui),
    openGoals: (projectId, station) => openGoalsPanel(ui, projectId, station),
    openManager: (tab) => openManagerPanel(ui, tab),
    openTeleport: () => openTeleportPanel(ui),
    openTurbolift: () => {
      const stops = world.stops();
      openTurboliftPanel(ui, stops, stopAt(stops, camera.position));
    },
    ride: (stop) => {
      sound.lift();
      panels.close(false);
      hud.blackout(() => player.teleport(stop.position, stop.lookAt));
      player.lock();
    },
  };

  // every button on a console blips, bar the close button, which has the panel's own closing chirp
  document.addEventListener('click', (e) => {
    const button = (e.target as Element).closest('button');
    if (button && !button.classList.contains('close')) sound.press();
  }, true);

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
      h('p', null, 'A starship crewed by Claude Code agents. Every project gets a holodeck, every agent a station you can look over their shoulder at.'),
      h('div', { class: 'keys' },
        h('span', null, h('kbd', { class: 'k' }, 'WASD'), 'walk'),
        h('span', null, h('kbd', { class: 'k' }, 'Mouse'), 'look around'),
        h('span', null, h('kbd', { class: 'k' }, 'E'), 'use / talk'),
        h('span', null, h('kbd', { class: 'k' }, 'T'), 'teleport'),
        h('span', null, h('kbd', { class: 'k' }, 'M'), 'ready room'),
        h('span', null, h('kbd', { class: 'k' }, '1'), 'Number One'),
        h('span', null, h('kbd', { class: 'k' }, 'Esc'), 'pause'),
      ),
      enter,
      splashStatus,
    ),
  );
  document.body.append(splash);
  enter.onclick = () => {
    started = true;
    sound.start();
    splash.remove();
    player.lock();
    if (state.projects.length === 0) {
      const way = { current: 'Head north into your ready room', next: 'Your ready room is off the bridge to starboard: head in there' }[theShip.kind];
      hud.toast('info', `Welcome aboard, Captain! ${way} to set up your first project.`, { label: 'Open console', run: () => ui.openManager('new-project') });
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
    world.numberOne?.sync();
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
    world.markPanels();
  };
  state.on('agent', agentChanged);
  // a goal's lead finishing a turn: it's your turn, unless you're already looking at them
  const leadTurns = new Map<string, string>();
  state.on('agent', (a) => {
    if (a.task !== 'lead' || state.isHidden(a.projectId)) return;
    const before = leadTurns.get(a.id);
    leadTurns.set(a.id, a.status);
    if (a.status === 'done' && before && before !== 'done' && !agentPanelOpen(a.id)) {
      hud.toast('info', `🖖 ${a.name} is waiting for you`, { label: 'Talk', run: () => ui.openAgent(a.id) });
    }
  });
  // crew working their consoles: a few blips from a station as its terminal scrolls, now and then rather than per line
  const chatter = new Map<string, number>();
  state.on('agent-removed', (a) => {
    chatter.delete(a.id);
    agentChanged(a);
  });
  state.on('lines', ({ id }) => {
    const a = state.agents.get(id);
    if (!a) return;
    const room = world.room(a.projectId);
    room?.markScreen(id);
    const now = performance.now();
    if ((chatter.get(id) ?? 0) > now) return;
    const at = room?.viewpoint(id)?.lookAt;
    if (!at) return;
    chatter.set(id, now + 1500 + Math.random() * 3500);
    sound.console(at);
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
    world.room(projectId)?.syncPlanner();
  });
  let numberOneStatus = state.numberOne?.status;
  state.on('number-one', () => {
    world.numberOne?.sync();
    const chat = state.numberOne;
    // a reply can take a while: say so when it lands while you're elsewhere
    if (chat && chat.status !== numberOneStatus && numberOneStatus === 'thinking' && !numberOnePanelOpen()) {
      const name = numberOne().name;
      if (chat.status === 'waiting') hud.toast('info', `🖖 ${name} has an answer for you`, { label: 'Read it', run: () => ui.openNumberOne() });
      if (chat.status === 'failed') hud.toast('error', `${name} lost the thread: ${chat.error ?? ''}`, { label: 'Open', run: () => ui.openNumberOne() });
    }
    numberOneStatus = chat?.status;
  });
  state.on('toast', (e) => {
    if (!toastShows(e, state.projects, (id) => state.agents.get(id)?.projectId)) return;
    const agentId = e.agentId;
    hud.toast(e.level, e.text, agentId && state.agents.has(agentId) ? { label: 'Go there', run: () => ui.goToAgent(agentId) } : undefined);
  });
  state.on('preview', ({ preview: p, before }) => {
    if (!p || before?.startedAt !== p.startedAt || before.status === p.status || state.isHidden(p.projectId)) return;
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
      case 'helper':
        ui.openHelper(i.leadId, i.id);
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
      case 'number-one':
        ui.openNumberOne();
        break;
      case 'qa':
        ui.openQa(i.projectId);
        break;
      case 'station':
        ui.openGoals(i.projectId, i.station);
        break;
      case 'manager':
        ui.openManager(i.tab);
        break;
      case 'teleport':
        ui.openTeleport();
        break;
      case 'turbolift':
        ui.openTurbolift();
        break;
      case 'vacant':
        ui.openManager('new-project');
        break;
    }
  };

  window.addEventListener('keydown', (e) => {
    if (!started || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (panels.isOpen) return;
    const hotkeys: Record<string, (() => void) | undefined> = {
      KeyE: interact,
      KeyT: () => ui.openTeleport(),
      KeyM: () => ui.openManager(),
      KeyN: () => ui.openNewIssue(world.locationOf(camera.position).projectId),
      Digit1: () => ui.openNumberOne(),
      KeyL: () => {
        const projectId = world.locationOf(camera.position).projectId;
        if (projectId) ui.openGoals(projectId);
      },
    };
    const run = hotkeys[e.code];
    if (!run) return;
    // or the key lands in the message box the panel it opens has just focused
    e.preventDefault();
    run();
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
    const through = world.through(camera.position);
    if (through) player.transport(through);
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
    portalView.render(scene, camera, world.portals);
    effect.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();

  // handy for debugging from the console
  Object.assign(window, { focusHQ: { state, world, player, ui } });
}

void main();
