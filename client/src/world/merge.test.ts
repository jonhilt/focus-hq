import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { isMesh } from './isMesh';
import { MERGE_CELL, mergeStatic } from './merge';

const red = new THREE.MeshBasicMaterial({ color: 'red' });
const blue = new THREE.MeshBasicMaterial({ color: 'blue' });
const box = (material: THREE.Material, x = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.position.set(x, 0.5, z);
  return mesh;
};
const meshes = (root: THREE.Object3D) => {
  const found: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (isMesh(o)) found.push(o);
  });
  return found;
};
/** Where a mesh's triangles are, in `root`'s frame. */
const bounds = (root: THREE.Object3D) => {
  root.updateMatrixWorld(true);
  const b = new THREE.Box3();
  for (const mesh of meshes(root)) b.union(new THREE.Box3().setFromObject(mesh, true));
  return b;
};

describe('mergeStatic', () => {
  it('merges meshes of one material into one, where they were', () => {
    const root = new THREE.Group();
    const room = new THREE.Group();
    room.position.set(2, 0, 2);
    room.rotation.y = Math.PI / 2;
    // all on one patch of floor, turned and all
    room.add(box(red), box(red, 1, 0), box(red, 0, 1));
    root.add(room);
    const before = bounds(root);
    expect(mergeStatic(root)).toEqual({ from: 3, to: 1 });
    expect(meshes(root)).toHaveLength(1);
    const after = bounds(root);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-6);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-6);
  });

  it('keeps materials apart, and patches of floor', () => {
    const root = new THREE.Group().add(box(red), box(red, 1), box(blue), box(blue, 1), box(red, MERGE_CELL * 2), box(red, MERGE_CELL * 2 + 1));
    expect(mergeStatic(root)).toEqual({ from: 6, to: 3 });
    expect(new Set(meshes(root).map((m) => m.material))).toEqual(new Set([red, blue]));
  });

  it('leaves alone what is kept, what is used, and what is hidden, with everything in them', () => {
    const table = new THREE.Group().add(box(red), box(red, 1));
    const console = new THREE.Group().add(box(red), box(red, 1));
    console.userData.interaction = { kind: 'turbolift' };
    const hidden = box(red, 2);
    hidden.visible = false;
    const root = new THREE.Group().add(table, console, hidden, box(red, 3), box(red, 4));
    expect(mergeStatic(root, [table])).toEqual({ from: 2, to: 1 });
    expect(table.children).toHaveLength(2);
    expect(console.children).toHaveLength(2);
    expect(hidden.parent).toBe(root);
  });

  it('keeps a mirrored mesh facing outwards', () => {
    const mirrored = box(red);
    mirrored.scale.x = -1;
    const root = new THREE.Group().add(mirrored, box(red, 3));
    mergeStatic(root);
    const [merged] = meshes(root);
    // the box's first face looks along +X: in the merged mesh, mirrored, its triangles must face -X, outwards
    const p = merged.geometry.getAttribute('position');
    const index = merged.geometry.index!;
    const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, index.getX(k)));
    const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
    expect(normal.x).toBeCloseTo(-1, 6);
  });

  it('merges toon meshes that differ only in colour into one, each colour in its vertices', () => {
    const root = new THREE.Group();
    const red = new THREE.MeshToonMaterial({ color: 'red' });
    const blue = new THREE.MeshToonMaterial({ color: 'blue' });
    root.add(box(red), box(blue, 1, 0), box(red, 0, 1));
    expect(mergeStatic(root)).toEqual({ from: 3, to: 1 });
    const [mesh] = meshes(root);
    const material = mesh.material as THREE.MeshToonMaterial;
    expect(material.vertexColors).toBe(true);
    expect(material.color.getHex()).toBe(0xffffff);
    const colors = mesh.geometry.getAttribute('color');
    const seen = new Set<number>();
    for (let i = 0; i < colors.count; i++) seen.add(new THREE.Color(colors.getX(i), colors.getY(i), colors.getZ(i)).getHex());
    expect(seen).toEqual(new Set([red.color.getHex(), blue.color.getHex()]));
  });

  it('leaves toon materials that differ in more than colour apart', () => {
    const root = new THREE.Group();
    const plain = new THREE.MeshToonMaterial({ color: 'red' });
    const glowing = new THREE.MeshToonMaterial({ color: 'red', emissive: 'yellow' });
    root.add(box(plain), box(plain, 1, 0), box(glowing, 0, 1), box(glowing, 1, 1));
    expect(mergeStatic(root)).toEqual({ from: 4, to: 2 });
    expect(new Set(meshes(root).map((m) => m.material))).toContain(glowing);
  });
});
