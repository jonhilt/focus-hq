import * as THREE from 'three';
import { ENTRANCE_X } from './hallLayout';
import { HALL, ROOM_DEPTH, ROOM_WIDTH } from './layout';

// The floor a holodeck's landscape (scenery.ts) is built round and shows through the walls of: today's room, 16 by
// 12 m, or a training hall (hall.ts), round and 22 m across. In the frame of either, the middle of its floor is the
// origin and +X runs from its door to its far wall. Nothing here draws, so it can be tested without a browser.

export type Footprint = 'room' | 'hall';

const HALF_D = ROOM_DEPTH / 2;
const HALF_W = ROOM_WIDTH / 2;

/** How far its walls reach from the middle of its floor, at most. */
export function reach(footprint: Footprint): number {
  return footprint === 'hall' ? HALL.radius : Math.hypot(HALF_D, HALF_W);
}

/** Whether a ground point is clear of its walls, by `margin`. */
export function clearOf(footprint: Footprint, p: THREE.Vector3, margin = 1.2): boolean {
  if (footprint === 'hall') return Math.hypot(p.x, p.z) > HALL.radius + margin;
  return Math.abs(p.x) > HALF_D + margin || Math.abs(p.z) > HALF_W + margin;
}

/** Whether a point is inside its walls. */
export function insideOf(footprint: Footprint, p: THREE.Vector3): boolean {
  if (footprint === 'hall') return Math.hypot(p.x, p.z) < HALL.radius && p.x > ENTRANCE_X;
  return Math.abs(p.x) < HALF_D && Math.abs(p.z) < HALF_W;
}

/** Where its door's wall stands: anything wholly behind it is on the far side from where you'd look in. */
export function doorWall(footprint: Footprint): number {
  return footprint === 'hall' ? ENTRANCE_X : -HALF_D;
}

/** What `keepOut` leaves where it is: anything lying flat or sunk (ground, paths, water), or as big as a building. */
const FLAT = 0.15;
const BIG = 12;
/** How far beyond a hall's wall `keepOut` moves what stood inside it. */
const KEEP_OUT = 0.6;

/**
 * Moves anything a landscape built for today's room would stand inside a hall out beyond its wall, straight away from
 * the middle: the themes keep clear of the room, and the hall reaches further. Flat things and big ones stay put: you
 * never see the ground through the hall's floor, and a big one (the city's roof, the library's walls) is built round
 * it. `objects` are parentless, so their position is where they stand. Today's room is left as its themes built it.
 */
export function keepOut(footprint: Footprint, objects: THREE.Object3D[]): void {
  if (footprint !== 'hall') return;
  const box = new THREE.Box3();
  const away = new THREE.Vector3();
  for (const obj of objects) {
    for (let tries = 0; tries < 8; tries++) {
      obj.updateMatrixWorld(true);
      box.setFromObject(obj);
      if (box.isEmpty() || box.max.y < FLAT || box.max.x - box.min.x > BIG || box.max.z - box.min.z > BIG) break;
      // the nearest it comes to the middle of the floor
      const x = THREE.MathUtils.clamp(0, box.min.x, box.max.x);
      const z = THREE.MathUtils.clamp(0, box.min.z, box.max.z);
      const short = HALL.radius + KEEP_OUT - Math.hypot(x, z);
      if (short <= 0) break;
      box.getCenter(away).setY(0);
      if (away.lengthSq() < 1e-6) away.set(1, 0, 0);
      obj.position.addScaledVector(away.normalize(), short + 0.05);
    }
  }
}
