import * as THREE from 'three';
import type { Project } from '../../../shared/types';
import { ACTIVE_STATUSES } from '../../../shared/types';
import { state } from '../net/state';
import { columns } from './board';
import { Builder, interactive } from './builder';
import { canvasTexture, fitText, makeCanvas, roundRect, signTexture, UI_FONT } from './canvas';
import { type Box2, DOOR_W, HALL_HALF, LOBBY, OFFICE, ROOM_DEPTH, ROOM_WIDTH, roomSlot, roomToWorld, rowsFor, SUN_POSITION, WALL_H } from './layout';
import { box, flat, toon } from './materials';
import { bookshelf, ceilingLight, chair, coffeeMachine, cyl, desk, DESK_TOP, plant, rug, sofa, trophy, waterCooler, windowPane } from './props';
import { buildVacantRoom, ProjectRoom } from './room';
import type { Scenery } from './scenery';
import { tiled } from './textures';
import { HULL, LCARS, LCARS_FONT, lcarsConsole, lcarsFrame, lcarsSign, type SlidingDoors } from './starship';
import { createScenery, roomTheme } from './themes';

export interface Place {
  label: string;
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  projectId?: string;
}

const OUTER_X = HALL_HALF + ROOM_DEPTH;

/** Builds and owns the whole office: lobby, manager's office, hallway and one room per project. */
export class World {
  readonly root = new THREE.Group();
  colliders: Box2[] = [];
  rooms = new Map<string, ProjectRoom>();
  /** Room landscapes by project, theme and slot; kept across rebuilds since they're slow to make. */
  private sceneries = new Map<string, Scenery>();
  private builder: Builder | null = null;
  private doors: SlidingDoors[] = [];
  private lastT = 0;
  private dashboard = makeCanvas(1280, 720);
  private dashboardTex = canvasTexture(this.dashboard.canvas);
  private directory = makeCanvas(768, 1024);
  private directoryTex = canvasTexture(this.directory.canvas);
  private panelsDirty = true;
  private lastPanels = 0;
  private projectKey = '';

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** Rebuilds the building when the set of projects (or their names/colours/repos) changes. */
  sync(projects: Project[]): void {
    const key = JSON.stringify(projects.map((p) => [p.id, p.name, p.color, p.repos, p.theme]));
    if (key === this.projectKey) {
      for (const room of this.rooms.values()) {
        room.project = projects.find((p) => p.id === room.project.id) ?? room.project;
        room.markBoard();
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
    const b = new Builder();
    this.builder = b;

    const rows = rowsFor(projects.length);
    const hallEnd = -rows * ROOM_WIDTH;

    // floors and ceiling
    b.floor(LOBBY.x0, LOBBY.x1, LOBBY.z0, LOBBY.z1, toon('#ffffff', { map: tiled.carpet('#4a3f6e', 6, 4) }));
    b.floor(OFFICE.x0, OFFICE.x1, OFFICE.z0, OFFICE.z1, toon('#ffffff', { map: tiled.carpet('#7b2d43', 6, 4) }));
    b.floor(-HALL_HALF, HALL_HALF, hallEnd, 0, toon('#ffffff', { map: tiled.carpet(HULL.carpet, 3, -hallEnd / 2) }));
    for (const s of [-1, 1]) b.floor(s * (HALL_HALF - 0.45), s * (HALL_HALF - 0.3), hallEnd, 0, toon(HULL.carpetEdge), 0.004);
    b.ceiling(-OUTER_X, OUTER_X, hallEnd, OFFICE.z1);

    // walls
    const lobbyWall = '#e2d6dc';
    const officeWall = '#cfd3e6';
    const roomWall = HULL.bulkhead;
    b.wall(OFFICE.x0, OFFICE.z1, OFFICE.x1, OFFICE.z1, officeWall);
    b.wall(OFFICE.x0, OFFICE.z0, OFFICE.x0, OFFICE.z1, officeWall);
    b.wall(OFFICE.x1, OFFICE.z0, OFFICE.x1, OFFICE.z1, officeWall);
    b.wall(OFFICE.x0, OFFICE.z0, OFFICE.x1, OFFICE.z0, officeWall, [{ at: 0, width: DOOR_W }]);
    b.wall(LOBBY.x0, LOBBY.z0, LOBBY.x0, LOBBY.z1, lobbyWall);
    b.wall(LOBBY.x1, LOBBY.z0, LOBBY.x1, LOBBY.z1, lobbyWall);
    for (let r = 0; r < rows; r++) {
      const z0 = -r * ROOM_WIDTH;
      const z1 = -(r + 1) * ROOM_WIDTH;
      const door = [{ at: (z0 + z1) / 2, width: DOOR_W }];
      b.wall(HALL_HALF, z1, HALL_HALF, z0, roomWall, door);
      b.wall(-HALL_HALF, z1, -HALL_HALF, z0, roomWall, door);
      b.wall(OUTER_X, z1, OUTER_X, z0, roomWall);
      b.wall(-OUTER_X, z1, -OUTER_X, z0, roomWall);
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
    const endWindow = windowPane(2.4, 1.6);
    endWindow.position.set(0, 1.9, hallEnd + 0.13);
    b.add(endWindow);

    // rooms
    const previous = this.sceneries;
    this.sceneries = new Map();
    projects.forEach((project, i) => {
      const slot = roomSlot(i);
      const theme = roomTheme(project);
      const key = `${project.id}|${theme}|${i}`;
      let scenery = previous.get(key) ?? null;
      previous.delete(key);
      // the stencil value (slot + 1) and the sun direction both depend on the slot, hence the key
      scenery ??= createScenery(theme, i + 1, project.id, SUN_POSITION.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -slot.rotationY));
      if (scenery) this.sceneries.set(key, scenery);
      this.rooms.set(project.id, new ProjectRoom(project, slot, b, scenery));
    });
    for (const scenery of previous.values()) scenery.dispose();
    for (let i = projects.length; i < rows * 2; i++) buildVacantRoom(roomSlot(i), b);

    this.buildLobby(b);
    this.buildManagerOffice(b);

    this.root.add(b.group);
    this.colliders = b.colliders;
    this.doors = b.doors;
    this.panelsDirty = true;
  }

  private buildLobby(b: Builder): void {
    // hanging sign over the hallway entrance
    const hallSign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.7), flat(lcarsSign('Holodecks', { color: LCARS.periwinkle, sub: 'project rooms down the hall', code: 'Deck 4' })));
    hallSign.position.set(0, 2.75, 0.15);
    b.add(hallSign);
    const officeSign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.62), flat(lcarsSign("Manager's office", { color: LCARS.red, code: '04-01' })));
    officeSign.position.set(0, 2.88, OFFICE.z0 - 0.14);
    officeSign.rotation.y = Math.PI;
    b.add(officeSign);
    interactive(officeSign, { kind: 'manager' }, () => 'Open the management console');

    // big welcome logo on the west wall + directory
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.1), flat(lcarsSign('U.S.S. Focus HQ', { w: 1024, h: 245, color: LCARS.gold, sub: 'an office full of Claude Code agents', code: 'NCC-4477' })));
    logo.position.set(LOBBY.x0 + 0.13, 2.25, 6);
    logo.rotation.y = Math.PI / 2;
    b.add(logo);
    const directory = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.0), flat(this.directoryTex));
    directory.position.set(LOBBY.x0 + 0.15, 1.25, 9.6);
    directory.rotation.y = Math.PI / 2;
    b.add(directory);
    b.add(box(0.1, 2.2, 1.7, '#495057', LOBBY.x0 + 0.08, 0.15, 9.6));
    interactive(directory, { kind: 'teleport' }, () => 'Office directory – jump to a room');

    // reception desk
    const reception = new THREE.Group();
    reception.position.set(-5.5, 0, 4);
    reception.add(box(1.0, 1.05, 3.0, '#ff922b', 0, 0, 0));
    reception.add(box(1.2, 0.08, 3.2, '#ffffff', 0, 1.05, 0));
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon('#ffd43b'));
    bell.position.set(0.3, 1.13, 0.8);
    reception.add(bell);
    b.add(reception);
    b.collideObject(reception);

    const couch = sofa('#4dabf7');
    couch.position.set(LOBBY.x1 - 0.7, 0, 6);
    couch.rotation.y = Math.PI;
    b.add(couch);
    b.collideObject(couch);
    const table = box(0.8, 0.4, 1.4, '#a0693b', LOBBY.x1 - 2.1, 0, 6);
    b.add(table);
    b.collideObject(table);
    const coffee = coffeeMachine();
    coffee.position.set(LOBBY.x1 - 0.5, 0, 10.6);
    coffee.rotation.y = Math.PI;
    b.add(coffee);
    b.collideObject(coffee);
    const cooler = waterCooler();
    cooler.position.set(LOBBY.x1 - 0.4, 0, 1.6);
    b.add(cooler);
    b.collideObject(cooler);
    const lobbyRug = rug('#ffa94d', 6, 4);
    lobbyRug.position.set(0, 0.012, 6);
    b.add(lobbyRug);
    for (const [x, z] of [[LOBBY.x0 + 0.6, 0.7], [LOBBY.x1 - 0.6, 3.2], [LOBBY.x0 + 0.6, 11.3], [-3.6, 0.7], [3.6, 0.7]]) {
      const p = plant(1.2);
      p.position.set(x, 0, z);
      b.add(p);
      b.collideObject(p.children[0]);
    }
    for (const [x, z] of [[-4, 3], [4, 3], [-4, 9], [4, 9]]) {
      const light = ceilingLight(1.4, 1.4);
      light.position.set(x, WALL_H - 0.03, z);
      b.add(light);
    }
    for (const z of [3, 9]) {
      const w = windowPane(2.2, 1.4);
      w.position.set(LOBBY.x1 - 0.13, 1.9, z === 3 ? 3.4 : 8.6);
      w.rotation.y = -Math.PI / 2;
      b.add(w);
    }
  }

  private buildManagerOffice(b: Builder): void {
    const cz = (OFFICE.z0 + OFFICE.z1) / 2;
    const officeRug = rug('#f8f0fc', 7, 5);
    officeRug.position.set(0, 0.012, cz + 2);
    b.add(officeRug);

    // the manager's desk faces the door; the computer faces the manager's chair
    const bigDesk = desk(3.2, 1.3, '#8b5e3c', '#5c3d2e');
    bigDesk.rotation.y = Math.PI / 2;
    bigDesk.position.set(0, 0, cz + 2.4);
    b.add(bigDesk);
    b.collideObject(bigDesk);
    const seat = chair('#212529');
    seat.position.set(0, 0, cz + 3.6);
    seat.rotation.y = -Math.PI / 2;
    seat.scale.setScalar(1.2);
    b.add(seat);

    const computer = new THREE.Group();
    computer.position.set(0, DESK_TOP, cz + 2.3);
    const stand = cyl(0.04, 0.12, 0.35, '#343a40');
    stand.position.y = 0.17;
    computer.add(stand);
    computer.add(box(1.5, 0.9, 0.06, '#343a40', 0, 0.3, 0));
    const monitor = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), flat(this.dashboardTex));
    monitor.position.set(0, 0.75, 0.035);
    computer.add(monitor);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), flat(signTexture('Management console', { w: 1024, h: 585, bg: '#343a40', fg: '#ffd43b', sub: 'walk around and press E' })));
    back.position.set(0, 0.75, -0.035);
    back.rotation.y = Math.PI;
    computer.add(back);
    b.add(computer);
    interactive(computer, { kind: 'manager' }, () => 'Use the management console');

    const inbox = new THREE.Group();
    inbox.position.set(-1.1, DESK_TOP, cz + 2.3);
    inbox.add(box(0.45, 0.12, 0.35, '#e9ecef', 0, 0, 0));
    inbox.add(box(0.38, 0.05, 0.28, '#ffe066', 0, 0.06, 0));
    const inboxSign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.2), flat(signTexture('＋ New issue', { bg: '#fff3bf', fg: '#e67700', border: '#e67700' })));
    inboxSign.position.set(0, 0.35, -0.05);
    inboxSign.rotation.y = Math.PI;
    inbox.add(inboxSign);
    b.add(inbox);
    interactive(inbox, { kind: 'manager', tab: 'issue' }, () => 'File a new issue');
    const cup = trophy();
    cup.position.set(1.15, DESK_TOP, cz + 2.4);
    b.add(cup);

    // mission control on the west wall
    const wallScreen = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.7), flat(this.dashboardTex));
    wallScreen.position.set(OFFICE.x0 + 0.16, 1.8, cz);
    wallScreen.rotation.y = Math.PI / 2;
    b.add(wallScreen);
    b.add(box(0.08, 2.9, 5.0, '#212529', OFFICE.x0 + 0.1, 0.35, cz));
    interactive(wallScreen, { kind: 'manager' }, () => 'Open mission control');

    // blueprint table for new projects
    const blueprint = new THREE.Group();
    blueprint.position.set(OFFICE.x1 - 2.2, 0, OFFICE.z0 + 2.4);
    blueprint.add(box(1.6, 0.9, 1.1, '#5c7cfa', 0, 0, 0));
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), flat(blueprintTexture()));
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = 0.91;
    blueprint.add(sheet);
    const bpSign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.32), flat(signTexture('＋ New project', { bg: '#dbe4ff', fg: '#364fc7', border: '#364fc7' })));
    bpSign.position.set(0, 1.5, -0.3);
    bpSign.rotation.y = Math.PI;
    blueprint.add(bpSign);
    b.add(blueprint);
    b.collideObject(blueprint.children[0]);
    interactive(blueprint, { kind: 'manager', tab: 'new-project' }, () => 'Plan a new project');

    const shelf = bookshelf(2.4);
    shelf.position.set(OFFICE.x1 - 0.3, 0, cz + 3);
    shelf.rotation.y = Math.PI;
    b.add(shelf);
    b.collideObject(shelf);
    for (const [x, z] of [[OFFICE.x0 + 0.7, OFFICE.z1 - 0.7], [OFFICE.x1 - 0.7, OFFICE.z1 - 0.7], [OFFICE.x0 + 0.7, OFFICE.z0 + 0.7], [OFFICE.x1 - 0.7, OFFICE.z0 + 0.7]]) {
      const p = plant(1.3, '#3d405b');
      p.position.set(x, 0, z);
      b.add(p);
      b.collideObject(p.children[0]);
    }
    for (const x of [-4, 4]) {
      const w = windowPane(2.8, 1.6);
      w.position.set(x, 1.9, OFFICE.z1 - 0.13);
      w.rotation.y = Math.PI;
      b.add(w);
    }
    for (const [x, z] of [[-4, cz - 2], [4, cz - 2], [-4, cz + 3], [4, cz + 3]]) {
      const light = ceilingLight(1.4, 1.4);
      light.position.set(x, WALL_H - 0.03, z);
      b.add(light);
    }
  }

  /** Teleport destinations. */
  places(): Place[] {
    const places: Place[] = [
      { label: '🛋️ Lobby', position: new THREE.Vector3(0, 0, 9), lookAt: new THREE.Vector3(0, 1.6, 0) },
      { label: "💼 Manager's office", position: new THREE.Vector3(0, 0, OFFICE.z0 + 1.5), lookAt: new THREE.Vector3(0, 1.2, OFFICE.z0 + 5) },
    ];
    for (const room of this.rooms.values()) {
      places.push({
        label: `🚪 ${room.project.name}`,
        projectId: room.project.id,
        position: roomToWorld(room.slot, new THREE.Vector3(-5.6, 0, 0)),
        lookAt: roomToWorld(room.slot, new THREE.Vector3(7, 1.5, 0)),
      });
    }
    return places;
  }

  /** Human name of where a world position is. */
  locationOf(p: THREE.Vector3): { label: string; projectId?: string } {
    if (p.z > OFFICE.z0) return { label: "Manager's office" };
    if (p.z > 0) return { label: 'Lobby' };
    if (Math.abs(p.x) < HALL_HALF) return { label: 'Hallway' };
    const row = Math.floor(-p.z / ROOM_WIDTH);
    const index = row * 2 + (p.x > 0 ? 0 : 1);
    const room = [...this.rooms.values()].find((r) => r.slot.index === index);
    return room ? { label: room.project.name, projectId: room.project.id } : { label: 'Vacant room' };
  }

  markPanels(): void {
    this.panelsDirty = true;
  }

  update(t: number, now: number, camera: THREE.Vector3): void {
    const dt = Math.min(0.1, t - this.lastT);
    this.lastT = t;
    for (const door of this.doors) door.update(camera, dt);
    for (const room of this.rooms.values()) room.update(t, now, camera);
    if (this.panelsDirty && now - this.lastPanels > 1000) {
      this.panelsDirty = false;
      this.lastPanels = now;
      this.drawDashboard();
      this.drawDirectory();
    }
  }

  private drawDashboard(): void {
    const { canvas, ctx } = this.dashboard;
    const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: 'Mission control', color: LCARS.orange, seed: 74656 });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const agents = [...state.agents.values()];
    const working = agents.filter((a) => ACTIVE_STATUSES.includes(a.status) && a.status !== 'waiting').length;
    const waiting = agents.filter((a) => a.status === 'waiting').length;
    const prs = [...state.boards.values()].reduce((n, b) => n + b.prs.length, 0);
    const todo = state.projects.reduce((n, p) => n + columns(p, state.boards.get(p.id), state.agentsIn(p.id)).todo.length, 0);
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
    if (state.projects.length === 0) {
      ctx.fillStyle = LCARS.peach;
      ctx.font = `500 34px ${LCARS_FONT}`;
      ctx.fillText('NO PROJECTS YET – PRESS E HERE TO CREATE YOUR FIRST ONE.', area.x, y);
    }
    for (const p of state.projects.slice(0, 5)) {
      const cols = columns(p, state.boards.get(p.id), state.agentsIn(p.id));
      ctx.fillStyle = p.color;
      roundRect(ctx, area.x, y - 22, 60, 44, 22);
      ctx.fill();
      ctx.fillStyle = LCARS.peach;
      ctx.font = `600 38px ${LCARS_FONT}`;
      ctx.fillText(fitText(ctx, p.name.toUpperCase(), 520), area.x + 80, y);
      ctx.fillStyle = LCARS.sky;
      ctx.font = `500 30px ${UI_FONT}`;
      ctx.fillText(`📋 ${cols.todo.length}   🔨 ${cols.doing.length}   👀 ${cols.prs.length}`, area.x + 640, y);
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
    const entries: [string, string][] = [["Manager's office", '↑ north'], ...[...this.rooms.values()].map((r): [string, string] => [r.project.name, `room ${r.slot.index + 1} · ${r.slot.side > 0 ? 'right' : 'left'}`])];
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
    ctx.fillText('PRESS E (OR T ANYWHERE) TO JUMP TO A ROOM', area.x + area.w / 2, area.y + area.h - 10);
    this.directoryTex.needsUpdate = true;
  }

  room(projectId: string): ProjectRoom | undefined {
    return this.rooms.get(projectId);
  }

  get interactRoot(): THREE.Object3D {
    return this.root;
  }
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
  ctx.font = `700 40px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('NEW PROJECT', 400, 270);
  return canvasTexture(canvas);
}
