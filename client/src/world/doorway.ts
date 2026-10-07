import * as THREE from 'three';

// The geometry of walking through a doorway into another that stands somewhere else entirely (portal.ts): where you
// come out, whether you've gone through, and how to draw only what's beyond the other doorway.

const TURN = new THREE.Matrix4().makeRotationY(Math.PI);

/**
 * What carries a point from beside doorway `from` to the same place beside doorway `to`, turned the same way to it,
 * with in front of one behind the other: what you see through `from`, and where you are once you've gone through it.
 */
export function throughDoor(from: THREE.Matrix4, to: THREE.Matrix4): THREE.Matrix4 {
  return new THREE.Matrix4().multiplyMatrices(to, TURN).multiply(from.clone().invert());
}

/** Whether a point (in a doorway's frame) has stepped through it: past its middle, into the alcove behind it. */
export function inDoorway(local: THREE.Vector3, width: number, depth: number): boolean {
  return local.z > 0 && local.z < depth && Math.abs(local.x) < width / 2;
}

/**
 * Moves a projection's near plane onto `plane` (in the camera's space, facing what's to be drawn), so nothing behind
 * it is: Lengyel's oblique near plane, as three's Reflector does it. Only the depth row changes, so everything still
 * lands on the same pixels. The far plane tilts with it, so give the projection one well beyond the scene.
 */
export function clipNear(projection: THREE.Matrix4, plane: THREE.Plane): void {
  const e = projection.elements;
  const c = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const q = new THREE.Vector4((Math.sign(c.x) + e[8]) / e[0], (Math.sign(c.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
  c.multiplyScalar(2 / c.dot(q));
  e[2] = c.x;
  e[6] = c.y;
  e[10] = c.z + 1;
  e[14] = c.w;
}

/**
 * Where a doorway's opening lands on the screen, seen through `viewProjection`: a rectangle in screen coordinates from
 * 0 to 1 (x and y from the bottom left, then width and height), clipped to the screen. Null when a corner is behind the
 * camera, as when you're stepping through it, so the opening might fill the screen.
 */
export function onScreen(doorway: THREE.Matrix4, width: number, height: number, viewProjection: THREE.Matrix4): THREE.Vector4 | null {
  let [left, bottom, right, top] = [1, 1, 0, 0];
  const corner = new THREE.Vector4();
  for (const [x, y] of [[-width / 2, 0], [width / 2, 0], [-width / 2, height], [width / 2, height]]) {
    corner.set(x, y, 0, 1).applyMatrix4(doorway).applyMatrix4(viewProjection);
    if (corner.w <= 0) return null;
    const sx = (corner.x / corner.w) * 0.5 + 0.5;
    const sy = (corner.y / corner.w) * 0.5 + 0.5;
    [left, bottom, right, top] = [Math.min(left, sx), Math.min(bottom, sy), Math.max(right, sx), Math.max(top, sy)];
  }
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  [left, bottom, right, top] = [clamp(left), clamp(bottom), clamp(right), clamp(top)];
  return new THREE.Vector4(left, bottom, Math.max(0, right - left), Math.max(0, top - bottom));
}
