import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { isMesh } from './isMesh';

describe('isMesh', () => {
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();

  it('takes meshes, skinned and instanced ones included', () => {
    expect(isMesh(new THREE.Mesh(geometry, material))).toBe(true);
    expect(isMesh(new THREE.SkinnedMesh(geometry, material))).toBe(true);
    expect(isMesh(new THREE.InstancedMesh(geometry, material, 2))).toBe(true);
  });

  it('leaves out what else a scene holds, drawn or not', () => {
    expect(isMesh(new THREE.Group())).toBe(false);
    expect(isMesh(new THREE.Object3D())).toBe(false);
    expect(isMesh(new THREE.Points(geometry, new THREE.PointsMaterial()))).toBe(false);
    expect(isMesh(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial()))).toBe(false);
    expect(isMesh(new THREE.Sprite(new THREE.SpriteMaterial()))).toBe(false);
  });
});
