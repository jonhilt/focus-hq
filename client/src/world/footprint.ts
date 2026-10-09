import * as THREE from 'three';
import { ENTRANCE_X } from './hallLayout';
import { HALL } from './layout';

// The floor a holodeck's landscape (scenery.ts) is built round and shows through the walls of: its training hall
// (hall.ts), round and 22 m across, the middle of its floor the origin, +X from its entrance to its far wall. Nothing
// here draws, so it can be tested without a browser.

/** Whether a ground point is clear of the hall's walls, by `margin`. */
export function clearOfHall(p: THREE.Vector3, margin = 1.2): boolean {
  return Math.hypot(p.x, p.z) > HALL.radius + margin;
}

/** Whether a point is inside the hall's walls. */
export function insideHall(p: THREE.Vector3): boolean {
  return Math.hypot(p.x, p.z) < HALL.radius && p.x > ENTRANCE_X;
}

/** What `keepOut` leaves where it is: anything lying flat or sunk (ground, paths, water), or as big as a building. */
const FLAT = 0.15;
const BIG = 12;
/** How far beyond the hall's wall `keepOut` moves what stood inside it. */
const KEEP_OUT = 0.6;

/**
 * Moves anything a landscape would stand inside the hall out beyond its wall, straight away from the middle: the
 * themes were laid out round a smaller room, and placements test `clearOfHall` but not every fixed one does. Flat
 * things and big ones stay put: you never see the ground through the hall's floor, and a big one (the city's roof, the
 * library's walls) is built round it. `objects` are parentless, so their position is where they stand.
 */
export function keepOut(objects: THREE.Object3D[]): void {
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
