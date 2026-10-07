import * as THREE from 'three';
import { columns } from '../../../shared/board';
import { holodecks } from '../../../shared/hidden';
import type { Project } from '../../../shared/types';
import { ACTIVE_STATUSES } from '../../../shared/types';
import { state } from '../net/state';
import { Builder, interactive } from './builder';
import type { Deck } from './deck';
import type { HolodeckDeck } from './holodeckDeck';
import type { DeckScreen } from './deckExtras';
import { canvasTexture, fitText, makeCanvas, roundRect } from './canvas';
import { type Box2, contains, DOOR_W, HALL_HALF, LOBBY, LOUNGE, LOUNGE_DOOR_X, OFFICE, OVER_DOOR, ROOM_DEPTH, ROOM_WIDTH, roomSlot, roomToWorld, rowsFor, type Seat, slotAt, SUN_POSITION, WALL_H, WALL_T } from './layout';
import { box, flat, toon, toonMaterial } from './materials';
import { bookshelf, ceilingLight, chair, coffeeMachine, cyl, desk, DESK_TOP, plant, rug, sofa, trophy, waterCooler } from './props';
import { EngineeringStation } from './engineering';
import { Lounge } from './lounge';
import { FirstOfficer } from './numberOne';
import type { Portal } from './portal';
import { buildHiddenRoom, buildVacantRoom, ProjectRoom } from './room';
import type { Scenery } from './scenery';
import { tiled } from './textures';
import { HULL, LCARS, LCARS_FONT, lcarsConsole, lcarsFrame, lcarsSign, type SlidingDoors, viewport } from './starship';
import { cruise } from './starfield';
import type { TeamStationKit } from './teamStation';
import { createScenery, roomTheme } from './themes';

export interface Place {
  label: string;
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  projectId?: string;
}

const OUTER_X = HALL_HALF + ROOM_DEPTH;
const HALF_D = ROOM_DEPTH / 2;
const OFFICE_WALL = '#cfd3e6';
const CONCOURSE: Place = { label: '🛋️ Concourse', position: new THREE.Vector3(0, 0, LOBBY.z1 - 1.2), lookAt: new THREE.Vector3(0, 1.6, 0) };

/**
 * The ship the World builds: as it is, all built here, or as it'll be (`?ship=next`), its decks built in Blender: the
 * command deck (the bridge, and the ready room and lounge, with Number One), and the holodeck deck, whose hallway and
 * holodecks stand where the old ones do, and whose turbolift and engineering stand in for the concourse.
 */
export type Ship = { kind: 'current' } | { kind: 'next'; command: Deck; holodecks: HolodeckDeck };

/** A room north of the lobby: the floor it covers, where to teleport to in it, and the way the directory points to it. */
interface NorthRoom {
  name: string;
  area: Box2;
  way: string;
  place: Place;
}

/** Builds and owns the whole office: lobby, manager's office, hallway and one room per project. */
export class World {
  readonly root = new THREE.Group();
  colliders: Box2[] = [];
  rooms = new Map<string, ProjectRoom>();
  engineering: EngineeringStation | null = null;
  numberOne: FirstOfficer | null = null;
  private lounge: Lounge | null = null;
  private northRooms: NorthRoom[] = [];
  /** The holodeck deck, as put together for the rows the ship has now (on the next ship). */
  private holodeckDeck: Deck[] = [];
  /** Room landscapes by project, theme and slot; kept across rebuilds since they're slow to make. */
  private sceneries = new Map<string, Scenery>();
  private builder: Builder | null = null;
  private doors: SlidingDoors[] = [];
  /** The doorways between each holodeck and its team stations' briefing rooms. */
  portals: Portal[] = [];
  private lastT = 0;
  private dashboard = makeCanvas(1280, 720);
  private dashboardTex = canvasTexture(this.dashboard.canvas);
  private directory = makeCanvas(768, 1024);
  private directoryTex = canvasTexture(this.directory.canvas);
  /** What the decks built in Blender show on their screens. */
  private readonly screens: Record<DeckScreen, THREE.Material> = { 'mission-control': flat(this.dashboardTex) };
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
  ) {
    scene.add(this.root);
    for (const deck of this.decks()) this.mount(deck, this.root);
  }

  /** Puts a deck built in Blender into `parent`, its screens showing what the World draws for them. */
  private mount(deck: Deck, parent: THREE.Object3D): void {
    parent.add(deck.root);
    for (const { screen, mesh } of deck.screens) mesh.material = this.screens[screen];
  }

  /** The decks built in Blender aboard the ship. */
  private decks(): Deck[] {
    switch (this.ship.kind) {
      case 'current':
        return [];
      case 'next':
        return [this.ship.command, ...this.holodeckDeck];
    }
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
    if (this.builder) this.root.remove(this.builder.group);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
    this.lounge?.dispose();
    this.engineering?.dispose();
    this.numberOne?.dispose();
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
      if (deck.kind === 'vacant') return void buildVacantRoom(slot, b);
      if (deck.kind === 'in-use') return void buildHiddenRoom(slot, b);
      const { project } = deck;
      const theme = roomTheme(project);
      const key = `${project.id}|${theme}|${i}`;
      let scenery = previous.get(key) ?? null;
      previous.delete(key);
      // the stencil value (slot + 1) and the sun direction both depend on the slot, hence the key
      scenery ??= createScenery(theme, i + 1, project.id, SUN_POSITION.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -slot.rotationY));
      if (scenery) this.sceneries.set(key, scenery);
      this.rooms.set(project.id, new ProjectRoom(project, slot, b, scenery, this.teamStation));
    });
    for (const scenery of previous.values()) scenery.dispose();

    switch (this.ship.kind) {
      case 'current':
        this.buildHallway(b, rows);
        this.buildLobby(b);
        this.buildReadyRoom(b);
        this.buildEngineering(b);
        break;
      case 'next':
        this.buildHolodeckDeck(b, rows, this.ship.holodecks);
        this.seatNumberOne(b, this.ship.command.seat('number-one'));
        break;
    }

    this.root.add(b.group);
    this.colliders = [...b.colliders, ...this.decks().flatMap((d) => d.colliders)];
    this.doors = [...b.doors, ...this.decks().flatMap((d) => d.doors)];
    this.portals = [...this.rooms.values()].flatMap((r) => r.portals());
    this.panelsDirty = true;
  }

  /** The holodecks' hallway, from the concourse south, its walls and the holodecks' doors, which lock for hidden projects. */
  private buildHallway(b: Builder, rows: number): void {
    const hallEnd = -rows * ROOM_WIDTH;
    // floors and ceiling
    b.floor(-HALL_HALF, HALL_HALF, hallEnd, 0, toon('#ffffff', { map: tiled.carpet(HULL.carpet, 3, -hallEnd / 2) }));
    // the hallway grows with every project, so lifting the edge strips clear of the carpet would never be enough from
    // its far end: they win the depth test by offset instead
    const edge = toonMaterial({ color: HULL.carpetEdge, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    for (const s of [-1, 1]) b.floor(s * (HALL_HALF - 0.45), s * (HALL_HALF - 0.3), hallEnd, 0, edge);
    b.ceiling(-OUTER_X, OUTER_X, hallEnd, 0);

    // walls
    const roomWall = HULL.bulkhead;
    // Walls run unbroken between corners: two lengths meeting end to end leave a seam that flickers down their face.
    for (const s of [-1, 1] as const) {
      const roomDoors = Array.from({ length: rows }, (_, r) => ({ at: -(r + 0.5) * ROOM_WIDTH, width: DOOR_W, locked: this.inUse.has(slotAt(r, s)) }));
      b.wall(s * HALL_HALF, hallEnd, s * HALL_HALF, 0, roomWall, roomDoors);
      b.wall(s * OUTER_X, hallEnd, s * OUTER_X, 0, roomWall);
    }
    for (let r = 0; r < rows; r++) {
      const z0 = -r * ROOM_WIDTH;
      const z1 = -(r + 1) * ROOM_WIDTH;
      b.wall(HALL_HALF, z0, OUTER_X, z0, roomWall);
      b.wall(-OUTER_X, z0, -HALL_HALF, z0, roomWall);
      // a strip light down the middle of the corridor, and LCARS consoles between the doors
      const light = ceilingLight(0.5, ROOM_WIDTH - 1.2);
      light.position.set(0, WALL_H - 0.03, (z0 + z1) / 2);
      b.add(light);
      for (const s of [-1, 1]) {
        const console = lcarsConsole(1.5, 0.95, r * 2 + (s > 0 ? 0 : 1));
        console.position.set(s * (HALL_HALF - 0.13), 1.95, (z0 + z1) / 2 + s * (r % 2 ? 1 : -1) * 3.6);
        console.rotation.y = -s * (Math.PI / 2);
        b.add(console);
      }
    }
    b.wall(-OUTER_X, hallEnd, OUTER_X, hallEnd, roomWall);
    const endWindow = viewport(2.4, 1.6);
    endWindow.position.set(0, 1.9, hallEnd + WALL_T / 2 + 0.005);
    b.add(endWindow);
  }

  /** The holodeck deck built in Blender, put together for `rows` rows, and the holodecks' doors, which lock for hidden projects. */
  private buildHolodeckDeck(b: Builder, rows: number, holodecks: HolodeckDeck): void {
    const deck = holodecks.assemble(rows);
    this.holodeckDeck = [deck.head, ...deck.rows, deck.tail];
    for (const part of this.holodeckDeck) this.mount(part, b.group);
    for (let i = 0; i < rows * 2; i++) {
      const { side, center } = roomSlot(i);
      b.slidingDoors(new THREE.Vector3(side * HALL_HALF, 0, center.z), Math.PI / 2, DOOR_W, this.inUse.has(i));
    }
    this.seatEngineer(b, deck.head.seat('engineer'));
  }

  /** Against the concourse's south wall, east of the corridor: the first post you pass on the way up from the holodecks. */
  private buildEngineering(b: Builder): void {
    const x = 4.8;
    this.seatEngineer(b, { at: new THREE.Vector3(x, 0, LOBBY.z0 + 1.35), facing: new THREE.Vector3(x, 0, LOBBY.z0) });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.42), flat(lcarsSign('Engineering', { color: LCARS.gold, code: '04-07', h: 216 })));
    sign.position.set(x, 2.82, LOBBY.z0 + 0.12);
    b.add(sign);
    const board = lcarsConsole(1.8, 0.8, 43);
    board.position.set(x, 2.0, LOBBY.z0 + 0.13);
    b.add(board);
  }

  private buildLobby(b: Builder): void {
    b.floor(LOBBY.x0, LOBBY.x1, LOBBY.z0, LOBBY.z1, toon('#ffffff', { map: tiled.carpet('#4a3f6e', 6, 4) }));
    b.ceiling(-OUTER_X, OUTER_X, LOBBY.z0, LOBBY.z1);
    const lobbyWall = '#e2d6dc';
    b.wall(LOBBY.x0, LOBBY.z0, LOBBY.x0, LOBBY.z1, lobbyWall);
    b.wall(LOBBY.x1, LOBBY.z0, LOBBY.x1, LOBBY.z1, lobbyWall);
    // hanging sign over the hallway entrance
    const hallSign = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 0.62), flat(lcarsSign('Holodecks', { color: LCARS.periwinkle, sub: 'one per project', code: 'Deck 4' })));
    hallSign.position.set(0, 2.75, 0.15);
    b.add(hallSign);
    // big welcome logo on the west wall + directory
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.1), flat(lcarsSign('U.S.S. Focus HQ', { w: 1024, h: 245, color: LCARS.gold, sub: 'crewed by Claude Code agents', code: 'NCC-4477' })));
    const lz = (LOBBY.z0 + LOBBY.z1) / 2;
    logo.position.set(LOBBY.x0 + 0.13, 2.25, lz);
    logo.rotation.y = Math.PI / 2;
    b.add(logo);
    const directory = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.0), flat(this.directoryTex));
    directory.position.set(LOBBY.x0 + 0.15, 1.25, LOBBY.z1 - 1.6);
    directory.rotation.y = Math.PI / 2;
    b.add(directory);
    b.add(box(0.1, 2.2, 1.7, '#495057', LOBBY.x0 + 0.08, 0.15, LOBBY.z1 - 1.6));
    interactive(directory, { kind: 'teleport' }, () => 'Ship’s directory – jump to a holodeck');

    // reception desk
    const reception = new THREE.Group();
    reception.position.set(LOBBY.x0 + 2.6, 0, lz - 1.4);
    reception.add(box(1.0, 1.05, 3.0, '#ff922b', 0, 0, 0));
    reception.add(box(1.2, 0.08, 3.2, '#ffffff', 0, 1.05, 0));
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon('#ffd43b'));
    bell.position.set(0.3, 1.13, 0.8);
    reception.add(bell);
    b.add(reception);
    b.collideObject(reception);

    const couch = sofa('#4dabf7');
    couch.position.set(LOBBY.x1 - 0.7, 0, lz);
    couch.rotation.y = Math.PI;
    b.add(couch);
    b.collideObject(couch);
    const table = box(0.8, 0.4, 1.4, '#a0693b', LOBBY.x1 - 2.1, 0, lz);
    b.add(table);
    b.collideObject(table);
    const coffee = coffeeMachine();
    // clear of the wall: buried in it, the counter's top would fight the dado's
    coffee.position.set(LOBBY.x1 - 0.5, 0, LOBBY.z1 - 0.75);
    coffee.rotation.y = Math.PI;
    b.add(coffee);
    b.collideObject(coffee);
    const cooler = waterCooler();
    cooler.position.set(LOBBY.x1 - 0.4, 0, 1.6);
    b.add(cooler);
    b.collideObject(cooler);
    const lobbyRug = rug('#ffa94d', 5, 3.5);
    lobbyRug.position.set(0, 0.012, lz);
    b.add(lobbyRug);
    for (const [x, z] of [[LOBBY.x0 + 0.6, 0.7], [LOBBY.x1 - 0.6, 3.2], [LOBBY.x0 + 0.6, LOBBY.z1 - 0.7], [-HALL_HALF - 0.9, 0.7], [HALL_HALF + 0.9, 0.7]]) {
      const p = plant(1.2);
      p.position.set(x, 0, z);
      b.add(p);
      b.collideObject(p.children[0]);
    }
    for (const [x, z] of [[-3.5, lz - 2.5], [3.5, lz - 2.5], [-3.5, lz + 2.5], [3.5, lz + 2.5]]) {
      const light = ceilingLight(1.4, 1.4);
      light.position.set(x, WALL_H - 0.03, z);
      b.add(light);
    }
    for (const z of [lz - 2.3, lz + 2.3]) {
      const w = viewport(2.0, 1.4);
      w.position.set(LOBBY.x1 - WALL_T / 2 - 0.005, 1.9, z);
      w.rotation.y = -Math.PI / 2;
      b.add(w);
    }
  }

  /** The ready room, through the lobby's north door, and the observation lounge beyond it. */
  private buildReadyRoom(b: Builder): void {
    // the office's south wall spans the lobby, which is wider than the office
    b.wall(LOBBY.x0, LOBBY.z1, LOBBY.x1, LOBBY.z1, OFFICE_WALL, [{ at: 0, width: DOOR_W }]);
    b.ceiling(-OUTER_X, OUTER_X, LOBBY.z1, LOUNGE.z1);
    b.floor(OFFICE.x0, OFFICE.x1, OFFICE.z0, OFFICE.z1, toon('#ffffff', { map: tiled.carpet('#7b2d43', 4, 3) }));
    b.floor(LOUNGE.x0, LOUNGE.x1, LOUNGE.z0, LOUNGE.z1, toon('#ffffff', { map: tiled.carpet('#3b3f5c', 4, 2) }));
    b.wall(OFFICE.x0, OFFICE.z1, OFFICE.x1, OFFICE.z1, OFFICE_WALL, [{ at: LOUNGE_DOOR_X, width: DOOR_W }]);
    b.wall(OFFICE.x0, OFFICE.z0, OFFICE.x0, OFFICE.z1, OFFICE_WALL);
    b.wall(OFFICE.x1, OFFICE.z0, OFFICE.x1, OFFICE.z1, OFFICE_WALL);
    b.wall(LOUNGE.x0, LOUNGE.z0, LOUNGE.x0, LOUNGE.z1, HULL.bulkhead);
    b.wall(LOUNGE.x1, LOUNGE.z0, LOUNGE.x1, LOUNGE.z1, HULL.bulkhead);
    b.wall(LOUNGE.x0, LOUNGE.z1, LOUNGE.x1, LOUNGE.z1, HULL.bulkhead);
    const officeSign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.62), flat(lcarsSign('Ready room', { color: LCARS.red, code: '04-01' })));
    officeSign.position.set(0, 2.88, OFFICE.z0 - OVER_DOOR);
    officeSign.rotation.y = Math.PI;
    b.add(officeSign);
    interactive(officeSign, { kind: 'manager' }, () => 'Open the ready room console');
    this.buildManagerOffice(b);
    this.lounge = new Lounge(b);
    this.northRooms = [
      {
        name: 'Ready room',
        area: { minX: OFFICE.x0, maxX: OFFICE.x1, minZ: OFFICE.z0, maxZ: OFFICE.z1 },
        way: '↑ north',
        place: { label: '🎖️ Ready room', position: new THREE.Vector3(0, 0, OFFICE.z0 + 1.5), lookAt: new THREE.Vector3(0, 1.2, OFFICE.z0 + 5) },
      },
      {
        name: 'Observation lounge',
        area: { minX: LOUNGE.x0, maxX: LOUNGE.x1, minZ: LOUNGE.z0, maxZ: LOUNGE.z1 },
        way: '↑ past the ready room',
        place: { label: '🖖 Observation lounge', position: new THREE.Vector3(-1.2, 0, LOUNGE.z0 + 0.9), lookAt: new THREE.Vector3(0.6, 1.1, LOUNGE.z0 + 4.6) },
      },
    ];
  }

  private buildManagerOffice(b: Builder): void {
    const cz = (OFFICE.z0 + OFFICE.z1) / 2;
    const officeRug = rug('#f8f0fc', 5.5, 4);
    officeRug.position.set(0.6, 0.012, cz + 0.4);
    b.add(officeRug);

    // the manager's desk faces the door; the computer faces the manager's chair
    const bigDesk = desk(3.2, 1.3, '#8b5e3c', '#5c3d2e');
    bigDesk.rotation.y = Math.PI / 2;
    bigDesk.position.set(0.6, 0, cz + 1.4);
    b.add(bigDesk);
    b.collideObject(bigDesk);
    const seat = chair('#212529');
    seat.position.set(0.6, 0, cz + 2.6);
    seat.rotation.y = -Math.PI / 2;
    seat.scale.setScalar(1.2);
    b.add(seat);
    // Number One sits across the desk's east end from the captain, clear of the way in, the console and the inbox
    // (lifted a hair so their shadow clears the rug)
    this.seatNumberOne(b, { at: new THREE.Vector3(1.8, 0.005, cz + 0.1), facing: seat.position });

    const computer = new THREE.Group();
    computer.position.set(0.6, DESK_TOP, cz + 1.3);
    const stand = cyl(0.04, 0.12, 0.35, '#343a40');
    stand.position.y = 0.17;
    computer.add(stand);
    computer.add(box(1.5, 0.9, 0.06, '#343a40', 0, 0.3, 0));
    const monitor = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), flat(this.dashboardTex));
    monitor.position.set(0, 0.75, 0.035);
    computer.add(monitor);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), flat(consoleBackTexture()));
    back.position.set(0, 0.75, -0.035);
    back.rotation.y = Math.PI;
    computer.add(back);
    b.add(computer);
    interactive(computer, { kind: 'manager' }, () => 'Use the ready room console');

    const inbox = new THREE.Group();
    inbox.position.set(-0.5, DESK_TOP, cz + 1.3);
    inbox.add(box(0.45, 0.12, 0.35, '#e9ecef', 0, 0, 0));
    inbox.add(box(0.38, 0.05, 0.28, LCARS.peach, 0, 0.06, 0));
    const inboxSign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.2), flat(lcarsSign('New issue', { color: LCARS.orange, h: 292 })));
    inboxSign.position.set(0, 0.35, -0.05);
    inboxSign.rotation.y = Math.PI;
    inbox.add(inboxSign);
    b.add(inbox);
    interactive(inbox, { kind: 'manager', tab: 'issue' }, () => 'File a new issue');
    const cup = trophy();
    cup.position.set(1.75, DESK_TOP, cz + 1.4);
    b.add(cup);

    // mission control on the west wall
    const wallScreen = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.25), flat(this.dashboardTex));
    wallScreen.position.set(OFFICE.x0 + 0.16, 1.75, cz - 0.6);
    wallScreen.rotation.y = Math.PI / 2;
    b.add(wallScreen);
    b.add(box(0.08, 2.45, 4.2, '#212529', OFFICE.x0 + 0.1, 0.52, cz - 0.6));
    interactive(wallScreen, { kind: 'manager' }, () => 'Open mission control');

    // blueprint table for new projects
    const blueprint = new THREE.Group();
    blueprint.position.set(OFFICE.x1 - 1.6, 0, OFFICE.z0 + 1.6);
    blueprint.add(box(1.6, 0.9, 1.1, '#5c7cfa', 0, 0, 0));
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), flat(blueprintTexture()));
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = 0.91;
    blueprint.add(sheet);
    const bpSign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.32), flat(lcarsSign('New project', { color: LCARS.periwinkle, h: 252 })));
    bpSign.position.set(0, 1.5, -0.3);
    bpSign.rotation.y = Math.PI;
    blueprint.add(bpSign);
    b.add(blueprint);
    b.collideObject(blueprint.children[0]);
    interactive(blueprint, { kind: 'manager', tab: 'new-project' }, () => 'Plan a new project');

    const shelf = bookshelf(2.0);
    shelf.position.set(OFFICE.x1 - 0.35, 0, cz + 1.6);
    b.add(shelf);
    b.collideObject(shelf);
    for (const [x, z] of [[OFFICE.x0 + 0.7, OFFICE.z1 - 0.7], [OFFICE.x1 - 0.7, OFFICE.z1 - 0.7], [OFFICE.x0 + 0.7, OFFICE.z0 + 0.7], [OFFICE.x1 - 0.7, OFFICE.z0 + 0.7]]) {
      const p = plant(1.3, '#3d405b');
      p.position.set(x, 0, z);
      b.add(p);
      b.collideObject(p.children[0]);
    }
    // the north wall backs onto the lounge now; the east wall still looks out
    const view = viewport(2.0, 1.4);
    view.position.set(OFFICE.x1 - WALL_T / 2 - 0.005, 1.9, cz - 1.6);
    view.rotation.y = -Math.PI / 2;
    b.add(view);
    for (const [x, z] of [[-3, cz - 2], [3, cz - 2], [-3, cz + 2], [3, cz + 2]]) {
      const light = ceilingLight(1.4, 1.4);
      light.position.set(x, WALL_H - 0.03, z);
      b.add(light);
    }
  }

  private seatEngineer(b: Builder, seat: Seat): void {
    this.engineering = new EngineeringStation(seat);
    b.add(this.engineering.group);
    b.colliders.push(this.engineering.footprint);
  }

  private seatNumberOne(b: Builder, seat: Seat): void {
    this.numberOne = new FirstOfficer(seat);
    b.add(this.numberOne.group);
    b.colliders.push(this.numberOne.footprint);
  }

  /** Where you come aboard: the bridge, which sorts first of the command deck's places, or the concourse. */
  boarding(): Place {
    switch (this.ship.kind) {
      case 'current':
        return { label: '🛋️ Concourse', position: new THREE.Vector3(0, 0, 8), lookAt: new THREE.Vector3(0, 1.6, 0) };
      case 'next':
        return this.ship.command.places[0];
    }
  }

  /** Where the turbolift stops: in each deck's car. */
  stops(): Place[] {
    return this.decks().flatMap((d) => d.stops);
  }

  /** Teleport destinations. */
  places(): Place[] {
    const places: Place[] = this.decks().flatMap((d) => d.places);
    if (this.ship.kind === 'current') places.push(CONCOURSE, ...this.northRooms.map((r) => r.place));
    for (const room of this.rooms.values()) {
      places.push({
        label: `🚪 ${room.project.name}`,
        projectId: room.project.id,
        position: roomToWorld(room.slot, new THREE.Vector3(-HALF_D + 1.4, 0, 0)),
        lookAt: roomToWorld(room.slot, new THREE.Vector3(HALF_D, 1.5, 0)),
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
      const station = room.briefingRoomOf(p);
      if (station !== undefined) return { label: `${room.project.name} · briefing room ${station + 1}`, projectId: room.project.id };
    }
    for (const deck of this.decks()) {
      const label = deck.areaAt(p);
      if (label) return { label };
    }
    if (this.ship.kind === 'current') {
      const north = this.northRooms.find((r) => contains(r.area, p));
      if (north) return { label: north.name };
      if (p.z > 0) return { label: 'Concourse' };
    }
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
    for (const door of this.doors) door.update(camera, dt);
    for (const portal of this.portals) portal.update(camera, dt);
    for (const room of this.rooms.values()) room.update(t, now, camera);
    this.engineering?.update(t, camera);
    this.numberOne?.update(t, camera);
    if (this.panelsDirty && now - this.lastPanels > 1000) {
      this.panelsDirty = false;
      this.lastPanels = now;
      this.drawDashboard();
      // the directory hangs in the concourse
      if (this.ship.kind === 'current') this.drawDirectory();
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

  private drawDirectory(): void {
    const { canvas, ctx } = this.directory;
    const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: 'Directory', color: LCARS.lilac, seed: 1701 });
    ctx.textBaseline = 'middle';
    let y = area.y + 50;
    const entries: [string, string][] = [...this.northRooms.map((r): [string, string] => [r.name, r.way]), ...[...this.rooms.values()].map((r): [string, string] => [r.project.name, `holodeck ${r.slot.index + 1} · ${r.slot.side > 0 ? 'right' : 'left'}`])];
    for (const [name, where] of entries.slice(0, 10)) {
      ctx.textAlign = 'left';
      ctx.fillStyle = LCARS.peach;
      ctx.font = `600 52px ${LCARS_FONT}`;
      ctx.fillText(fitText(ctx, name.toUpperCase(), area.w * 0.6), area.x, y);
      ctx.fillStyle = LCARS.sky;
      ctx.font = `500 34px ${LCARS_FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(where.toUpperCase(), area.x + area.w, y + 4);
      y += 78;
    }
    ctx.fillStyle = LCARS.gold;
    ctx.font = `500 30px ${LCARS_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('PRESS E (OR T ANYWHERE) TO JUMP TO A HOLODECK', area.x + area.w / 2, area.y + area.h - 10);
    this.directoryTex.needsUpdate = true;
  }

  room(projectId: string): ProjectRoom | undefined {
    return this.rooms.get(projectId);
  }

  get interactRoot(): THREE.Object3D {
    return this.root;
  }
}

/** The back of the ready room console's monitor, facing whoever walks up behind it. */
function consoleBackTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(1024, 585);
  const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: 'Ready room', color: LCARS.gold, seed: 1031 });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = LCARS.peach;
  ctx.font = `600 76px ${LCARS_FONT}`;
  ctx.fillText('CAPTAIN’S CONSOLE', area.x, area.y + area.h * 0.4);
  ctx.fillStyle = LCARS.sky;
  ctx.font = `500 38px ${LCARS_FONT}`;
  ctx.fillText('WALK AROUND AND PRESS E', area.x, area.y + area.h * 0.4 + 80);
  return canvasTexture(canvas);
}

function blueprintTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(600, 400);
  ctx.fillStyle = '#1c7ed6';
  ctx.fillRect(0, 0, 600, 400);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  for (let x = 0; x < 600; x += 25) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 400);
    ctx.stroke();
  }
  for (let y = 0; y < 400; y += 25) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(600, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.strokeRect(80, 80, 440, 240);
  ctx.strokeRect(80, 80, 200, 120);
  ctx.beginPath();
  ctx.moveTo(280, 320);
  ctx.lineTo(280, 250);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 44px ${LCARS_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('NEW PROJECT', 400, 270);
  return canvasTexture(canvas);
}
