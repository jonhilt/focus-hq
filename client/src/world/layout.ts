import * as THREE from 'three';
import { TEAM_STATIONS } from '../../../shared/types';

// The holodeck deck: a hallway running south from z = 0, with a holodeck (one project's room) either side of it every
// ROOM_WIDTH metres; the decks built in Blender keep to these sizes (blender/holodeck_deck.py). The command deck stands
// off to the north (COMMAND_DECK) with main engineering beyond it (ENGINEERING_DECK), the team stations' briefing
// rooms out to either side (briefingRoomAt), and their transporter rooms far beyond main engineering (transporterRoomAt).
export const WALL_H = 3.2;
export const WALL_T = 0.2;
export const DOOR_W = 2.4;
export const DOOR_H = 2.5;
/** How far a door frame's face stands out from its wall's centre line. */
export const FRAME_FACE = WALL_T / 2 + 0.04;
/** Where a sign over a door hangs: far enough in front of the frame to win the depth test from down the hall. */
export const OVER_DOOR = FRAME_FACE + 0.02;
export const HALL_HALF = 2;
/** A holodeck's slot on the deck, beside the hallway: how far out from it (nothing's there; its hall stands far off). */
export const ROOM_DEPTH = 16;
/** A holodeck's slot along the hallway: one door either side every ROOM_WIDTH. */
export const ROOM_WIDTH = 12;
export const EYE_HEIGHT = 1.6;
/**
 * Where the command deck (built in Blender: world/deck.ts) sits: aft of the rest of the ship, on its long axis so the
 * viewscreen sees space the way the corridor's end window does.
 */
export const COMMAND_DECK = new THREE.Vector3(0, 0, 80);
/** Where main engineering (deck 5, built in Blender) sits: beyond the command deck, where nothing else stands. */
export const ENGINEERING_DECK = new THREE.Vector3(0, 0, 140);
/**
 * Where stellar cartography (built in Blender) sits: beyond main engineering, short of the transporter rooms, its
 * sphere reaching 12 m round the middle of its platform.
 */
export const CARTOGRAPHY_DECK = new THREE.Vector3(0, 0, 190);
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
export const BRIEFING = { x: 40, step: 13, depth: 10.9, width: 11.4, alcove: 0.9 };

/** Where station `station`'s briefing room doorway stands, for the holodeck in `slot`; the room runs south of it. */
export function briefingRoomAt(slot: RoomSlot, station: number): THREE.Vector3 {
  return new THREE.Vector3(slot.side * (BRIEFING.x + station * BRIEFING.step), 0, slot.center.z + BRIEFING.depth / 2);
}

/** How many transporter rooms each team station has: one per workflow its lead can run at once (transporterRoom.ts). */
export const TRANSPORTER_ROOMS = 3;

/**
 * Where the transporter rooms stand (blender/transporter_room.py): far beyond main engineering, where nothing else
 * stands or grows, since you only ever beam in. A row of them per holodeck, `step` apart, row after row going on north
 * from `z`, each row a room for each of its team stations' transporter rooms side by side, `step` apart, either side
 * of the ship's long axis. Each is `width` across and `depth` from its front wall to the back of its niches, round the
 * middle of its floor (its origin), its walls' backs included.
 */
export const TRANSPORTER = { z: 240, step: 12, width: 9.8, depth: 9.3 };

/**
 * Where transporter room `room` of the team station `station` of the holodeck in `slot` stands: the middle of its
 * floor (the room stands unturned, its platform towards -Z).
 */
export function transporterRoomAt(slot: RoomSlot, station: number, room: number): THREE.Vector3 {
  const column = station * TRANSPORTER_ROOMS + room - (TEAM_STATIONS * TRANSPORTER_ROOMS - 1) / 2;
  return new THREE.Vector3(column * TRANSPORTER.step, 0, TRANSPORTER.z + slot.index * TRANSPORTER.step);
}

/**
 * The training hall (hall.ts): what a project's holodeck is, bigger on the inside than its slot on the deck. Its door
 * on the deck is a Portal to the hall's entrance, so the hall can stand anywhere: out beyond the briefing rooms, one per
 * holodeck, each further out the further down the hallway its holodeck is, so none meet. A round floor `radius` across
 * its middle, under a ceiling `height` up, with an alcove `alcove` deep behind its entrance.
 */
export const HALL = { x: 150, step: 40, radius: 11, height: 6.4, alcove: 0.9 };

/** Where the training hall of the holodeck in `slot` stands: the middle of its floor, its entrance towards the hallway. */
export function hallAt(slot: RoomSlot): THREE.Vector3 {
  return new THREE.Vector3(slot.side * (HALL.x + slot.row * HALL.step), 0, slot.center.z);
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

/** The floor an empty cube's box covers, given its world matrix. */
export function footprint(matrixWorld: THREE.Matrix4): Box2 {
  const b = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)).applyMatrix4(matrixWorld);
  return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
}

/**
 * The floor an empty cube's box covers, as boxes the player collides with (they're all square to the world): the one
 * footprint while it's square to the world too, or else a grid of cells no more than `cell` across, each its own
 * footprint, which follow it closely however it's turned. Turned whole, its footprint could grow over a doorway.
 */
export function footprints(matrixWorld: THREE.Matrix4, cell = 0.2): Box2[] {
  const e = matrixWorld.elements;
  const square = (Math.abs(e[0]) < 1e-6 || Math.abs(e[2]) < 1e-6) && (Math.abs(e[8]) < 1e-6 || Math.abs(e[10]) < 1e-6);
  if (square) return [footprint(matrixWorld)];
  // across and along the cube's floor, from its middle to its edges
  const nx = Math.max(1, Math.ceil((2 * Math.hypot(e[0], e[2])) / cell));
  const nz = Math.max(1, Math.ceil((2 * Math.hypot(e[8], e[10])) / cell));
  const cells: Box2[] = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      // the cell, as a cube of its own in the cube's frame
      m.makeScale(1 / nx, 1, 1 / nz).setPosition(-1 + (2 * i + 1) / nx, 0, -1 + (2 * j + 1) / nz);
      cells.push(footprint(m.premultiply(matrixWorld)));
    }
  }
  return cells;
}

export function contains(b: Box2, p: THREE.Vector3): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
}
