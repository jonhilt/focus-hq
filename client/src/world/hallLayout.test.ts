import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hallPodSpots } from './hallLayout';
import { type Box2, contains, footprint, footprints } from './layout';

// The player is a 0.3 m radius (player.ts), colliding only with boxes square to the world.
const RADIUS = 0.3;
const blocks = (boxes: Box2[], p: THREE.Vector3) =>
  boxes.some((b) => p.x + RADIUS > b.minX && p.x - RADIUS < b.maxX && p.z + RADIUS > b.minZ && p.z - RADIUS < b.maxZ);

/** The team station's door module, as Blender exported it: its colliders and its doorway, in its own frame. */
function podMarkers(): { colliders: THREE.Matrix4[]; doorway: THREE.Matrix4 } {
  const glb = readFileSync(path.resolve(import.meta.dirname, '../../public/ship/team-station.glb'));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as {
    nodes: { name?: string; children?: number[]; extras?: { marker?: string }; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  };
  const door = json.nodes.find((n) => n.name === 'station_door')!;
  const matrix = (n: (typeof json.nodes)[number]) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
      new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
      new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
    );
  const children = (door.children ?? []).map((i) => json.nodes[i]);
  return {
    colliders: children.filter((n) => n.extras?.marker === 'collider').map(matrix),
    doorway: matrix(children.find((n) => n.extras?.marker === 'portal')!),
  };
}

describe('the training hall’s pods', () => {
  const { colliders, doorway } = podMarkers();

  it('can all be walked into, however they’re turned', () => {
    expect(colliders.length).toBeGreaterThan(0);
    for (const { wall, yaw } of hallPodSpots()) {
      const frame = new THREE.Matrix4().makeRotationY(yaw).setPosition(wall);
      const boxes = colliders.flatMap((m) => footprints(new THREE.Matrix4().multiplyMatrices(frame, m)));
      const through = new THREE.Matrix4().multiplyMatrices(frame, doorway);
      // straight up to the doorway from in front of it, and over its middle, where you step through
      for (let z = -1.5; z <= 0.05; z += 0.1) expect(blocks(boxes, new THREE.Vector3(0, 0, z).applyMatrix4(through)), `yaw ${yaw}, ${z.toFixed(1)} m`).toBe(false);
    }
  });
});

describe('footprints', () => {
  it('is the one footprint for a box square to the world', () => {
    const m = new THREE.Matrix4().makeRotationY(Math.PI / 2).scale(new THREE.Vector3(1, 1, 0.2)).setPosition(3, 0, 1);
    expect(footprints(m)).toEqual([footprint(m)]);
  });

  it('follows a turned box closely, all of it and little more', () => {
    // 2 m by 0.4 m, turned 45°
    const m = new THREE.Matrix4().makeRotationY(Math.PI / 4).scale(new THREE.Vector3(1, 1, 0.2));
    const cells = footprints(m);
    const along = new THREE.Vector3(1, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 4));
    const across = new THREE.Vector3(0, 0, 1).applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 4));
    // every point of it is in a cell
    for (let a = -0.95; a <= 0.95; a += 0.1) for (const b of [-0.18, 0, 0.18]) expect(cells.some((c) => contains(c, along.clone().multiplyScalar(a).addScaledVector(across, b)))).toBe(true);
    // and a point 0.4 m off its side, which its whole footprint would cover, is in none
    expect(contains(footprint(m), across.clone().multiplyScalar(0.6))).toBe(true);
    expect(cells.some((c) => contains(c, across.clone().multiplyScalar(0.6)))).toBe(false);
  });
});
