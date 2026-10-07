import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { findGaps } from './gaps';

const box = (w: number, h: number, d: number, y: number, name = '', mat: THREE.Material = new THREE.MeshBasicMaterial()) => {
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

describe('findGaps', () => {
  it('reports a box hovering just above another, with the gap and where it is', () => {
    // the body's top at 0.5, the cap's underside at 0.51
    const gaps = findGaps(scene(box(1, 1, 1, 0, 'body'), box(0.5, 0.2, 0.5, 0.61, 'cap')));
    expect(gaps).toHaveLength(1);
    expect([gaps[0].a, gaps[0].b].sort()).toEqual(['body (BoxGeometry 1×1×1×1×1×1, #ffffff)', 'cap (BoxGeometry 0.5×0.2×0.5×1×1×1, #ffffff)']);
    expect(gaps[0].gap).toBeCloseTo(0.01);
    expect(gaps[0].area).toBeCloseTo(0.25);
    expect(gaps[0].at[1]).toBeCloseTo(0.505);
  });

  it('ignores boxes sitting on each other, or far enough apart to be separate things', () => {
    expect(findGaps(scene(box(1, 1, 1, 0), box(0.5, 0.2, 0.5, 0.6)))).toEqual([]);
    expect(findGaps(scene(box(1, 1, 1, 0), box(0.5, 0.2, 0.5, 0.7)))).toEqual([]);
  });

  it('ignores faces that face the same way, and faces that only meet at an edge', () => {
    // the cap sunk into the body: its top and the body's top both face up
    expect(findGaps(scene(box(1, 1, 1, 0), box(0.5, 0.2, 0.5, 0.49)))).toEqual([]);
    const beside = box(1, 1, 1, 0);
    beside.position.x = 1.01;
    beside.position.z = 1.01;
    expect(findGaps(scene(box(1, 1, 1, 0), beside))).toEqual([]);
  });

  it('ignores faces facing over less than about 50 cm², like a post standing beside a cushion', () => {
    const cap = box(0.5, 0.2, 0.5, 0.61);
    // only their corners overlap, 5 mm square
    cap.position.set(0.745, 0.61, 0.745);
    expect(findGaps(scene(box(1, 1, 1, 0), cap))).toEqual([]);
  });

  it('sees a double-sided plane hovering in front of a wall', () => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    plane.position.set(0, 1, 0.52);
    const gaps = findGaps(scene(box(1, 1, 1, 0.5), plane));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gap).toBeCloseTo(0.02);
  });

  it('ignores a single-sided plane facing away from the wall behind it, which shows no back to hover', () => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial());
    plane.position.set(0, 1, 0.52);
    expect(findGaps(scene(box(1, 1, 1, 0.5), plane))).toEqual([]);
  });

  it('ignores a gap tucked inside something else', () => {
    // a column topped 2 cm under a seat, both inside a shell that wraps them
    const shell = box(0.8, 0.3, 0.8, 0.5);
    expect(findGaps(scene(box(0.1, 0.4, 0.1, 0.3, 'column'), box(0.5, 0.06, 0.5, 0.55, 'seat'), shell))).toEqual([]);
  });

  it('ignores transparent faces, like a shadow under a chair', () => {
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.51;
    expect(findGaps(scene(box(1, 1, 1, 0), shadow))).toEqual([]);
  });

  it('ignores hidden meshes', () => {
    const cap = box(0.5, 0.2, 0.5, 0.61);
    cap.visible = false;
    expect(findGaps(scene(box(1, 1, 1, 0), cap))).toEqual([]);
  });
});
