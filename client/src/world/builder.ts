import * as THREE from 'three';
import { type Box2, DOOR_H, WALL_T } from './layout';
import type { PanePrefs } from './screenPanes';
import { SlidingDoors } from './starship';

export type Interaction =
  /** An agent's panel, on one of its views if given: a lead's goal, from the goal board. */
  | { kind: 'agent'; id: string; view?: 'browser' | 'goal' | 'tasks' | 'crew' }
  /** One of a lead's helpers at their team station: its own transcript. */
  | { kind: 'helper'; leadId: string; id: string }
  /** One of a lead's workflow agents on a transporter room's pads: its own transcript. Its room says whose. */
  | { kind: 'workflow-agent'; projectId: string; station: number; workflowId: string; index: number }
  | { kind: 'desk'; projectId: string }
  | { kind: 'board'; projectId: string; tab?: 'todo' | 'doing' | 'prs' }
  | { kind: 'new-issue'; projectId: string }
  | { kind: 'manager'; tab?: 'projects' | 'new-project' | 'issue' | 'settings' }
  | { kind: 'turbolift' }
  | { kind: 'number-one' }
  /** The engineering station: the report card and the chief engineer's retro. */
  | { kind: 'engineering' }
  /** Main engineering's master systems table: review the ledger. */
  | { kind: 'ledger' }
  | { kind: 'qa'; projectId: string }
  /** A free team station: start a goal there. */
  | { kind: 'station'; projectId: string; station: number }
  /** A team station's big screen, in use by lead `id`: look at what they've shown and asked. */
  | { kind: 'screen'; id: string }
  /** The star chart beside it: lead `id`'s goal's chart. */
  | { kind: 'chart'; id: string }
  /** A switch on the panel beside a team station's screen: show or hide that pane, on every station screen. */
  | { kind: 'pane'; pane: keyof PanePrefs }
  /**
   * A transporter room's console: beam back to the briefing room of the station it's one of (`projectId`'s holodeck's
   * team station `station`, its transporter room `room`), which the room fills in as it's dressed.
   */
  | { kind: 'energise'; projectId?: string; station?: number; room?: number }
  /** A feed on a briefing room's wall: beam into the transporter room it shows (`projectId`'s team station `station`'s room `room`). */
  | { kind: 'beam-to'; projectId: string; station: number; room: number }
  | { kind: 'vacant' };

/** How far away (m) the player can use something with E, unless it says otherwise. */
export const REACH = 4.5;

/** Marks an object (and everything under it) as something the player can use with E, from up to `reach` away. */
export function interactive(obj: THREE.Object3D, interaction: Interaction, label: () => string, reach = REACH): void {
  obj.userData.interaction = interaction;
  obj.userData.label = label;
  obj.userData.reach = reach;
}

/** Accumulates static geometry plus the 2D boxes the player collides with. */
export class Builder {
  /** The holodeck deck's region (regions.ts). */
  readonly group = new THREE.Group();
  /** The training halls' region, drawn apart from the deck they're reached from. */
  readonly halls = new THREE.Group();
  readonly colliders: Box2[] = [];
  readonly doors: SlidingDoors[] = [];

  add<T extends THREE.Object3D>(obj: T): T {
    this.group.add(obj);
    return obj;
  }

  collide(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.colliders.push({ minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX), minZ: Math.min(minZ, maxZ), maxZ: Math.max(minZ, maxZ) });
  }

  /** Collision box for an object, computed from its world-space bounds. */
  collideObject(obj: THREE.Object3D, pad = 0.05): void {
    obj.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(obj);
    this.collide(b.min.x - pad, b.max.x + pad, b.min.z - pad, b.max.z + pad);
  }

  /**
   * Sliding doors `width` wide in a doorway through a wall WALL_T thick, centred on `at` on the floor and turned `yaw`
   * (0 for a wall along X). Locked ones stay shut and block the way.
   */
  slidingDoors(at: THREE.Vector3, yaw: number, width: number, locked: boolean): void {
    const door = new SlidingDoors(at, yaw, width, DOOR_H, locked);
    this.doors.push(door);
    this.add(door.group);
    if (!locked) return;
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const dx = (c * width + s * WALL_T) / 2;
    const dz = (s * width + c * WALL_T) / 2;
    this.collide(at.x - dx, at.x + dx, at.z - dz, at.z + dz);
  }
}
