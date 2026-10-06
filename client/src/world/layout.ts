import * as THREE from 'three';

// The office is T-shaped: the observation lounge (furthest north), the manager's office, the lobby, then a long
// hallway (south) with one project room per side every ROOM_WIDTH metres.
export const WALL_H = 3.2;
export const WALL_T = 0.2;
export const DOOR_W = 2.4;
export const DOOR_H = 2.5;
/** How far a door frame's face stands out from its wall's centre line. */
export const FRAME_FACE = WALL_T / 2 + 0.04;
/** Where a sign over a door hangs: far enough in front of the frame to win the depth test from down the hall. */
export const OVER_DOOR = FRAME_FACE + 0.02;
export const HALL_HALF = 2;
export const ROOM_DEPTH = 14; // from the hallway wall to the outer wall
export const ROOM_WIDTH = 12; // along the hallway
export const LOBBY = { x0: -7, x1: 7, z0: 0, z1: 10 };
export const OFFICE = { x0: -6, x1: 6, z0: 10, z1: 18 };
/** The observation lounge: a long table under the viewports, through a door in the manager's office's north wall. */
export const LOUNGE = { x0: -6, x1: 6, z0: 18, z1: 25 };
/** The lounge door, off to the west so the manager's desk doesn't sit in front of it. */
export const LOUNGE_DOOR_X = -3.4;
export const EYE_HEIGHT = 1.6;
/** Where the office's sun light comes from (painted suns in the room landscapes line up with it). */
export const SUN_POSITION = new THREE.Vector3(6, 10, 4);

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
