import * as THREE from 'three';

// The office is T-shaped: the manager's office (north), the lobby, then a long hallway (south)
// with one project room per side every ROOM_WIDTH metres.
export const WALL_H = 3.2;
export const WALL_T = 0.2;
export const DOOR_W = 2.4;
export const DOOR_H = 2.5;
export const HALL_HALF = 3;
export const ROOM_DEPTH = 14; // from the hallway wall to the outer wall
export const ROOM_WIDTH = 12; // along the hallway
export const LOBBY = { x0: -9, x1: 9, z0: 0, z1: 12 };
export const OFFICE = { x0: -9, x1: 9, z0: 12, z1: 24 };
export const EYE_HEIGHT = 1.6;

export interface RoomSlot {
  index: number;
  side: 1 | -1;
  row: number;
  /** World position of the room's floor centre. */
  center: THREE.Vector3;
  /** Rotation of the room group: local +X points from the door to the far wall. */
  rotationY: number;
  /** Where to stand in the hallway in front of the door. */
  doorstep: THREE.Vector3;
}

export function roomSlot(index: number): RoomSlot {
  const side: 1 | -1 = index % 2 === 0 ? 1 : -1;
  const row = Math.floor(index / 2);
  const z = -(row * ROOM_WIDTH + ROOM_WIDTH / 2);
  return {
    index,
    side,
    row,
    center: new THREE.Vector3(side * (HALL_HALF + ROOM_DEPTH / 2), 0, z),
    rotationY: side === 1 ? 0 : Math.PI,
    doorstep: new THREE.Vector3(side * (HALL_HALF - 1.2), 0, z),
  };
}

/** Rows needed for n projects, always leaving at least one vacant room to grow into. */
export function rowsFor(projectCount: number): number {
  return Math.max(1, Math.ceil((projectCount + 1) / 2));
}

/** Converts a point in a room's local frame to world space. */
export function roomToWorld(slot: RoomSlot, local: THREE.Vector3): THREE.Vector3 {
  return local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), slot.rotationY).add(slot.center);
}

export interface Box2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
