import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ContactShadows, footprintOf } from './contactShadow';

const block = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0));
  mesh.position.set(x, y, z);
  return mesh;
};

describe('footprintOf', () => {
  it('covers what stands low, not a sign up on a stand', () => {
    const stand = new THREE.Group().add(block(0.5, 1, 0.5), block(3, 0.3, 0.1, 0, 2.4, 0));
    const foot = footprintOf(stand)!;
    expect(foot.min.x).toBeCloseTo(-0.25);
    expect(foot.max.x).toBeCloseTo(0.25);
  });

  it('is in the object’s own frame, however it’s turned', () => {
    const desk = new THREE.Group().add(block(2, 0.8, 0.6));
    desk.rotation.y = Math.PI / 2;
    const foot = footprintOf(desk)!;
    expect(foot.max.x - foot.min.x).toBeCloseTo(2);
    expect(foot.max.z - foot.min.z).toBeCloseTo(0.6);
  });

  it('is nothing for nothing', () => {
    expect(footprintOf(new THREE.Group())).toBeNull();
  });
});

describe('ContactShadows', () => {
  it('puts every shadow in one mesh, on the floor under each thing, in the root’s frame', () => {
    const room = new THREE.Group();
    room.position.set(100, 0, 0);
    const pot = new THREE.Group().add(block(0.4, 0.4, 0.4));
    pot.position.set(3, 0, 0);
    pot.scale.setScalar(2);
    const table = block(1, 0.7, 1, -3, 0, 0);
    room.add(pot, table);
    const shadows = new ContactShadows(room);
    shadows.add(pot, 'round');
    shadows.add(table);
    const mesh = shadows.build()!;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    // the pot's 0.8 m (scaled) and the table's 1 m, each with its spread round it, in the room's frame
    expect(box.max.x).toBeGreaterThan(3.4);
    expect(box.max.x).toBeLessThan(4);
    expect(box.min.x).toBeLessThan(-3.5);
    expect(box.min.x).toBeGreaterThan(-4.2);
    expect(box.max.y).toBeLessThan(0.05);
  });
});
