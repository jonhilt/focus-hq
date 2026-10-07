import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { clipNear, inDoorway, throughDoor } from './doorway';

/** A doorway at `at`, turned `yaw` about Y: facing out into its room along its forward (-Z, turned). */
const doorway = (at: [number, number, number], yaw: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));

const near = (a: THREE.Vector3, b: THREE.Vector3) => expect(a.distanceTo(b)).toBeLessThan(1e-9);

describe('throughDoor', () => {
  // a holodeck's door facing south into its room, and a briefing room's far off facing east into its
  const holodeck = doorway([7.6, 0, -10.9], Math.PI);
  const briefing = doorway([40, 0, -0.9], -Math.PI / 2);
  const through = throughDoor(holodeck, briefing);

  it('carries a point in front of one doorway to as far behind the other, turned the same way to it', () => {
    // 2 m in front of the holodeck's door, half a metre to its left as you face it
    const before = new THREE.Vector3(-0.5, 1.6, -2).applyMatrix4(holodeck);
    near(before.clone().applyMatrix4(through), new THREE.Vector3(0.5, 1.6, 2).applyMatrix4(briefing));
  });

  it('carries a step through one doorway to a step out of the other, into its room', () => {
    const stepped = new THREE.Vector3(0.2, 1.6, 0.05).applyMatrix4(holodeck).applyMatrix4(through);
    near(stepped, new THREE.Vector3(-0.2, 1.6, -0.05).applyMatrix4(briefing));
    expect(stepped.clone().applyMatrix4(briefing.clone().invert()).z).toBeLessThan(0);
  });

  it('turns the way you face as the doorways are turned to each other', () => {
    // walking straight in through the holodeck's door is walking straight into the briefing room
    const walking = new THREE.Vector3(0, 0, 1).transformDirection(holodeck);
    near(walking.clone().transformDirection(through), new THREE.Vector3(0, 0, -1).transformDirection(briefing));
  });

  it('comes back the way it went', () => {
    const p = new THREE.Vector3(3, 1.2, -4);
    near(p.clone().applyMatrix4(through).applyMatrix4(throughDoor(briefing, holodeck)), p);
  });
});

describe('inDoorway', () => {
  const [width, depth] = [2, 0.75];

  it('is through once past the middle of the doorway, in the alcove behind it', () => {
    expect(inDoorway(new THREE.Vector3(0.6, 1.6, 0.01), width, depth)).toBe(true);
    expect(inDoorway(new THREE.Vector3(-0.9, 1.6, 0.7), width, depth)).toBe(true);
  });

  it('isn’t in front of it, beside it or beyond the alcove', () => {
    expect(inDoorway(new THREE.Vector3(0, 1.6, -0.01), width, depth)).toBe(false);
    expect(inDoorway(new THREE.Vector3(1.1, 1.6, 0.3), width, depth)).toBe(false);
    expect(inDoorway(new THREE.Vector3(0, 1.6, 0.8), width, depth)).toBe(false);
  });
});

describe('clipNear', () => {
  const camera = new THREE.PerspectiveCamera(70, 1.6, 0.05, 250);
  // a plane 2 m ahead of the camera, askew, facing away from it
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0.3, 0, -1).normalize(), new THREE.Vector3(0, 0, -2));
  const clipped = camera.projectionMatrix.clone();
  clipNear(clipped, plane);
  const project = (m: THREE.Matrix4, p: THREE.Vector3) => {
    const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(m);
    return new THREE.Vector3(v.x / v.w, v.y / v.w, v.z / v.w);
  };

  it('draws what’s beyond the plane, on the same pixels', () => {
    const p = new THREE.Vector3(0.4, -0.3, -6);
    const ndc = project(clipped, p);
    expect(Math.abs(ndc.z)).toBeLessThan(1);
    const plain = project(camera.projectionMatrix, p);
    expect(ndc.x).toBeCloseTo(plain.x, 12);
    expect(ndc.y).toBeCloseTo(plain.y, 12);
  });

  it('clips what’s between the camera and the plane', () => {
    expect(project(clipped, new THREE.Vector3(0, 0, -1)).z).toBeLessThan(-1);
    expect(project(clipped, new THREE.Vector3(0.2, 0.1, -1.8)).z).toBeLessThan(-1);
  });
});
