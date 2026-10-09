import * as THREE from 'three';
import { columns } from '../../../shared/board';
import { holodecks } from '../../../shared/hidden';
import type { Project } from '../../../shared/types';
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
import { drawMsd } from './msd';
import { FirstOfficer } from './numberOne';
import type { Portal } from './portal';
import { type Region, regionAt, shown } from './regions';
import { buildHiddenRoom, ProjectRoom, VacantHall } from './room';
import type { Scenery } from './scenery';
import { LCARS, LCARS_FONT, lcarsFrame, type SlidingDoors } from './starship';
import { cruise } from './starfield';
import type { TeamStationKit } from './teamStation';
import { createScenery, roomTheme } from './themes';
import { pulse } from './warpCore';

export interface Place {
  label: string;
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  projectId?: string;
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
  /** The vacant holodecks' empty halls, by slot. */
  private vacant = new Map<number, VacantHall>();
  engineering: EngineeringStation | null = null;
  numberOne: FirstOfficer | null = null;
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
  /** Where the decks that stand on their own are, to tell when the camera's on one. */
  private readonly deckBoxes = { command: new THREE.Box3(), engineering: new THREE.Box3() };
  /** Whether to draw only the camera's region (`?cull=0` draws all of them, for the gap and z-fighting scans). */
  culling = true;
  private lastT = 0;
  private dashboard = makeCanvas(1280, 720);
  private dashboardTex = canvasTexture(this.dashboard.canvas);
  /** What the decks built in Blender show on their screens. */
  private readonly screens: Record<DeckScreen, THREE.Material> = { 'mission-control': flat(this.dashboardTex), msd: msdScreen() };
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
    for (const deck of this.decks()) this.mount(deck, this.root);
    this.root.add(this.briefingRooms);
    // a little beyond their walls, so you're on one in its doorways too
    this.deckBoxes.command.setFromObject(ship.command.root).expandByScalar(1);
    this.deckBoxes.engineering.setFromObject(ship.engineering.root).expandByScalar(1);
  }

  /**
   * Draws, from now on, only the part of the ship (regions.ts) that `at` is in: the camera's, before the frame's drawn,
   * and the far side's before a doorway draws it (PortalView). Null draws all of it.
   */
  reveal(at: THREE.Vector3 | null): void {
    const region: Region | null = at && this.culling ? regionAt(at, this.deckBoxes, (p) => this.inBriefingRoom(p), (p) => this.inHall(p)) : null;
    const show = shown(region);
    this.ship.command.root.visible = show.command;
    this.ship.engineering.root.visible = show.engineering;
    if (this.builder) {
      this.builder.group.visible = show.holodecks;
      this.builder.halls.visible = show.hall;
    }
    this.briefingRooms.visible = show.briefing;
  }

  private inHall(p: THREE.Vector3): boolean {
    for (const room of [...this.rooms.values(), ...this.vacant.values()]) if (room.holds(p)) return true;
    return false;
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
    const key = JSON.stringify(projects.map((p) => [p.id, p.name, p.color, p.repos, p.theme, p.hidden === true]));
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

  private build(projects: Project[]): void {
    if (this.builder) this.root.remove(this.builder.group, this.builder.halls);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
    this.engineering?.group.removeFromParent();
    this.vacant.clear();
    this.engineering?.dispose();
    this.numberOne?.group.removeFromParent();
    this.numberOne?.dispose();
    this.briefingRooms.clear();
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

    this.buildHolodeckDeck(b, rows, this.ship.holodecks);
    this.seatNumberOne(b, this.ship.command.seat('number-one'));
    this.seatEngineer(b, this.ship.engineering.seat('engineer'));

    this.root.add(b.group, b.halls);
    this.colliders = [...b.colliders, ...this.decks().flatMap((d) => d.colliders)];
    this.doors = [...b.doors, ...this.decks().flatMap((d) => d.doors)];
    this.portals = [...[...this.rooms.values()].flatMap((r) => r.portals()), ...[...this.vacant.values()].map((v) => v.portal)];
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
    return places;
  }

  /** Where stepping through a doorway takes you, if `eye` has just stepped into one (Player.transport). */
  through(eye: THREE.Vector3): THREE.Matrix4 | null {
    for (const portal of this.portals) {
      const through = portal.crossing(eye);
      if (through) return through;
    }
    return null;
  }

  /** Human name of where a world position is. */
  locationOf(p: THREE.Vector3): { label: string; projectId?: string } {
    for (const room of this.rooms.values()) {
      if (room.holds(p)) return { label: room.project.name, projectId: room.project.id };
      const station = room.briefingRoomOf(p);
      if (station !== undefined) return { label: `${room.project.name} · briefing room ${station + 1}`, projectId: room.project.id };
    }
    for (const deck of this.decks()) {
      const label = deck.areaAt(p);
      if (label) return { label };
    }
    for (const hall of this.vacant.values()) if (hall.holds(p)) return { label: 'Vacant holodeck' };
    if (Math.abs(p.x) < HALL_HALF) return { label: 'Corridor' };
    const index = slotAt(Math.floor(-p.z / ROOM_WIDTH), p.x > 0 ? 1 : -1);
    const room = [...this.rooms.values()].find((r) => r.slot.index === index);
    if (room) return { label: room.project.name, projectId: room.project.id };
    return { label: this.inUse.has(index) ? 'Holodeck in use' : 'Vacant holodeck' };
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

  room(projectId: string): ProjectRoom | undefined {
    return this.rooms.get(projectId);
  }

  get interactRoot(): THREE.Object3D {
    return this.root;
  }
}

/** Main engineering's MSD: a cutaway of the ship, drawn once (msd.ts). */
function msdScreen(): THREE.Material {
  const { canvas, ctx } = makeCanvas(1560, 600);
  drawMsd(ctx, canvas.width, canvas.height);
  return flat(canvasTexture(canvas));
}
