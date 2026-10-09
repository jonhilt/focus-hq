import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { clearOfHall, insideHall, keepOut } from './footprint';
import { HALL } from './layout';

const thing = (w: number, h: number, d: number, x: number, z: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0));
  m.position.set(x, 0, z);
  return m;
};
/** How near a thing comes to the middle of the floor. */
const nearest = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o);
  return Math.hypot(THREE.MathUtils.clamp(0, b.min.x, b.max.x), THREE.MathUtils.clamp(0, b.min.z, b.max.z));
};

describe('keepOut', () => {
  it('moves what stands inside the hall out beyond its wall, straight away from the middle', () => {
    // a sandcastle beside the far wall, and a palm whose leaves reach in
    const castle = thing(1.4, 1.2, 1.4, 10.2, 3.2);
    const palm = thing(7, 7, 7, -3, 12);
    keepOut([castle, palm]);
    for (const o of [castle, palm]) expect(nearest(o)).toBeGreaterThan(HALL.radius + 0.5);
    expect(Math.atan2(castle.position.z, castle.position.x)).toBeCloseTo(Math.atan2(3.2, 10.2), 1);
  });

  it('leaves what’s flat, as big as a building, or already clear where it is', () => {
    const path = thing(2, 0.02, 2, 3, 0);
    const roof = thing(40, 1, 32, 4, 0);
    const far = thing(1, 3, 1, 20, 0);
    keepOut([path, roof, far]);
    expect([path.position.x, roof.position.x, far.position.x]).toEqual([3, 4, 20]);
  });
});

describe('the hall’s footprint', () => {
  it('tells what’s clear of it and what’s inside', () => {
    const inside = new THREE.Vector3(0, 0, 9);
    const out = new THREE.Vector3(0, 0, HALL.radius + 1.5);
    expect([clearOfHall(inside), insideHall(inside)]).toEqual([false, true]);
    expect([clearOfHall(out), insideHall(out)]).toEqual([true, false]);
  });
});
