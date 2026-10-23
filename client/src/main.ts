import './styles.css';
import * as THREE from 'three';
import { api } from './net/api';
import { state } from './net/state';
import { Player } from './player';
import { openAgentPanel } from './ui/agentPanel';
import { openHelperPanel } from './ui/helperPanel';
import { openWorkflowAgentPanel } from './ui/workflowAgentPanel';
import { openWorkflowScriptPanel } from './ui/workflowScriptPanel';
import { flowPrefs, railPrefs } from './world/flowPrefs';
import { openBackgroundPanel } from './ui/backgroundPanel';
import { openBoardPanel } from './ui/boardPanel';
import type { Ui } from './ui/context';
import { h } from './ui/dom';
import { Hud } from './ui/hud';
import { openManagerPanel } from './ui/managerPanel';
import { stepDemoPace } from './ui/demoPace';
import { openGoalsPanel } from './ui/goalsPanel';
import { linkAction, type NewsLink } from './ui/newsLink';
import { openEngineeringPanel } from './ui/engineeringPanel';
import { openLedgerPanel } from './ui/ledgerPanel';
import { Panels } from './ui/panels';
import { openPreviewPanel } from './ui/previewPanel';
import { openQaPanel } from './ui/qaPanel';
import { openScreenPanel } from './ui/screenPanel';
import { openGoalChart } from './ui/chartPanel';
import { openNewIssuePanel, openPausePanel, openTeleportPanel, openTurboliftPanel } from './ui/travelPanel';
import { type Interaction, REACH } from './world/builder';
import { CHAIR_USE, chairInHand, seatedView } from './world/chairs';
import type { Chair } from './world/deckExtras';
import { OVERLAY_LAYER } from './world/frame';
import { toastShows } from '../../shared/hidden';
import { previewIncludes } from '../../shared/previewSet';
import { sound } from './sound';
import { dimsAtNight, fade, NIGHT_LIGHT, nightLevel, nightWanted, type Override, setNightLevel, toggle } from './world/night';
import { screenPrefs } from './world/screenPanes';
import { Deck } from './world/deck';
import { HolodeckDeck } from './world/holodeckDeck';
import { COMMAND_DECK, ENGINEERING_DECK, SUN_POSITION } from './world/layout';
import { setMerging } from './world/merge';
import { type Ship, World } from './world/ship';
import { SceneRenderer } from './world/sceneRenderer';
import { adapt, FEWEST, initialResolution, levels, WINDOW } from './resolution';
import { FrameStats } from './ui/frameStats';
import { PortalView } from './world/portal';
import { loadTrainingHall } from './world/hall';
import { loadTeamStation } from './world/teamStation';
import { stopAt } from './world/turbolift';
import { TransporterFeeds } from './world/transporterFeeds';
import { TextureFeed, warmUp } from './world/warmUp';
import { patchTexturesOn } from './world/texturePatch';
import { gpuFrame } from './world/gpuTimer';
import { canvasTest } from './world/canvas';
import { newFrame, screenTest } from './world/screenRedraw';
import type { MsdBoard } from './world/msd';
import { clientPlugin, clientPlugins, everyGoal, goalsFor, openPluginPanel, pluginChair, pluginPanels, startedParts, stationSays } from './plugins';
import { isMesh } from './world/isMesh';
import { toastHails } from './ui/hails';

/** A plugin's board for main engineering's MSD (the scorecard's), while the plugin's on and draws one. */
function pluginBoard(id: string): MsdBoard | undefined {
  const draw = clientPlugin(id)?.msd;
  return draw && { kind: 'plugin', id, draw };
}

const NIGHT_KEY = 'focus.night';

/** The captain's last say on night (B), if they've had one. */
function readOverride(): Override | null {
  try {
    const o = JSON.parse(localStorage.getItem(NIGHT_KEY) ?? 'null') as Override | null;
    return o && typeof o.night === 'boolean' && typeof o.until === 'number' ? o : null;
  } catch {
    return null;
  }
}

async function fontsReady(): Promise<void> {
  const loads = ['700 40px Fredoka', '500 40px Fredoka', '15px "JetBrains Mono"', '600 40px Antonio', '500 40px Antonio'].map((f) => document.fonts.load(f));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 2500))]).catch(() => undefined);
}

/** The ship's decks, built in Blender (blender/, `pnpm run ship`). */
async function ship(): Promise<Ship> {
  const [command, holodecks, engineering] = await Promise.all([
    Deck.load('/ship/command-deck.glb', COMMAND_DECK),
    HolodeckDeck.load('/ship/holodeck-deck.glb'),
    Deck.load('/ship/engineering-deck.glb', ENGINEERING_DECK),
  ]);
  return { command, holodecks, engineering };
}

async function main() {
  // ---------------------------------------------------------------- renderer & scene
  // no multisampling: the scene's drawn into textures and only a full-screen pass reaches the screen (frame.ts)
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  const params = new URLSearchParams(location.search);
  // as fine as the screen (up to 2), and coarser while frames run slow (resolution.ts)
  const ladder = levels(Math.min(window.devicePixelRatio, 2));
  let resolution = initialResolution(ladder);
  renderer.setPixelRatio(ladder[resolution.level]);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'world';
  document.getElementById('app')!.append(renderer.domElement);

  const scene = new THREE.Scene();
  const background = new THREE.Color('#9ad7ff');
  scene.background = background;
  const sky = new THREE.HemisphereLight('#ffffff', '#d9c7a8', 1.9);
  const sun = new THREE.DirectionalLight('#fff4e0', 1.3);
  sun.position.copy(SUN_POSITION);
  const ambient = new THREE.AmbientLight('#ffffff', 0.35);
  scene.add(sky, sun, ambient);
  dimsAtNight(background);
  for (const c of [sky.color, sky.groundColor, sun.color, ambient.color]) dimsAtNight(c, undefined, NIGHT_LIGHT);
  // night: by the clock, and B says otherwise until it next changes over (world/night.ts); ?night=1 or 0 holds it
  let forced = params.get('night');
  let override = readOverride();
  const wantNight = () => (forced !== null ? forced === '1' : nightWanted(new Date(), override));
  let dark = wantNight();
  setNightLevel(dark ? 1 : 0);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 250);
  // ?merge=0 leaves the decks' meshes as Blender made them, for the gap and z-fighting scans to name
  setMerging(params.get('merge') !== '0');
  // tests of what holds frames up on someone's machine (docs/performance.md): screens drawn in software, or never redrawn
  canvasTest.software = params.get('canvas') === 'cpu';
  screenTest.still = params.get('screens') === 'still';
  const portalView = new PortalView(renderer);
  const view = new SceneRenderer(renderer);
  const feeds = new TransporterFeeds(renderer);
  // a blinking cursor's cell goes to the GPU on its own (texturePatch.ts), and a room you near goes ahead of you (warmUp.ts)
  patchTexturesOn(renderer);
  const feed = new TextureFeed(renderer);

  await fontsReady();

  const [theShip, teamStation, hallKit] = await Promise.all([ship(), loadTeamStation('/ship/team-station.glb', '/ship/transporter-room.glb'), loadTrainingHall('/ship/training-hall.glb')]);
  const world = new World(scene, theShip, teamStation, hallKit);
  world.shipPlugins = clientPlugins;
  // ?cull=0 draws the whole ship from anywhere, for the gap and z-fighting scans
  world.culling = params.get('cull') !== '0';
  const player = new Player(camera, renderer.domElement);
  const aboard = world.boarding();
  player.teleport(aboard.position, aboard.lookAt);
  const hud = new Hud();
  const panels = new Panels();
  // recording: H (or ?record=1) hides what's only there to drive the ship (the HUD, all but errors' toasts), so a
  // video shows the ship and nothing else
  const record = (on: boolean) => document.body.classList.toggle('recording', on);
  record(params.get('record') === '1');

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
      if (place.chair) sitIn(place.chair);
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
    openAgent: (id, view) => openAgentPanel(ui, id, view),
    openHelper: (leadId, id) => openHelperPanel(ui, leadId, id),
    openWorkflowAgent: (leadId, workflowId, index) => openWorkflowAgentPanel(ui, leadId, workflowId, index),
    openWorkflowScript: (leadId, workflowId) => openWorkflowScriptPanel(ui, leadId, workflowId),
    openBackground: (leadId, taskId) => openBackgroundPanel(ui, leadId, taskId),
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
    openEngineering: () => openEngineeringPanel(ui),
    openLedger: (subject) => openLedgerPanel(ui, subject),
    showOnMsd: (what) => world.putOnMsd(
      what && 'plugin' in what
        ? pluginBoard(what.plugin) ?? { kind: 'report', card: state.report }
        : what ? { kind: 'trace', trace: what } : { kind: 'report', card: state.report },
    ),
    openPlugin: (id) => openPluginPanel(id, ui),
    pluginPanels: () => pluginPanels().map(({ id, label }) => ({ id, label })),
    openGoals: (projectId, station) => openGoalsPanel(ui, projectId, station),
    openManager: (tab) => openManagerPanel(ui, tab),
    openTeleport: () => openTeleportPanel(ui),
    openScreen: (leadId) => openScreenPanel(ui, leadId),
    openChart: (leadId) => openGoalChart(ui, leadId),
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
    beamTo: (projectId, station, room) => {
      const to = world.transporterRooms.find((t) => t.projectId === projectId && t.station === station && t.index === room);
      if (to) beam(to.place.at, to.place.lookAt);
    },
    beamBack: (projectId, station) => {
      const to = world.station(projectId, station)?.viewpoint();
      if (to) beam(to.position, to.lookAt);
    },
    dive: (place) => {
      panels.close(false);
      hud.dive(() => player.teleport(place.position, place.lookAt));
      player.lock();
    },
  };
  /** A transporter's beam: its sound and shimmer, and the captain's somewhere else. */
  function beam(feet: THREE.Vector3, lookAt: THREE.Vector3): void {
    sound.beam();
    panels.close(false);
    hud.beam(() => player.teleport(feet, lookAt));
    player.lock();
  }

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
  const pauseKey = h('span', null, h('kbd', { class: 'k' }, 'Esc'), 'pause');
  const splashKeys = h('div', { class: 'keys' },
    h('span', null, h('kbd', { class: 'k' }, 'WASD'), 'walk'),
    h('span', null, h('kbd', { class: 'k' }, 'Mouse'), 'look around'),
    h('span', null, h('kbd', { class: 'k' }, 'E'), 'use / talk'),
    h('span', null, h('kbd', { class: 'k' }, 'T'), 'teleport'),
    h('span', null, h('kbd', { class: 'k' }, 'M'), 'ready room'),
    pauseKey,
  );
  const enter = h('button', { class: 'big-button' }, 'Come aboard');
  const splash = h('div', { class: 'splash' },
    h('div', { class: 'card' },
      h('h1', null, 'FOCUS HQ'),
      h('p', null, 'A starship crewed by Claude Code agents. Every project gets a holodeck, every agent a station you can look over their shoulder at.'),
      splashKeys,
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
      hud.toast('info', 'Welcome aboard, Captain! Your ready room is off the bridge to port: head in there to set up your first project.', {
        label: 'Open console',
        run: () => ui.openManager('new-project'),
      });
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
  // the whole ship's shaders and textures, ready before you walk into any of it (warmUp.ts), and again as it changes
  let warming = false;
  let warmAgain = false;
  const warm = (): void => {
    if (warming) {
      warmAgain = true;
      return;
    }
    warming = true;
    warmUp(renderer, scene, camera)
      .catch(() => undefined)
      .finally(() => {
        warming = false;
        if (warmAgain) {
          warmAgain = false;
          warm();
        }
      });
  };
  const syncWorld = () => {
    world.sync(state.projects);
    player.colliders = world.colliders;
    for (const room of world.rooms.values()) {
      room.syncAgents();
      room.syncPlanner();
      room.syncQa();
    }
    world.markPanels();
    warm();
  };
  // each plugin switched on starts once, as the first snapshot says which are, before the world's built with their parts
  const startPlugins = () => {
    for (const plugin of clientPlugins()) {
      if (startedParts.has(plugin.id)) continue;
      startedParts.set(plugin.id, plugin.start?.({ ui }) ?? {});
      const keys = plugin.legend ?? [];
      for (const { key, label } of keys) pauseKey.before(h('span', null, h('kbd', { class: 'k' }, key), label));
      hud.addKeys(keys);
    }
  };
  state.on('info', startPlugins);
  state.on('snapshot', () => {
    startPlugins();
    syncWorld();
    const info = state.info;
    splashStatus.textContent = info
      ? `${info.mode === 'demo' ? 'Demo mode – simulated GitHub and agents.' : 'Live mode.'} ${info.github.ok ? `GitHub: ${info.github.login}` : 'GitHub not connected – run "gh auth login".'}`
      : '';
  });
  state.on('projects', () => {
    syncWorld();
    // a plugin switched on or off for a project hangs or takes down its screens there
    world.syncHallScreens();
  });
  // the plugins' screens round the holodecks follow which are switched on, and their state
  state.on('info', () => {
    world.markPanels();
    world.syncHallScreens();
  });
  const agentChanged = (a: { projectId: string }) => {
    world.room(a.projectId)?.syncAgents();
    world.room(a.projectId)?.syncQa();
    world.markPanels();
  };
  state.on('agent', agentChanged);
  // a toast as an agent comes to need the captain, unless a plugin says it its own way
  toastHails(ui);
  // news for the captain: a toast
  const notify = (level: 'info' | 'success' | 'error', text: string, link?: NewsLink) => {
    hud.toast(level, text, link && linkAction(ui, link));
  };
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
    // the screens over the pods show how QA has each goal's pull requests
    world.room(projectId)?.syncStations();
  });
  // the engineering station's screen shows the report card, and its engineer what a plugin has them busy with
  const showEngineering = () => world.engineering?.showReport(state.report, stationSays());
  state.on('report', () => {
    showEngineering();
    world.showOnMsd({ kind: 'report', card: state.report });
  });
  // a plugin's board on the MSD follows its state, while it's up there, and so do its words on the goal boards and
  // the engineering station
  state.on('plugin', (id) => {
    const board = pluginBoard(id);
    if (board) world.showOnMsd(board);
    if (clientPlugin(id)?.engineering?.station) showEngineering();
    if (clientPlugin(id)?.goal) for (const room of world.rooms.values()) room.syncStations();
    world.syncHallScreens();
  });
  state.on('toast', (e) => {
    if (!toastShows(e, state.projects, (id) => state.agents.get(id)?.projectId)) return;
    const agentId = e.agentId;
    notify(e.level, e.text, agentId && state.agents.has(agentId) ? { kind: 'agent', id: agentId } : undefined);
  });
  state.on('preview', ({ preview: p, before }) => {
    if (!p || before?.startedAt !== p.startedAt || before.status === p.status || state.isHidden(p.projectId)) return;
    const link = p.links[0];
    if (p.status === 'running' && link) {
      const open: NewsLink = { kind: 'url', url: link.url, projectId: p.projectId, label: `Open${link.name ? ` ${link.name}` : ''} ↗` };
      if (p.warning) notify('info', `▶ ${p.repo}#${p.number} is up, but: ${p.warning}`, open);
      else notify('success', `▶ ${p.repo}#${p.number} is running`, open);
    } else if (p.status === 'failed') {
      notify('error', `Preview of ${p.repo}#${p.number} failed: ${p.error ?? 'see the log'}`, { kind: 'preview', projectId: p.projectId });
    }
  });
  state.connect();

  // ---------------------------------------------------------------- interaction
  const raycaster = new THREE.Raycaster();
  // as far as anything reaches: most things only from REACH (`interactive`), or a big screen from across the room
  raycaster.far = 18;
  // holograms are drawn in the overlay (frame.ts), and can be used
  raycaster.layers.enable(OVERLAY_LAYER);
  const center = new THREE.Vector2(0, 0);
  let target: { interaction: Interaction; label: () => string } | null = null;
  // what's aimed at, told when you aim at it and away (`userData.aim`), like a hologram turning solid
  let aimed: THREE.Object3D | null = null;
  const aimAt = (o: THREE.Object3D | null) => {
    if (o === aimed) return;
    (aimed?.userData.aim as ((on: boolean) => void) | undefined)?.(false);
    aimed = o;
    (aimed?.userData.aim as ((on: boolean) => void) | undefined)?.(true);
  };

  const shown = (o: THREE.Object3D | null): boolean => {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };

  const pick = () => {
    if (!player.locked) {
      target = null;
      hud.setHint(null);
      aimAt(null);
      return;
    }
    raycaster.setFromCamera(center, camera);
    const hits = raycaster.intersectObject(world.root, true);
    target = null;
    let aiming: THREE.Object3D | null = null;
    for (const hit of hits) {
      // the raycaster doesn't care what's hidden, like a training hall's shell
      if (!shown(hit.object)) continue;
      // a board with rows of its own to use, like a briefing room's goal board's roster, or its big screen's panes
      const at = hit.object.userData.interactionAt as ((uv: THREE.Vector2) => typeof target) | undefined;
      const reach = (hit.object.userData.reach as number | undefined) ?? REACH;
      const row = at && hit.uv && hit.distance <= reach ? at(hit.uv) : null;
      if (row) {
        target = row;
        break;
      }
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.interaction) o = o.parent;
      if (o) {
        if (hit.distance > ((o.userData.reach as number | undefined) ?? REACH)) break;
        target = { interaction: o.userData.interaction as Interaction, label: o.userData.label as () => string };
        aiming = o;
        break;
      }
      if (!isMesh(hit.object) || !hit.object.layers.isEnabled(0)) continue; // nor does the overlay
      break; // first solid thing blocks the view
    }
    aimAt(aiming);
    const chair = chairInHand(sittingIn(), target?.interaction ?? null);
    hud.setHint(chair ? chairUse(chair)?.label ?? null : target ? target.label() : null);
  };

  // the captain's chair you're sat in, if you're still sat
  let seatedIn: Chair | null = null;
  const sittingIn = () => (player.seated ? seatedIn : null);
  const sitIn = (chair: Chair) => {
    const { eye, lookAt } = seatedView(world.chair(chair));
    seatedIn = chair;
    player.sit(eye, lookAt);
  };
  // what a chair puts to hand: the core's (the ready room's console, the personal log), or a plugin's (the bridge's)
  const chairUse = (chair: Chair): { label: string; use: () => void } | undefined => {
    const own = CHAIR_USE[chair];
    if (own) return { label: own.label, use: () => ui.openManager(own.tab) };
    const plugin = pluginChair(chair);
    return plugin && { label: plugin.label, use: () => plugin.use(ui) };
  };
  const useChair = (chair: Chair) => chairUse(chair)?.use();

  const interact = () => {
    const chair = chairInHand(sittingIn(), target?.interaction ?? null);
    if (chair) return useChair(chair);
    if (!target) return;
    const i = target.interaction;
    switch (i.kind) {
      case 'agent':
        ui.openAgent(i.id, i.view);
        break;
      case 'helper':
        ui.openHelper(i.leadId, i.id);
        break;
      case 'workflow-agent': {
        const lead = [...state.agents.values()].find((a) => a.projectId === i.projectId && a.task === 'lead' && a.lead?.station === i.station);
        if (lead) ui.openWorkflowAgent(lead.id, i.workflowId, i.index);
        break;
      }
      case 'flow-hologram':
        sound.press();
        flowPrefs.set(!flowPrefs.on);
        break;
      case 'tactical-view':
        sound.press();
        railPrefs.set(!railPrefs.on);
        break;
      case 'workflow-script': {
        const lead = [...state.agents.values()].find((a) => a.projectId === i.projectId && a.task === 'lead' && (a.lead?.station ?? 0) === i.station);
        if (lead) ui.openWorkflowScript(lead.id, i.workflowId);
        break;
      }
      case 'background': {
        const lead = [...state.agents.values()].find((a) => a.projectId === i.projectId && a.task === 'lead' && (a.lead?.station ?? 0) === i.station);
        if (lead) ui.openBackground(lead.id, i.taskId);
        break;
      }
      case 'desk':
        ui.openBoard(i.projectId, 'todo');
        break;
      case 'board':
        ui.openBoard(i.projectId, i.tab);
        break;
      case 'hall-screen':
        world.room(i.projectId)?.hallScreens.find(i.plugin, i.key)?.closeUp?.(ui);
        break;
      case 'new-issue':
        ui.openNewIssue(i.projectId);
        break;
      case 'engineering':
        ui.openEngineering();
        break;
      case 'ledger':
        ui.openLedger();
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
      case 'turbolift':
        ui.openTurbolift();
        break;
      case 'sit':
        sitIn(i.chair);
        break;
      case 'screen':
        ui.openScreen(i.id);
        break;
      case 'chart':
        ui.openChart(i.id);
        break;
      case 'pane':
        sound.press();
        screenPrefs.set(i.pane, !screenPrefs.current[i.pane]);
        break;
      case 'vacant':
        ui.openManager('new-project');
        break;
      case 'energise':
        sound.press();
        if (i.projectId !== undefined && i.station !== undefined) ui.beamBack(i.projectId, i.station);
        break;
      case 'beam-to':
        ui.beamTo(i.projectId, i.station, i.room);
        break;
      case 'plugin':
        i.use(ui);
        break;
    }
  };

  window.addEventListener('keydown', (e) => {
    if (!started || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (panels.isOpen) return;
    for (const parts of startedParts.values()) {
      if (parts.keydown?.(e)) {
        e.preventDefault();
        return;
      }
    }
    // in a demo ship, - and = slow its agents down and speed them up
    if ((e.code === 'Minus' || e.code === 'Equal') && state.info?.mode === 'demo') {
      if (!e.repeat) stepDemoPace(e.code === 'Minus' ? -1 : 1, ui);
      return;
    }
    const hotkeys: Record<string, (() => void) | undefined> = {
      KeyE: interact,
      KeyT: () => ui.openTeleport(),
      KeyM: () => ui.openManager(),
      // jot a thought down in the personal log, wherever you are
      KeyI: () => ui.openManager('personal-log'),
      KeyN: () => ui.openNewIssue(world.locationOf(camera.position).projectId),
      KeyH: () => record(!document.body.classList.contains('recording')),
      KeyB: () => {
        forced = null;
        override = toggle(new Date(), override);
        localStorage.setItem(NIGHT_KEY, JSON.stringify(override));
        dark = wantNight();
        hud.toast('info', dark ? 'Night: the ship dims until morning' : 'Lights up until evening');
      },
      // the goals of the holodeck you're in; anywhere else, a plugin's view of every goal, or the first shown project's
      KeyL: () => {
        const every = everyGoal();
        const goals = goalsFor(world.locationOf(camera.position).projectId, state.shown[0]?.id, !!every);
        if (goals === 'every') every?.open(ui);
        else if (goals) ui.openGoals(goals.projectId);
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
  // ?adapt=0 keeps the picture as it starts; ?stats=1 shows how frames are going, and logs it with Focus
  const adapting = params.get('adapt') !== '0';
  const stats = params.get('stats') === '1' ? new FrameStats(renderer) : null;
  const apply = () => {
    const ratio = ladder[resolution.level];
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
  };
  const intervals: number[] = [];
  /** How long each frame's own work took (ms): its JavaScript and draw calls, not waiting on the GPU. */
  const busy: number[] = [];
  let lastFrame = performance.now();
  let lastAdapt = lastFrame;
  // the screen's refresh interval: the quickest any window's frames have come (most of them), and no slower than
  // 60 Hz, so frames slow from the start count as slow
  let refresh = 1000 / 60;
  let lastPick = 0;
  let lastLocation = 0;
  const loop = (time?: number) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    const now = performance.now();
    const interval = now - lastFrame;
    lastFrame = now;
    // a frame that long is the tab hidden, not how fast frames go: a very slow machine's are slower than a hitch
    if (interval < 1000) intervals.push(interval);
    if (now - lastAdapt > WINDOW && intervals.length >= FEWEST) {
      lastAdapt = now;
      const typical = [...intervals].sort((a, b) => a - b)[intervals.length >> 1];
      if (typical !== undefined) refresh = Math.max(4, Math.min(refresh, typical));
      if (adapting && document.visibilityState === 'visible') {
        resolution = adapt(resolution, intervals, busy, refresh, ladder, now);
        apply();
      }
      intervals.length = 0;
      busy.length = 0;
    }
    stats?.begin();
    player.enabled = !panels.isOpen;
    player.update(dt);
    const through = world.through(camera.position);
    if (through) player.transport(through.through, through.other.doorway.matrix);
    newFrame();
    setNightLevel(fade(nightLevel(), dark, dt));
    world.update(t, now, camera.position);
    feed.update(world.ahead(camera.position), now);
    sound.listen(camera);
    if (now - lastPick > 90) {
      lastPick = now;
      pick();
    }
    if (now - lastLocation > 300) {
      lastLocation = now;
      dark = wantNight();
      const where = world.locationOf(camera.position);
      hud.setLocation(where.label, where.projectId ? state.project(where.projectId)?.color : undefined);
      if (stats) stats.where = where.label;
    }
    // each drawn with only its own part of the ship: a transporter room's feed, the doorway's far side, then where you are
    gpuFrame('feed');
    feeds.render(scene, world, camera, now);
    gpuFrame('door');
    const door = portalView.render(scene, camera, world.portals, (at) => world.reveal(at));
    world.reveal(camera.position);
    gpuFrame('screen');
    view.render(scene, camera);
    const took = performance.now() - now;
    busy.push(took);
    stats?.end(interval, now, took, door);
    requestAnimationFrame(loop);
  };
  loop();

  // handy for debugging from the console
  window.focusHQ = { state, world, player, ui };
}

void main();
