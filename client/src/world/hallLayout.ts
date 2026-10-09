import * as THREE from 'three';
import { HALL, HALL_HALF, type RoomSlot } from './layout';
import type { Doorway } from './portal';
import type { PodSpot } from './teamStation';

// Where things stand in a training hall (blender/training_hall.py builds its shell, which keeps to these sizes): its frame is a room's, +X from the entrance to the
// far wall, the middle of its floor at the origin. Nothing here draws, so it can be tested without a browser.

const R = HALL.radius;
/** Half the angle the flat wall with the entrance in it takes out of the round wall, either side of straight back. */
const GAP = Math.asin(2.4 / R);
/** Where the flat wall with the entrance in it stands, its inner face, behind the hall's middle. */
export const ENTRANCE_X = -R * Math.cos(GAP);

/** A point `r` from the middle of the hall's floor, `angle` round from straight ahead (+X) towards +Z, `y` up. */
export function around(r: number, angle: number, y = 0): THREE.Vector3 {
  return new THREE.Vector3(r * Math.cos(angle), y, r * Math.sin(angle));
}

/** The turn about Y that faces something standing `angle` round the hall (built facing -Z) in, to the middle. */
export function facingIn(angle: number): number {
  return Math.PI / 2 - angle;
}

/**
 * A strip of the inside of a cylinder `r` round the hall's middle, facing in: from `a0` round to `a1`, `y0` to `y1`
 * up, its texture's left edge at `a0`, as you see it from the middle.
 */
export function curvedPanel(r: number, a0: number, a1: number, y0: number, y1: number, segments = 24): THREE.BufferGeometry {
  const width = r * (a1 - a0);
  const g = new THREE.PlaneGeometry(width, y1 - y0, segments, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const a = a0 + (pos.getX(i) + width / 2) / r;
    pos.setXYZ(i, r * Math.cos(a), pos.getY(i) + (y0 + y1) / 2, r * Math.sin(a));
  }
  g.computeVertexNormals();
  return g;
}

/** Where the pods stand round the wall, left to right as you come in: either side of the board, clear of the entrance. */
export const POD_ANGLES = [-90, -45, 45, 90].map((d) => THREE.MathUtils.degToRad(d));

/** The pods' spots round the hall's wall. */
export function hallPodSpots(): PodSpot[] {
  return POD_ANGLES.map((a) => ({ wall: around(R, a), yaw: facingIn(a) }));
}

/**
 * The holodeck's door on the deck (world): in the hallway's wall, facing out into the hallway, the same size as the
 * hall's `entrance`, as a portal's two doorways must be.
 */
export function deckEntrance(slot: RoomSlot, entrance: Doorway): Doorway {
  // forward (-Z) out into the hallway, the alcove behind it where the holodeck's room was
  const matrix = new THREE.Matrix4().makeRotationY((slot.side * Math.PI) / 2).setPosition(slot.side * HALL_HALF, 0, slot.center.z);
  return { matrix, width: entrance.width, height: entrance.height, depth: entrance.depth };
}

/** Whether a world position is in the hall whose middle is at `centre` (or the alcove behind its entrance). */
export function inHall(centre: THREE.Vector3, p: THREE.Vector3): boolean {
  return Math.hypot(p.x - centre.x, p.z - centre.z) < R + HALL.alcove + 0.5;
}
