import type { Box2 } from './world/layout';

// Where the player may stand, as a square `radius` either side of them on the floor among the colliders' boxes.

/** Whether a player standing at (x, z) touches box `b`. */
export function touches(b: Box2, x: number, z: number, radius: number): boolean {
  return x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ;
}

/**
 * Whether the player may move from (x0, z0) to (x, z): unless it touches a box they weren't already touching. Someone
 * already overlapping a box (put there by a doorway or a teleport) can still walk out of it, rather than freeze.
 */
export function canMove(boxes: readonly Box2[], x0: number, z0: number, x: number, z: number, radius: number): boolean {
  for (const b of boxes) if (touches(b, x, z, radius) && !touches(b, x0, z0, radius)) return false;
  return true;
}

/**
 * Where the player can stand nearest (x, z) along the way to (toX, toZ), in steps of `step`: (x, z) itself if it's
 * clear, or null if nowhere on the way is. A doorway's far end uses it to slide someone who's come out against its
 * jamb into the opening.
 */
export function clearToward(
  boxes: readonly Box2[],
  x: number,
  z: number,
  toX: number,
  toZ: number,
  radius: number,
  step = 0.02,
): { x: number; z: number } | null {
  const n = Math.ceil(Math.hypot(toX - x, toZ - z) / step);
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const px = x + (toX - x) * t;
    const pz = z + (toZ - z) * t;
    if (!boxes.some((b) => touches(b, px, pz, radius))) return { x: px, z: pz };
  }
  return null;
}
