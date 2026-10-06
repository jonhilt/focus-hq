import * as THREE from 'three';
import { type Box2, DOOR_H, FRAME_FACE, WALL_H, WALL_T } from './layout';
import { box } from './materials';
import { HULL, SlidingDoors } from './starship';

export type Interaction =
  | { kind: 'agent'; id: string }
  | { kind: 'desk'; projectId: string }
  | { kind: 'board'; projectId: string; tab?: 'todo' | 'doing' | 'prs' }
  | { kind: 'new-issue'; projectId: string }
  | { kind: 'manager'; tab?: 'projects' | 'new-project' | 'issue' | 'settings' }
  | { kind: 'teleport' }
  | { kind: 'number-one' }
  | { kind: 'qa'; projectId: string }
  | { kind: 'lead'; projectId: string }
  | { kind: 'vacant' };

/** Marks an object (and everything under it) as something the player can use with E. */
export function interactive(obj: THREE.Object3D, interaction: Interaction, label: () => string): void {
  obj.userData.interaction = interaction;
  obj.userData.label = label;
}

export interface Door {
  at: number;
  width: number;
}

/** Accumulates static geometry plus the 2D boxes the player collides with. */
export class Builder {
  readonly group = new THREE.Group();
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
   * An axis-aligned wall from (x0,z0) to (x1,z1) – one of the coordinates must match – with door gaps
   * centred at `doors[].at` along its length, each closed by sliding doors. Starship bulkhead: a dark dado with an
   * LCARS stripe along its top, `color` above.
   */
  wall(x0: number, z0: number, x1: number, z1: number, color: string, doors: Door[] = []): void {
    const alongX = z0 === z1;
    const start = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
    const end = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    const fixed = alongX ? z0 : x0;
    const gaps = doors.map((d) => [d.at - d.width / 2, d.at + d.width / 2] as const).sort((a, b) => a[0] - b[0]);

    // the dado and its stripe run a little past the wall's ends (into the corner or door frame), so their end faces
    // don't share a plane with the wall's
    const overrun = 0.005;
    const piece = (from: number, to: number, y0: number, y1: number, mat: string, thick: number) => {
      const len = to - from;
      if (len <= 0.001) return;
      const mid = (from + to) / 2;
      const mesh = alongX ? box(len, y1 - y0, thick, mat, mid, y0, fixed) : box(thick, y1 - y0, len, mat, fixed, y0, mid);
      this.add(mesh);
    };

    let cursor = start;
    for (const [g0, g1] of [...gaps, [end, end] as const]) {
      if (g0 > cursor) {
        piece(cursor, g0, 0, WALL_H, color, WALL_T);
        piece(cursor - overrun, g0 + overrun, 0, 0.9, HULL.dado, WALL_T + 0.05);
        piece(cursor - overrun, g0 + overrun, 0.9, 0.97, HULL.stripe, WALL_T + 0.05);
        if (alongX) this.collide(cursor, g0, fixed - WALL_T / 2, fixed + WALL_T / 2);
        else this.collide(fixed - WALL_T / 2, fixed + WALL_T / 2, cursor, g0);
      }
      if (g1 > g0) {
        piece(g0, g1, DOOR_H, WALL_H, color, WALL_T);
        // door frame, standing a little proud of the wall's cut faces so they don't fight
        const lip = 0.02;
        piece(g0 - 0.14, g0 + lip, 0, DOOR_H + 0.14, HULL.frame, FRAME_FACE * 2);
        piece(g1 - lip, g1 + 0.14, 0, DOOR_H + 0.14, HULL.frame, FRAME_FACE * 2);
        piece(g0, g1, DOOR_H - lip, DOOR_H + 0.14, HULL.frame, FRAME_FACE * 2);
        const mid = (g0 + g1) / 2;
        const door = new SlidingDoors(alongX ? new THREE.Vector3(mid, 0, fixed) : new THREE.Vector3(fixed, 0, mid), alongX ? 'x' : 'z', g1 - g0, DOOR_H);
        this.doors.push(door);
        this.add(door.group);
      }
      cursor = Math.max(cursor, g1);
    }
  }

  floor(x0: number, x1: number, z0: number, z1: number, material: THREE.Material): THREE.Mesh {
    const w = Math.abs(x1 - x0);
    const d = Math.abs(z1 - z0);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    material.userData.outlineParameters = { visible: false };
    return this.add(mesh);
  }

  ceiling(x0: number, x1: number, z0: number, z1: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: HULL.ceiling });
    mat.userData.outlineParameters = { visible: false };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0)), mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, WALL_H, (z0 + z1) / 2);
    this.add(mesh);
  }
}
