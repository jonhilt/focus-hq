import * as THREE from 'three';
import { hallScreens } from '../plugins';
import { columns } from '../../../shared/board';
import { holodecks } from '../../../shared/hidden';
import type { Project, StudioTake } from '../../../shared/types';
import { ACTIVE_STATUSES } from '../../../shared/types';
import { state } from '../net/state';
import { Builder } from './builder';
import type { Deck } from './deck';
import type { HolodeckDeck } from './holodeckDeck';
import type { DeckScreen } from './deckExtras';
import { canvasTexture, fitText, makeCanvas, roundRect } from './canvas';
import { type Box2, DOOR_W, HALL_HALF, ROOM_WIDTH, roomSlot, rowsFor, type Seat, slotAt, SUN_POSITION } from './layout';
import { flat } from './materials';
import { EngineeringStation } from './engineering';
import { drawMsd, type MsdBoard } from './msd';
import { FirstOfficer } from './numberOne';
import { TrainingConsole } from './trainingConsole';
import { AHEAD, type Portal, type PortalEnd } from './portal';
import { type Region, regionAt, shown } from './regions';
import { buildHiddenRoom, ProjectRoom, VacantHall } from './room';
import type { ScenePlayback } from './studio';
import type { StudioSet } from './studioHall';
import { api } from '../net/api';
import type { Scenery } from './scenery';
import { LCARS, LCARS_FONT, lcarsFrame, type SlidingDoors } from './starship';
import { cruise } from './starfield';
import type { TeamStation, TeamStationKit } from './teamStation';
import type { TransporterRoom } from './transporterRoom';
import { createScenery, roomTheme } from './themes';
import { pulse } from './warpCore';

export interface Place {
  label: string;
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  projectId?: string;
  /** Somewhere a script can go (`ui.goTo`) but the teleport panel doesn't list: a transporter room, which you beam into. */
  unlisted?: boolean;
}


/**
 * The ship the World builds, its decks built in Blender (blender/): the command deck (the bridge, and the ready room
 * and lounge, with Number One), the holodeck deck, with a holodeck per project either side of its hallway and the
 * turbolift at its head, and main engineering, with the warp core and the chief engineer.
 */
export interface Ship {
  command: Deck;
  holodecks: HolodeckDeck;
  engineering: Deck;
}

/** Builds and owns the whole ship: its decks, and a holodeck per project, each with its team stations' briefing rooms. */
export class World {
  readonly root = new THREE.Group();
  colliders: Box2[] = [];
  rooms = new Map<string, ProjectRoom>();
  /** The captain's controls for the scene in the studio, if there's a studio. */
  studioPlayback(): ScenePlayback | null {
    return [...this.vacant.values()][0]?.studioPlayback ?? null;
  }

  /** The studio's set, if there's a studio: its shelf, opened round the camera. */
  studioSet(): StudioSet | null {
    return [...this.vacant.values()][0]?.studioSet ?? null;
  }

  /** The scene standing in the studio, if there is one. */
  studioScene(): StudioTake | null {
    return [...this.vacant.values()][0]?.studioScene ?? null;
  }

  /** The vacant holodecks' empty halls, by slot. */
  private vacant = new Map<number, VacantHall>();
  engineering: EngineeringStation | null = null;
  numberOne: FirstOfficer | null = null;
  /** The training console on the bridge: only in a demo office (`demo`, set before the first sync). */
  training: TrainingConsole | null = null;
  demo = false;
  /** The holodeck deck, as put together for the rows the ship has now. */
  private holodeckDeck: Deck[] = [];
  /** Room landscapes by project, theme and slot; kept across rebuilds since they're slow to make. */
  private sceneries = new Map<string, Scenery>();
  private builder: Builder | null = null;
  private doors: SlidingDoors[] = [];
  /** The doorways between each holodeck and its team stations' briefing rooms. */
  portals: Portal[] = [];
  /** Every team station's briefing room, apart from the holodeck deck they're reached from (regions.ts). */
  private readonly briefingRooms = new THREE.Group();
  /** Every team station's transporter rooms, each drawn only while the camera's in it, or a feed reveals it (`reveal`). */
  private readonly transporterGroup = new THREE.Group();
  transporterRooms: TransporterRoom[] = [];
  /** Where the decks that stand on their own are, to tell when the camera's on one. */
  private readonly deckBoxes = { command: new THREE.Box3(), engineering: new THREE.Box3() };
  /** Whether to draw only the camera's region (`?cull=0` draws all of them, for the gap and z-fighting scans). */
  culling = true;
  private lastT = 0;
  private dashboard = makeCanvas(1280, 720);
  private dashboardTex = canvasTexture(this.dashboard.canvas);
  /** What the decks built in Blender show on their screens. */
  /** Main engineering's MSD: the ship, and the ledger beside it (msd.ts). */
  private msd = makeCanvas(1560, 600);
  private msdTex = canvasTexture(this.msd.canvas);
  private msdBoard: MsdBoard = { kind: 'report', card: null };
  private readonly screens: Record<DeckScreen, THREE.Material> = { 'mission-control': flat(this.dashboardTex), msd: flat(this.msdTex) };
  private panelsDirty = true;
  private lastPanels = 0;
  private projectKey = '';
  /** Holodecks of hidden projects: locked, and nameless. */
  private inUse = new Set<number>();

  constructor(
    scene: THREE.Scene,
    private readonly ship: Ship,
    /** The door and briefing room every team station is a copy of (loadTeamStation). */
    private readonly teamStation: TeamStationKit,
    /** The shell every project's training hall is a copy of (loadTrainingHall), through its holodeck's door. */
    private readonly hallKit: THREE.Object3D,
  ) {
    scene.add(this.root);
    this.drawMsd(this.msdBoard);
    for (const deck of this.decks()) this.mount(deck, this.root);
    this.root.add(this.briefingRooms, this.transporterGroup);
    // a little beyond their walls, so you're on one in its doorways too
    this.deckBoxes.command.setFromObject(ship.command.root).expandByScalar(1);
    this.deckBoxes.engineering.setFromObject(ship.engineering.root).expandByScalar(1);
  }

  /**
   * Draws, from now on, only the part of the ship (regions.ts) that `at` is in: the camera's, before the frame's drawn,
   * and the far side's before a doorway draws it (PortalView). In a transporter room, only that room: a feed of one
   * reveals from inside it (its `camera.at`) before it renders, and the camera's position puts things back. In a
   * training hall, only that hall: the others stand out in the world beyond its walls, and from a briefing room's door
   * the far ones' screens and signs would all be sent to the GPU at once. Null draws all of it.
   */
  reveal(at: THREE.Vector3 | null): void {
    const region: Region | null = at && this.culling ? regionAt(at, this.deckBoxes, (p) => this.inBriefingRoom(p), (p) => this.inHall(p), (p) => !!this.transporterRoomAt(p)) : null;
    const show = shown(region);
    const transporter = at && region === 'transporter' ? this.transporterRoomAt(at) : undefined;
    for (const room of this.transporterRooms) room.group.visible = show.transporter && (!region || room === transporter);
    this.ship.command.root.visible = show.command;
    this.ship.engineering.root.visible = show.engineering;
    if (this.builder) {
      this.builder.group.visible = show.holodecks;
      this.builder.halls.visible = show.hall;
      const inHall = (hall: ProjectRoom | VacantHall) => (hall.group.visible = region !== 'hall' || (!!at && hall.holds(at)));
      this.rooms.forEach(inHall);
      this.vacant.forEach(inHall);
    }
    this.briefingRooms.visible = show.briefing;
  }

  private inHall(p: THREE.Vector3): boolean {
    for (const room of [...this.rooms.values(), ...this.vacant.values()]) if (room.holds(p)) return true;
    return false;
  }

  /** What's about to come into view through a door `camera`'s nearing (ProjectRoom.ahead). */
  ahead(camera: THREE.Vector3): THREE.Object3D[] {
    return [...this.rooms.values()].flatMap((room) => room.ahead(camera));
  }

  /** Every holodeck's team stations. */
  stations(): TeamStation[] {
    return [...this.rooms.values()].flatMap((r) => r.teamStations());
  }

  /** The team station whose briefing room a world position is in, if any. */
  stationAt(p: THREE.Vector3): TeamStation | undefined {
    return this.stations().find((s) => s.inside(p));
  }

  /** The team station `station` of `projectId`'s holodeck. */
  station(projectId: string, station: number): TeamStation | undefined {
    return this.rooms.get(projectId)?.teamStations()[station];
  }

  /** The transporter room a world position is in, if it's in one. */
  transporterRoomAt(p: THREE.Vector3): TransporterRoom | undefined {
    return this.transporterRooms.find((room) => room.inside(p));
  }

  private inBriefingRoom(p: THREE.Vector3): boolean {
    for (const room of this.rooms.values()) if (room.briefingRoomOf(p) !== undefined) return true;
    return false;
  }

  /** Puts a deck built in Blender into `parent`, its screens showing what the World draws for them. */
  private mount(deck: Deck, parent: THREE.Object3D): void {
    parent.add(deck.root);
    for (const { screen, mesh } of deck.screens) mesh.material = this.screens[screen];
  }

  /** The decks aboard the ship. */
  private decks(): Deck[] {
    return [this.ship.command, ...this.holodeckDeck, this.ship.engineering];
  }

  /** Rebuilds the building when the set of projects (or their names/colours/repos, or which are hidden) changes. */
  sync(projects: Project[]): void {
    const key = JSON.stringify([this.demo, projects.map((p) => [p.id, p.name, p.color, p.repos, p.theme, p.hidden === true])]);
    if (key === this.projectKey) {
      for (const room of this.rooms.values()) {
        room.project = projects.find((p) => p.id === room.project.id) ?? room.project;
        room.markBoard();
        // a goal joining or leaving the line changes what a free team station says
        room.syncStations();
      }
      this.panelsDirty = true;
      return;
    }
    this.projectKey = key;
    this.build(projects);
  }

  /** The plugins' screens in each holodeck, hung again from what the plugins switched on say now. */
  syncHallScreens(): void {
    for (const room of this.rooms.values()) room.hallScreens.sync(hallScreens(room.project.id));
  }

  private build(projects: Project[]): void {
    if (this.builder) this.root.remove(this.builder.group, this.builder.halls);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
    this.engineering?.group.removeFromParent();
    for (const hall of this.vacant.values()) hall.dispose();
    this.vacant.clear();
    this.engineering?.dispose();
    this.numberOne?.group.removeFromParent();
    this.numberOne?.dispose();
    this.training?.group.removeFromParent();
    this.training?.dispose();
    this.training = null;
    this.briefingRooms.clear();
    this.transporterGroup.clear();
    const b = new Builder();
    this.builder = b;

    const rows = rowsFor(projects.length);
    const decks = holodecks(projects, rows * 2);
    this.inUse = new Set(decks.flatMap((deck, i) => (deck.kind === 'in-use' ? [i] : [])));

    // rooms
    const previous = this.sceneries;
    this.sceneries = new Map();
    decks.forEach((deck, i) => {
      const slot = roomSlot(i);
      if (deck.kind === 'vacant') return void this.vacant.set(i, new VacantHall(slot, b, this.hallKit));
      if (deck.kind === 'in-use') return void buildHiddenRoom(slot, b);
      const { project } = deck;
      const theme = roomTheme(project);
      const key = `${project.id}|${theme}|${i}`;
      let scenery = previous.get(key) ?? null;
      previous.delete(key);
      // the stencil value (slot + 1) and the sun direction both depend on the slot, hence the key
      scenery ??= createScenery(theme, i + 1, project.id, SUN_POSITION.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -slot.rotationY));
      if (scenery) this.sceneries.set(key, scenery);
      this.rooms.set(project.id, new ProjectRoom(project, slot, b, scenery, this.teamStation, this.hallKit));
    });
    for (const scenery of previous.values()) scenery.dispose();
    // the briefing rooms stand apart from the holodeck deck, and are drawn apart from it
    for (const room of this.rooms.values()) for (const briefing of room.briefingRooms()) this.briefingRooms.add(briefing);
    // and the transporter rooms far off, each drawn apart from all of them
    this.transporterRooms = [...this.rooms.values()].flatMap((r) => r.transporterRooms());
    for (const room of this.transporterRooms) this.transporterGroup.add(room.group);

    this.buildHolodeckDeck(b, rows, this.ship.holodecks);
    this.seatNumberOne(b, this.ship.command.seat('number-one'));
    this.seatEngineer(b, this.ship.engineering.seat('engineer'));
    if (this.demo) this.placeTraining(b);

    this.root.add(b.group, b.halls);
    this.colliders = [...b.colliders, ...this.decks().flatMap((d) => d.colliders)];
    this.doors = [...b.doors, ...this.decks().flatMap((d) => d.doors)];
    this.portals = [...[...this.rooms.values()].flatMap((r) => r.portals()), ...[...this.vacant.values()].map((v) => v.portal)];
    this.syncStudio();
    this.panelsDirty = true;
  }

  /** The holodeck deck built in Blender, put together for `rows` rows, and the holodecks' doors, which lock for hidden projects. */
  private buildHolodeckDeck(b: Builder, rows: number, holodecks: HolodeckDeck): void {
    const deck = holodecks.assemble(rows);
    this.holodeckDeck = [deck.head, ...deck.rows, deck.tail];
    for (const part of this.holodeckDeck) this.mount(part, b.group);
    // a project's or vacant holodeck's door is a doorway to its hall, with doors of its own (room.ts); only a hidden
    // project's needs doors here, locked
    const halls = new Set([...[...this.rooms.values()].map((r) => r.slot.index), ...this.vacant.keys()]);
    for (let i = 0; i < rows * 2; i++) {
      if (halls.has(i)) continue;
      const { side, center } = roomSlot(i);
      b.slidingDoors(new THREE.Vector3(side * HALL_HALF, 0, center.z), Math.PI / 2, DOOR_W, this.inUse.has(i));
    }
  }

  private seatEngineer(b: Builder, seat: Seat): void {
    this.engineering = new EngineeringStation(seat);
    // on the engineering deck's gallery: drawn with it
    this.ship.engineering.root.add(this.engineering.group);
    b.colliders.push(this.engineering.footprint);
  }

  private seatNumberOne(b: Builder, seat: Seat): void {
    this.numberOne = new FirstOfficer(seat);
    // in the ready room: drawn with the command deck
    this.ship.command.root.add(this.numberOne.group);
    b.colliders.push(this.numberOne.footprint);
  }

  /**
   * The training console, on the bridge's starboard side aft of the rail, on your right as you come aboard: its seat
   * faces starboard, so its screen faces the walkway in from the turbolift.
   */
  private placeTraining(b: Builder): void {
    const boarding = this.boarding();
    const ahead = boarding.lookAt.clone().sub(boarding.position).setY(0).normalize();
    const starboard = new THREE.Vector3(-ahead.z, 0, ahead.x);
    // you come aboard 5.8 m aft of the middle of the bridge (blender/command_deck.py)
    const at = boarding.position.clone().setY(0).addScaledVector(ahead, 5.8 - 4.6).addScaledVector(starboard, 2.4);
    this.training = new TrainingConsole({ at, facing: at.clone().add(starboard) });
    this.ship.command.root.add(this.training.group);
    b.colliders.push(this.training.footprint);
  }

  /** Where you come aboard: the bridge, which sorts first of the command deck's places. */
  boarding(): Place {
    return this.ship.command.places[0];
  }

  /** Where the turbolift stops: in each deck's car. */
  stops(): Place[] {
    return this.decks().flatMap((d) => d.stops);
  }

  /** Teleport destinations. */
  places(): Place[] {
    const places: Place[] = this.decks().flatMap((d) => d.places);
    for (const room of this.rooms.values()) {
      places.push({
        label: room.project.name,
        projectId: room.project.id,
        ...room.arrival(),
      });
    }
    for (const t of this.transporterRooms) {
      const project = this.rooms.get(t.projectId)?.project.name ?? t.projectId;
      places.push({ label: `Transporter room ${t.index + 1} · TS-${t.station + 1} · ${project}`, position: t.place.at.clone(), lookAt: t.place.lookAt.clone(), unlisted: true });
    }
    return places;
  }

  /** The doorway `eye` has just stepped into, if any: its `through` is where that takes you (Player.transport). */
  through(eye: THREE.Vector3): PortalEnd | null {
    for (const portal of this.portals) {
      const end = portal.crossing(eye);
      if (end) return end;
    }
    return null;
  }

  /** Human name of where a world position is. */
  locationOf(p: THREE.Vector3): { label: string; projectId?: string } {
    const transporter = this.transporterRoomAt(p);
    if (transporter) {
      const project = this.rooms.get(transporter.projectId)?.project;
      return { label: `${project?.name ?? ''} · transporter room ${transporter.index + 1} · TS-${transporter.station + 1}`, projectId: transporter.projectId };
    }
    for (const room of this.rooms.values()) {
      if (room.holds(p)) return { label: room.project.name, projectId: room.project.id };
      const station = room.briefingRoomOf(p);
      if (station !== undefined) return { label: `${room.project.name} · briefing room ${station + 1}`, projectId: room.project.id };
    }
    for (const deck of this.decks()) {
      const label = deck.areaAt(p);
      if (label) return { label };
    }
    for (const hall of this.vacant.values()) if (hall.holds(p)) return { label: hall.isStudio ? 'Studio' : 'Vacant holodeck' };
    if (Math.abs(p.x) < HALL_HALF) return { label: 'Corridor' };
    const index = slotAt(Math.floor(-p.z / ROOM_WIDTH), p.x > 0 ? 1 : -1);
    const room = [...this.rooms.values()].find((r) => r.slot.index === index);
    if (room) return { label: room.project.name, projectId: room.project.id };
    return { label: this.inUse.has(index) ? 'Holodeck in use' : 'Vacant holodeck' };
  }

  /**
   * A change to what main engineering's MSD can show beside the ship (the ledger's report card, or a plugin's board):
   * redrawn only while that's what's up, so whatever the captain put up stays until they put up something else.
   */
  showOnMsd(board: MsdBoard): void {
    const up = this.msdBoard;
    if (board.kind === up.kind && (board.kind !== 'plugin' || (up.kind === 'plugin' && up.id === board.id))) this.drawMsd(board);
  }

  /** Puts `board` up on the MSD: a trace picked at the master systems table, a plugin's board, or the report card back. */
  putOnMsd(board: MsdBoard): void {
    this.drawMsd(board);
  }

  private drawMsd(board: MsdBoard): void {
    this.msdBoard = board;
    drawMsd(this.msd.ctx, this.msd.canvas.width, this.msd.canvas.height, board);
    this.msdTex.needsUpdate = true;
  }

  markPanels(): void {
    this.panelsDirty = true;
  }

  update(t: number, now: number, camera: THREE.Vector3): void {
    const dt = Math.min(0.1, t - this.lastT);
    this.lastT = t;
    cruise(t);
    pulse(t);
    for (const door of this.doors) door.update(camera, dt);
    for (const portal of this.portals) portal.update(camera, dt);
    for (const room of this.rooms.values()) room.update(t, now, camera);
    for (const hall of this.vacant.values()) if (hall.holds(camera) || hall.portal.near(camera, AHEAD)) hall.update(t, camera);
    this.engineering?.update(t, camera);
    this.numberOne?.update(t, camera);
    if (this.panelsDirty && now - this.lastPanels > 1000) {
      this.panelsDirty = false;
      this.lastPanels = now;
      this.drawDashboard();
    }
  }

  private drawDashboard(): void {
    const { canvas, ctx } = this.dashboard;
    const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: 'Mission control', color: LCARS.orange, seed: 74656 });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // hidden projects don't count: the totals would give them away
    const projects = state.shown;
    const agents = state.shownAgents();
    const working = agents.filter((a) => ACTIVE_STATUSES.includes(a.status) && a.status !== 'waiting').length;
    const waiting = agents.filter((a) => a.status === 'waiting').length;
    const prs = projects.reduce((n, p) => n + (state.boards.get(p.id)?.prs.length ?? 0), 0);
    const todo = projects.reduce((n, p) => n + columns(p, state.boards.get(p.id), state.agentsIn(p.id), state.info?.github.login).todo.length, 0);
    const tiles: [string, number, string][] = [
      ['working', working, LCARS.sky],
      ['need you', waiting, LCARS.gold],
      ['to do', todo, LCARS.orange],
      ['PRs ready', prs, LCARS.lilac],
    ];
    const tileW = (area.w - 3 * 18) / 4;
    tiles.forEach(([label, value, color], i) => {
      const x = area.x + i * (tileW + 18);
      ctx.fillStyle = color;
      roundRect(ctx, x, area.y, tileW, 14, 7);
      ctx.fill();
      ctx.font = `600 92px ${LCARS_FONT}`;
      ctx.fillText(String(value), x + 4, area.y + 80);
      ctx.fillStyle = LCARS.peach;
      ctx.font = `500 30px ${LCARS_FONT}`;
      ctx.fillText(label.toUpperCase(), x + 4, area.y + 150);
    });
    let y = area.y + 230;
    if (projects.length === 0) {
      ctx.fillStyle = LCARS.peach;
      ctx.font = `500 34px ${LCARS_FONT}`;
      ctx.fillText('NO PROJECTS YET – PRESS E HERE TO CREATE YOUR FIRST ONE.', area.x, y);
    }
    for (const p of projects.slice(0, 5)) {
      const cols = columns(p, state.boards.get(p.id), state.agentsIn(p.id), state.info?.github.login);
      ctx.fillStyle = p.color;
      roundRect(ctx, area.x, y - 22, 60, 44, 22);
      ctx.fill();
      ctx.fillStyle = LCARS.peach;
      ctx.font = `600 38px ${LCARS_FONT}`;
      ctx.fillText(fitText(ctx, p.name.toUpperCase(), 520), area.x + 80, y);
      ctx.fillStyle = LCARS.sky;
      ctx.font = `500 30px ${LCARS_FONT}`;
      ctx.fillText(`📋 ${cols.todo.length}   🎯 ${cols.goals.length}   🔨 ${cols.doing.length}   👀 ${cols.prs.length}`, area.x + 640, y);
      y += 66;
    }
    const info = state.info;
    const bottom = area.y + area.h;
    ctx.fillStyle = info?.github.ok ? LCARS.sky : LCARS.red;
    ctx.font = `500 28px ${LCARS_FONT}`;
    ctx.fillText((info ? (info.github.ok ? `● GitHub: ${info.github.login}` : '● GitHub not connected') : '● connecting…').toUpperCase(), area.x, bottom);
    ctx.textAlign = 'right';
    ctx.fillStyle = LCARS.lilac;
    ctx.fillText((info?.mode === 'demo' ? 'Demo mode' : `autonomy: ${info?.settings.autonomy ?? '?'}`).toUpperCase(), area.x + area.w, bottom);
    this.dashboardTex.needsUpdate = true;
  }

  /**
   * The studio: the first vacant holodeck, where the captain describes something and its computer builds it (studio.ts). It
   * stays the studio while the ship has a vacant holodeck; a new project takes the next one.
   */
  syncStudio(): void {
    const hall = [...this.vacant.values()][0];
    if (!hall || !state.studio) return;
    hall.showStudio(state.studio, (take, error, sheet) => void api.studioReport(take.id, take.version, error, sheet).catch(() => undefined));
    // its bigger hall's walls in place of the hall's own, once, in the same array the player walks among
    const swap = hall.studioColliders;
    if (swap && swap.drop.size + swap.add.length && !this.colliders.includes(swap.add[0])) {
      const kept = this.colliders.filter((b) => !swap.drop.has(b));
      this.colliders.splice(0, this.colliders.length, ...kept, ...swap.add);
    }
  }

  /** The vacant holodecks' empty halls: the studio stages its scenes in one (ui/holoStage.ts). */
  vacantHalls(): VacantHall[] {
    return [...this.vacant.values()];
  }

  room(projectId: string): ProjectRoom | undefined {
    return this.rooms.get(projectId);
  }

  get interactRoot(): THREE.Object3D {
    return this.root;
  }
}
