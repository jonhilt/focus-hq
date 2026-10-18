import * as THREE from 'three';

/**
 * Whether an object in the scene is a mesh (skinned and instanced ones too). `o instanceof THREE.Mesh` alone narrows to
 * `Mesh<any, any>`, since TypeScript doesn't fill in a generic class's defaults there; this narrows to `THREE.Mesh`.
 */
export function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return o instanceof THREE.Mesh;
}
