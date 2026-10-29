import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { around, ENTRANCE_X, HALL_SCREEN, HALL_SCREEN_ANGLES, HALL_SCREENS, hallScreenSpots, STATION_ANGLE, stationSpot } from './hallLayout';
import { type Box2, contains, DOOR_H, DOOR_W, footprint, footprints, HALL, WALL_T } from './layout';

// The player is a 0.3 m radius (player.ts), colliding only with boxes square to the world.
const RADIUS = 0.3;
const blocks = (boxes: Box2[], p: THREE.Vector3) =>
  boxes.some((b) => p.x + RADIUS > b.minX && p.x - RADIUS < b.maxX && p.z + RADIUS > b.minZ && p.z - RADIUS < b.maxZ);

/** A module's colliders and its doorway, in its own frame, as Blender exported them into `file`. */
function markers(file: string, module: string): { colliders: THREE.Matrix4[]; doorway: THREE.Matrix4; size: { width: number; height: number; depth: number } } {
  const glb = readFileSync(path.resolve(import.meta.dirname, '../../public/ship', file));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as {
    nodes: { name?: string; children?: number[]; extras?: { marker?: string; width?: number; height?: number; depth?: number }; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  };
  const root = json.nodes.find((n) => n.name === module)!;
  const matrix = (n: (typeof json.nodes)[number]) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
      new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
      new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
    );
  const children = (root.children ?? []).map((i) => json.nodes[i]);
  const portal = children.find((n) => n.extras?.marker === 'portal')!;
  return {
    colliders: children.filter((n) => n.extras?.marker === 'collider').map(matrix),
    doorway: matrix(portal),
    size: { width: portal.extras!.width!, height: portal.extras!.height!, depth: portal.extras!.depth! },
  };
}

describe('the goal viewing station’s pod', () => {
  const { colliders, doorway } = markers('team-station.glb', 'station_door');

  it('can be walked into, turned as it stands', () => {
    expect(colliders.length).toBeGreaterThan(0);
    for (const { wall, yaw } of [stationSpot()]) {
      const frame = new THREE.Matrix4().makeRotationY(yaw).setPosition(wall);
      const boxes = colliders.flatMap((m) => footprints(new THREE.Matrix4().multiplyMatrices(frame, m)));
      const through = new THREE.Matrix4().multiplyMatrices(frame, doorway);
      // straight up to the doorway from in front of it, and over its middle, where you step through
      for (let z = -1.5; z <= 0.05; z += 0.1) expect(blocks(boxes, new THREE.Vector3(0, 0, z).applyMatrix4(through)), `yaw ${yaw}, ${z.toFixed(1)} m`).toBe(false);
    }
  });
});

describe('the training hall’s shell', () => {
  const { colliders, doorway, size } = markers('training-hall.glb', 'training_hall');
  const boxes = colliders.flatMap((m) => footprints(m));

  it('has its entrance in the middle of the flat wall, facing in, as big as the holodeck door on the deck', () => {
    const at = new THREE.Vector3().setFromMatrixPosition(doorway);
    expect(at.x).toBeCloseTo(ENTRANCE_X - WALL_T / 2, 3);
    expect(at.z).toBeCloseTo(0, 3);
    // a doorway faces into its room along its forward (-Z)
    const forward = new THREE.Vector3(0, 0, -1).transformDirection(doorway);
    expect(forward.x).toBeCloseTo(1, 3);
    expect(size).toEqual({ width: DOOR_W, height: DOOR_H, depth: HALL.alcove });
  });

  it('can be walked into from the entrance, and out to the station’s pod', () => {
    // over the entrance's threshold and on to the middle of the floor
    for (let z = 0.05; z >= -12; z -= 0.1) expect(blocks(boxes, new THREE.Vector3(0, 0, z).applyMatrix4(doorway)), `${z.toFixed(1)} m in`).toBe(false);
    // and from the middle out to where the station's pod stands, its back against the wall
    for (const { wall } of [stationSpot()]) {
      for (let t = 0; t <= 1; t += 0.02) expect(blocks(boxes, wall.clone().multiplyScalar(t * (HALL.radius - 0.6) / HALL.radius))).toBe(false);
    }
  });

  it('keeps you in, all the way round', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      const out = around(HALL.radius + 0.1, a);
      // the entrance's doorway is the way out
      if (Math.abs(out.z) < DOOR_W / 2 && out.x < 0) continue;
      expect(blocks(boxes, out), `${a.toFixed(2)} rad`).toBe(true);
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

describe('hall screens', () => {
  it('hang either side of the entrance, clear of the station’s pod and the entrance’s wall, facing the middle', () => {
    const spots = hallScreenSpots(HALL_SCREENS + 2);
    expect(spots).toHaveLength(HALL_SCREENS);
    const half = HALL_SCREEN.width / 2 / HALL_SCREEN.r;
    const gap = Math.asin(2.4 / HALL.radius);
    for (const a of HALL_SCREEN_ANGLES) {
      // clear of the pod (about 1.2 m either side of its middle at the wall) and the entrance's flat wall
      expect(Math.abs(a - STATION_ANGLE)).toBeGreaterThan(half + 1.2 / HALL.radius);
      expect(Math.abs(a) + half).toBeLessThan(Math.PI - gap);
    }
    for (const { at, yaw } of spots) {
      // a plane's front (+Z) turned by yaw points back at the middle
      const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      expect(front.dot(new THREE.Vector3(-at.x, 0, -at.z).normalize())).toBeCloseTo(1);
    }
  });
});
