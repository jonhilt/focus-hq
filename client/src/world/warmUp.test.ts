import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { texturesIn } from './warmUp';

describe('texturesIn', () => {
  it("finds the textures of meshes, points and sprites alike, a shader's uniforms included", () => {
    const [onMesh, inUniform, onPoints, onSprite] = [1, 2, 3, 4].map(() => new THREE.Texture());
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshBasicMaterial({ map: onMesh }), new THREE.ShaderMaterial({ uniforms: { tex: { value: inUniform } } })]),
      new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ map: onPoints })),
      new THREE.Sprite(new THREE.SpriteMaterial({ map: onSprite })),
      new THREE.Group(),
    );
    expect(texturesIn(root)).toEqual(new Set([onMesh, inUniform, onPoints, onSprite]));
  });
});
