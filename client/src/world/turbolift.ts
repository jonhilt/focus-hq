import type * as THREE from 'three';
import type { Place } from './ship';

/** How far from a stop you can be and still be at it: anywhere in its car, or at its call panel. */
const AT_STOP = 2.5;

/** The turbolift stop you're at, if you're at one: the nearest within reach, measured across the floor. */
export function stopAt(stops: Place[], at: THREE.Vector3): Place | undefined {
  let nearest: Place | undefined;
  let best = AT_STOP;
  for (const stop of stops) {
    const d = Math.hypot(stop.position.x - at.x, stop.position.z - at.z);
    if (d <= best) {
      nearest = stop;
      best = d;
    }
  }
  return nearest;
}
