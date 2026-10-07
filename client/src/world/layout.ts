import * as THREE from 'three';

// The holodeck deck: a hallway running south from z = 0, with a holodeck (one project's room) either side of it every
// ROOM_WIDTH metres; the decks built in Blender keep to these sizes (blender/holodeck_deck.py). The command deck stands
// off to the north (COMMAND_DECK), and the team stations' briefing rooms out to either side (briefingRoomAt).
export const WALL_H = 3.2;
export const WALL_T = 0.2;
export const DOOR_W = 2.4;
export const DOOR_H = 2.5;
/** How far a door frame's face stands out from its wall's centre line. */
export const FRAME_FACE = WALL_T / 2 + 0.04;
/** Where a sign over a door hangs: far enough in front of the frame to win the depth test from down the hall. */
export const OVER_DOOR = FRAME_FACE + 0.02;
export const HALL_HALF = 2;
export const ROOM_DEPTH = 16; // from the hallway wall to the outer wall
export const ROOM_WIDTH = 12; // along the hallway
export const EYE_HEIGHT = 1.6;
/**
 * Where the command deck (built in Blender: world/deck.ts) sits: aft of the rest of the ship, on its long axis so the
 * viewscreen sees space the way the corridor's end window does.
 */
export const COMMAND_DECK = new THREE.Vector3(0, 0, 80);
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

/** The slot of the holodeck in row `row` on `side` of the hallway: roomSlot's index, from where the holodeck stands. */
export function slotAt(row: number, side: 1 | -1): number {
  return row * 2 + (side > 0 ? 0 : 1);
}

/** Rows needed for n projects, always leaving at least one vacant room to grow into. */
export function rowsFor(projectCount: number): number {
  return Math.max(1, Math.ceil((projectCount + 1) / 2));
}

/**
 * Where a team station's briefing room stands (blender/team_station.py): out beyond its holodeck's side of the ship,
 * a row of them per holodeck, nowhere you could walk or see to except through its door. Each runs `depth` south from
 * its doorway (to the far wall's back) and `width` across, centred on its holodeck's row, with an alcove `alcove` deep
 * behind its door, so neither the rows' rooms nor the stations' meet.
 */
export const BRIEFING = { x: 40, step: 10, depth: 10.3, width: 7.4, alcove: 0.9 };

/** Where station `station`'s briefing room doorway stands, for the holodeck in `slot`; the room runs south of it. */
export function briefingRoomAt(slot: RoomSlot, station: number): THREE.Vector3 {
  return new THREE.Vector3(slot.side * (BRIEFING.x + station * BRIEFING.step), 0, slot.center.z + BRIEFING.depth / 2);
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

/** Where a crew member's chair stands, and a point they turn to face. */
export interface Seat {
  at: THREE.Vector3;
  facing: THREE.Vector3;
}

/** The turn about Y that faces a seat's chair, and whoever sits in it (built facing +X), towards what they face. */
export function seatYaw({ at, facing }: Seat): number {
  return Math.atan2(-(facing.z - at.z), facing.x - at.x);
}

export function contains(b: Box2, p: THREE.Vector3): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
}
