import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { boundsOf } from './boundsOf';

describe('boundsOf', () => {
  it('works out a geometry’s box the first time, in its own frame', () => {
    const geometry = new THREE.BoxGeometry(2, 4, 6).translate(1, 0, 0);
    expect(geometry.boundingBox).toBeNull();
    const box = boundsOf(geometry);
    expect(box.min.toArray()).toEqual([0, -2, -3]);
    expect(box.max.toArray()).toEqual([2, 2, 3]);
  });

  it('keeps the box it worked out, rather than working it out again', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const kept = new THREE.Box3(new THREE.Vector3(-9, -9, -9), new THREE.Vector3(9, 9, 9));
    geometry.boundingBox = kept;
    expect(boundsOf(geometry)).toBe(kept);
    expect(kept.max.toArray()).toEqual([9, 9, 9]);
  });
});
