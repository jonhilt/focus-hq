import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { findZFighting } from './zfight';

const box = (w: number, h: number, d: number, y: number, mat: THREE.Material = new THREE.MeshBasicMaterial(), name = '') => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.y = y;
  m.name = name;
  return m;
};

const scene = (...objs: THREE.Object3D[]) => {
  const s = new THREE.Scene();
  s.add(...objs);
  return s;
};

describe('findZFighting', () => {
  it('reports two meshes whose top faces share a plane, naming both and where they overlap', () => {
    const pairs = findZFighting(scene(box(1, 1, 1, 0, undefined, 'body'), box(0.5, 0.2, 0.5, 0.4, undefined, 'cap')));
    expect(pairs).toHaveLength(1);
    expect([pairs[0].a, pairs[0].b].sort()).toEqual(['body (BoxGeometry 1×1×1×1×1×1, #ffffff)', 'cap (BoxGeometry 0.5×0.2×0.5×1×1×1, #ffffff)']);
    expect(pairs[0].at[1]).toBeCloseTo(0.5);
    expect(pairs[0].area).toBeCloseTo(0.25);
  });

  it('names unnamed meshes by their path', () => {
    const g = new THREE.Group();
    g.name = 'padd';
    g.add(box(1, 1, 1, 0), box(0.5, 0.2, 0.5, 0.4));
    const pairs = findZFighting(scene(g));
    expect([pairs[0].a, pairs[0].b].sort()[0]).toMatch(/^padd > Mesh\[0\] /);
  });

  it('ignores faces at least the minimum gap apart', () => {
    expect(findZFighting(scene(box(1, 1, 1, 0), box(0.5, 0.2, 0.5, 0.403)))).toEqual([]);
  });

  it('ignores faces that touch back to back, or only meet at an edge', () => {
    expect(findZFighting(scene(box(1, 1, 1, 0), box(1, 1, 1, 1)))).toEqual([]);
    const side = box(1, 1, 1, 0);
    side.position.x = 1;
    expect(findZFighting(scene(box(1, 1, 1, 0), side))).toEqual([]);
  });

  it('does not compare faces within one mesh', () => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const twice = new THREE.BufferGeometry();
    const p = plane.toNonIndexed().getAttribute('position').array as Float32Array;
    const doubled = new Float32Array(p.length * 2);
    doubled.set(p);
    doubled.set(p, p.length);
    twice.setAttribute('position', new THREE.BufferAttribute(doubled, 3));
    expect(findZFighting(scene(new THREE.Mesh(twice, new THREE.MeshBasicMaterial())))).toEqual([]);
  });

  it('skips materials with polygonOffset, no depth test, or from a landscape kit, and hidden meshes', () => {
    const offset = new THREE.MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: -1 });
    const noDepth = new THREE.MeshBasicMaterial({ depthTest: false });
    const landscape = new THREE.MeshBasicMaterial();
    landscape.userData.landscape = true;
    for (const mat of [offset, noDepth, landscape]) expect(findZFighting(scene(box(1, 1, 1, 0), box(0.5, 0.2, 0.5, 0.4, mat)))).toEqual([]);
    const hidden = box(0.5, 0.2, 0.5, 0.4);
    hidden.visible = false;
    expect(findZFighting(scene(box(1, 1, 1, 0), hidden))).toEqual([]);
  });

  it('ignores pairs that draw the same pixels: one untextured material on both', () => {
    const mat = new THREE.MeshBasicMaterial();
    expect(findZFighting(scene(box(1, 1, 1, 0, mat), box(0.5, 0.2, 0.5, 0.4, mat)))).toEqual([]);
    const textured = new THREE.MeshBasicMaterial({ map: new THREE.Texture() });
    expect(findZFighting(scene(box(1, 1, 1, 0, textured), box(0.5, 0.2, 0.5, 0.4, textured)))).toHaveLength(1);
  });

  it('ignores undersides on the floor and tops at the ceiling, which the camera is always behind', () => {
    expect(findZFighting(scene(box(1, 1, 1, 0.5), box(0.5, 0.2, 0.5, 0.1)))).toEqual([]);
    expect(findZFighting(scene(box(1, 1, 1, 2.7), box(0.5, 0.2, 0.5, 3.1)))).toEqual([]);
  });

  it('ignores overlaps pressed flat against a third solid', () => {
    // a dado and its wall end in one plane at both ends, each end buried in a door frame
    const wall = box(1, 1, 1, 0);
    const dado = box(1, 0.4, 1.2, -0.2);
    const frames = [-1, 1].map((x) => {
      const frame = box(1, 2, 1, 0);
      frame.position.x = x;
      return frame;
    });
    expect(findZFighting(scene(wall, dado))).toHaveLength(1);
    expect(findZFighting(scene(wall, dado, ...frames))).toEqual([]);
  });
});
