import * as THREE from 'three';
import type { Board, Project } from '../../../shared/types';
import { DESKS_PER_ROOM } from '../../../shared/types';
import { state } from '../net/state';
import { KanbanBoard } from './board';
import { type Builder, interactive } from './builder';
import { signTexture } from './canvas';
import { Character } from './character';
import { type RoomSlot, ROOM_DEPTH, ROOM_WIDTH, WALL_H } from './layout';
import { box, flat, lighten, toon } from './materials';
import { ceilingLight, chair, cyl, DESK_TOP, desk, laptop, paperStack, plant } from './props';
import { holodeckMaterial, holodeckSkin, type Scenery } from './scenery';
import { LaptopScreen } from './screen';

interface DeskSlot {
  index: number;
  group: THREE.Group;
  laptopGroup: THREE.Group;
  screen: LaptopScreen;
  seat: THREE.Group;
  character?: Character;
  agentId?: string;
}

const HALF_D = ROOM_DEPTH / 2;
const HALF_W = ROOM_WIDTH / 2;
/** Things hung on the far wall sit this far in from its centre line, in front of a themed room's wall skin. */
const ON_WALL = HALF_D - 0.16;

/** Local (room-frame) position of a desk: two rows of three, everyone facing the Kanban board. */
export function deskPosition(index: number): THREE.Vector3 {
  const row = Math.floor(index / 3);
  const col = index % 3;
  return new THREE.Vector3(row === 0 ? -2.4 : 1.6, 0, (col - 1) * 3.7);
}

/** Where to stand to look over an agent's shoulder at their laptop (room frame). */
export function deskViewpoint(index: number): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
  const d = deskPosition(index);
  return {
    position: new THREE.Vector3(d.x - 1.75, 0, d.z + 0.95),
    lookAt: new THREE.Vector3(d.x + 0.15, 1.0, d.z + 0.15),
  };
}

/** A project's room: desks with agents and laptops, the Kanban board and a pile of PRs to review. */
export class ProjectRoom {
  readonly group = new THREE.Group();
  readonly desks: DeskSlot[] = [];
  private board = new KanbanBoard();
  private prPile = new THREE.Group();
  private prCount = -1;
  private boardDirty = true;

  /**
   * `scenery` is the landscape the room sits in (null for plain office walls). The World owns it, so it can
   * outlive this room when the building is rebuilt for an unrelated change.
   */
  constructor(
    public project: Project,
    readonly slot: RoomSlot,
    builder: Builder,
    private readonly scenery: Scenery | null,
  ) {
    this.group.position.copy(slot.center);
    this.group.rotation.y = slot.rotationY;
    builder.add(this.group);

    const carpet = lighten(project.color, 0.6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH - 0.2, ROOM_WIDTH - 0.2), toon(carpet));
    floor.material.userData.outlineParameters = { visible: false };
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.005;
    this.group.add(floor);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH - 2, 1.2), toon(lighten(project.color, 0.35)));
    stripe.material.userData.outlineParameters = { visible: false };
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0.5, 0.01, 0);
    this.group.add(stripe);

    if (scenery) this.group.add(scenery.group); // a themed room's walls and ceiling show it

    // sign above the door, facing the hallway
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.62),
      flat(signTexture(project.name, { bg: project.color, fg: '#ffffff', border: '#1b1b1b', sub: project.repos.map((r) => r.split('/')[1]).join(' · ') || 'No repositories yet' })),
    );
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(-HALF_D - 0.14, 2.85, 0);
    this.group.add(sign);
    interactive(sign, { kind: 'board', projectId: project.id }, () => `Open ${project.name}'s board`);

    // Kanban whiteboard on the far wall: as tall as fits between its bottom rail and the ceiling, as wide as its drawing
    const boardBottom = 0.24;
    const boardTop = WALL_H - 0.2; // the top rail sits under the ceiling
    const boardW = (boardTop - boardBottom) * this.board.aspect;
    const post = boardW / 2 + 0.05;
    const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(boardW, boardTop - boardBottom), this.board.material);
    boardMesh.rotation.y = -Math.PI / 2;
    boardMesh.position.set(ON_WALL, (boardBottom + boardTop) / 2, 0);
    this.group.add(boardMesh);
    const frameColor = '#adb5bd';
    this.group.add(box(0.08, 0.1, boardW + 0.2, frameColor, ON_WALL - 0.01, boardBottom - 0.1, 0));
    this.group.add(box(0.08, 0.1, boardW + 0.2, frameColor, ON_WALL - 0.01, boardTop, 0));
    for (const s of [-1, 1]) this.group.add(box(0.08, boardTop - boardBottom + 0.2, 0.1, frameColor, ON_WALL - 0.01, boardBottom - 0.1, s * post));
    // with no real wall behind it, the board stands on its own feet
    if (this.scenery) for (const s of [-1, 1]) this.group.add(box(0.7, 0.14, 0.12, frameColor, ON_WALL - 0.3, 0, s * post));
    this.group.add(box(0.22, 0.05, 2.0, '#868e96', ON_WALL - 0.09, 0.16, 1.5)); // marker tray
    ['#e03131', '#1971c2', '#2f9e44'].forEach((c, i) => {
      const m = cyl(0.02, 0.02, 0.16, c, 8);
      m.rotation.x = Math.PI / 2;
      m.position.set(ON_WALL - 0.09, 0.23, 1.2 + i * 0.12);
      this.group.add(m);
    });
    interactive(boardMesh, { kind: 'board', projectId: project.id }, () => `Use the ${project.name} board`);

    // desks
    for (let i = 0; i < DESKS_PER_ROOM; i++) this.desks.push(this.buildDesk(i, builder));

    // PR review table
    const table = new THREE.Group();
    table.position.set(HALF_D - 2.0, 0, -HALF_W + 1.6);
    const top = cyl(0.65, 0.65, 0.06, '#ffffff', 24);
    top.position.y = 0.74;
    const leg = cyl(0.07, 0.12, 0.74, '#868e96');
    leg.position.y = 0.37;
    table.add(top, leg);
    this.prPile.position.y = 0.77;
    table.add(this.prPile);
    const tableSign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), flat(signTexture('👀 Pull requests', { bg: '#d3f9d8', fg: '#2b8a3e', border: '#2b8a3e' })));
    tableSign.position.set(0, 1.45, 0);
    tableSign.rotation.y = -Math.PI / 2;
    table.add(tableSign);
    this.group.add(table);
    interactive(table, { kind: 'board', projectId: project.id, tab: 'prs' }, () => 'Review pull requests');
    builder.collideObject(top);

    // "new issue" stand with a sticky-note pad
    const kiosk = new THREE.Group();
    kiosk.position.set(HALF_D - 2.0, 0, HALF_W - 1.6);
    kiosk.add(box(0.5, 1.0, 0.5, project.color, 0, 0, 0));
    kiosk.add(box(0.6, 0.06, 0.6, '#ffffff', 0, 1.0, 0));
    const pad = box(0.3, 0.08, 0.3, '#ffe066', 0, 1.06, 0);
    pad.rotation.y = 0.2;
    kiosk.add(pad);
    const pen = cyl(0.015, 0.015, 0.25, '#1971c2', 8);
    pen.rotation.set(Math.PI / 2, 0, 0.4);
    pen.position.set(0.05, 1.16, 0.15);
    kiosk.add(pen);
    const kioskSign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.28), flat(signTexture('＋ New issue', { bg: '#fff3bf', fg: '#e67700', border: '#e67700' })));
    kioskSign.position.set(0, 1.55, 0);
    kioskSign.rotation.y = -Math.PI / 2;
    kiosk.add(kioskSign);
    this.group.add(kiosk);
    interactive(kiosk, { kind: 'new-issue', projectId: project.id }, () => `File a new issue for ${project.name}`);
    builder.collideObject(kiosk.children[0]);

    for (const [x, z] of [[HALF_D - 0.6, -HALF_W + 0.6], [HALF_D - 0.6, HALF_W - 0.6], [-HALF_D + 0.6, -HALF_W + 0.6], [-HALF_D + 0.6, HALF_W - 0.6]]) {
      const p = plant(1.1, ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f'][Math.abs(x + z) % 4 | 0]);
      p.position.set(x, 0, z);
      this.group.add(p);
      builder.collideObject(p.children[0]);
    }

    // only a plain office has a ceiling to hang lights from
    for (const x of this.scenery ? [] : [-3.5, 0.5, 4.5]) {
      for (const z of [-3, 3]) {
        const light = ceilingLight(1.4, 0.7);
        light.position.set(x, WALL_H - 0.03, z);
        this.group.add(light);
      }
    }

    this.syncAgents();
  }

  private buildDesk(index: number, builder: Builder): DeskSlot {
    const group = new THREE.Group();
    group.position.copy(deskPosition(index));
    this.group.add(group);
    const d = desk(1.9, 1.0);
    group.add(d);
    builder.collideObject(d);

    const screen = new LaptopScreen(null);
    const lap = laptop(screen.material);
    lap.group.position.set(0.0, DESK_TOP, 0.18);
    lap.group.rotation.y = -0.28;
    group.add(lap.group);

    const mug = cyl(0.05, 0.045, 0.11, ['#ffd166', '#ef476f', '#06d6a0', '#118ab2'][index % 4], 12);
    mug.position.set(-0.2, DESK_TOP + 0.055, -0.62);
    group.add(mug);
    if (index % 2 === 0) {
      const p = plant(0.35, '#f4f1de');
      p.position.set(0.3, DESK_TOP, -0.75);
      group.add(p);
    }

    const seat = new THREE.Group();
    seat.position.set(-0.85, 0, -0.32);
    seat.add(chair('#495057'));
    group.add(seat);
    builder.collide(...this.worldBox(group, -1.25, -0.45, -0.75, 0.15));

    const slot: DeskSlot = { index, group, laptopGroup: lap.group, screen, seat };
    interactive(lap.group, { kind: 'desk', projectId: this.project.id }, () => this.deskLabel(slot));
    interactive(d, { kind: 'desk', projectId: this.project.id }, () => this.deskLabel(slot));
    return slot;
  }

  /** World-space AABB (as collide() args) of a rectangle in a desk's local frame. */
  private worldBox(group: THREE.Group, x0: number, x1: number, z0: number, z1: number): [number, number, number, number] {
    group.updateWorldMatrix(true, false);
    const a = new THREE.Vector3(x0, 0, z0).applyMatrix4(group.matrixWorld);
    const b = new THREE.Vector3(x1, 0, z1).applyMatrix4(group.matrixWorld);
    return [a.x, b.x, a.z, b.z];
  }

  private deskLabel(slot: DeskSlot): string {
    const agent = slot.agentId ? state.agents.get(slot.agentId) : undefined;
    return agent ? `Look at ${agent.name}'s laptop (#${agent.issue.number})` : 'Empty desk – assign an issue from the board';
  }

  /** Seats, updates and removes characters to match the agents in this project. */
  syncAgents(): void {
    const agents = state.agentsIn(this.project.id);
    for (const slot of this.desks) {
      const agent = agents.find((a) => a.desk === slot.index);
      if (!agent) {
        if (slot.character) {
          slot.seat.remove(slot.character.group);
          slot.character.dispose();
          slot.character = undefined;
        }
        if (slot.agentId) {
          slot.agentId = undefined;
          slot.screen.setAgent(null);
          interactive(slot.laptopGroup, { kind: 'desk', projectId: this.project.id }, () => this.deskLabel(slot));
        }
        continue;
      }
      if (slot.agentId !== agent.id) {
        if (slot.character) {
          slot.seat.remove(slot.character.group);
          slot.character.dispose();
        }
        slot.character = new Character(agent);
        slot.seat.add(slot.character.group);
        slot.agentId = agent.id;
        interactive(slot.character.group, { kind: 'agent', id: agent.id }, () => `Talk to ${agent.name} (#${agent.issue.number})`);
        interactive(slot.laptopGroup, { kind: 'agent', id: agent.id }, () => `Look at ${agent.name}'s laptop (#${agent.issue.number})`);
      }
      slot.character!.setAgent(agent);
      slot.screen.setAgent(agent);
    }
    this.boardDirty = true;
  }

  markScreen(agentId: string): void {
    this.desks.find((d) => d.agentId === agentId)?.screen.markDirty();
  }

  markBoard(): void {
    this.boardDirty = true;
  }

  private rebuildPrPile(board: Board | undefined): void {
    const count = Math.min(board?.prs.length ?? 0, 12);
    if (count === this.prCount) return;
    this.prCount = count;
    this.prPile.clear();
    this.prPile.add(paperStack(count, ['#74c0fc', '#ffa8a8', '#b2f2bb', '#ffe066', '#d0bfff']));
  }

  update(t: number, now: number, camera: THREE.Vector3): void {
    this.scenery?.update(t, this.group.worldToLocal(tmp.copy(camera)));
    if (this.boardDirty) {
      this.boardDirty = false;
      const board = state.boards.get(this.project.id);
      this.board.draw(this.project, board, state.agentsIn(this.project.id));
      this.rebuildPrPile(board);
    }
    const inRoom = camera.distanceTo(this.slot.center) < 14;
    for (const slot of this.desks) {
      if (!slot.character) {
        slot.screen.maybeDraw(now, false, undefined, undefined);
        continue;
      }
      const dist = camera.distanceTo(slot.character.group.getWorldPosition(tmp));
      if (inRoom) slot.character.update(t, dist);
      const near = inRoom && dist < 6;
      slot.screen.maybeDraw(now, near, state.lines.get(slot.agentId!), state.browser.get(slot.agentId!));
    }
  }

  /** World position and look target for standing behind an agent. */
  viewpoint(agentId: string): { position: THREE.Vector3; lookAt: THREE.Vector3 } | null {
    const slot = this.desks.find((d) => d.agentId === agentId);
    if (!slot) return null;
    const v = deskViewpoint(slot.index);
    this.group.updateWorldMatrix(true, false);
    return { position: v.position.applyMatrix4(this.group.matrixWorld), lookAt: v.lookAt.applyMatrix4(this.group.matrixWorld) };
  }

  dispose(): void {
    this.board.dispose();
    for (const slot of this.desks) {
      slot.screen.dispose();
      slot.character?.dispose();
    }
  }
}

const tmp = new THREE.Vector3();

/** An empty room waiting for a project. */
export function buildVacantRoom(slot: RoomSlot, builder: Builder): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(slot.center);
  group.rotation.y = slot.rotationY;
  builder.add(group);
  // an empty holodeck: dark, with the yellow grid, waiting for a project to load a landscape
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH - 0.2, ROOM_WIDTH - 0.2), holodeckMaterial());
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.005;
  group.add(floor, holodeckSkin());
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.62), flat(signTexture('Vacant', { bg: '#f8f9fa', fg: '#868e96', border: '#868e96', sub: 'Create a project in the Manager’s office' })));
  sign.rotation.y = -Math.PI / 2;
  sign.position.set(-HALF_D - 0.14, 2.85, 0);
  group.add(sign);
  const poster = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 1.4),
    flat(signTexture('Room for rent', { w: 1024, h: 288, bg: '#fff9db', fg: '#e67700', border: '#e67700', sub: 'Start a project from the Manager’s office' })),
  );
  poster.rotation.y = -Math.PI / 2;
  poster.position.set(ON_WALL, 1.8, 0);
  group.add(poster);
  interactive(poster, { kind: 'manager', tab: 'new-project' }, () => 'Start a new project');
  // moving boxes
  const boxes = new THREE.Group();
  boxes.position.set(1, 0, -2);
  [[0, 0, 0], [0.7, 0, 0.1], [0.3, 0.5, 0.05], [0.1, 0, 0.8]].forEach(([x, y, z], i) => {
    const b = box(0.6, 0.5, 0.6, i % 2 ? '#d4a373' : '#ccd5ae', x, y, z);
    b.rotation.y = i * 0.3;
    boxes.add(b);
  });
  group.add(boxes);
  interactive(boxes, { kind: 'manager', tab: 'new-project' }, () => 'Start a new project');
  builder.collideObject(boxes);
  return group;
}
