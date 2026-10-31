import * as THREE from 'three';

/** A geometry's bounding box (its own frame), worked out the first time it's asked for and kept on it, as three does. */
export function boundsOf(geometry: THREE.BufferGeometry): THREE.Box3 {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error('computeBoundingBox left the geometry without a box');
  return box;
}
