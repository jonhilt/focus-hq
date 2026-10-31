import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boundsOf } from './boundsOf';
import { isMesh } from './isMesh';

// Contact shadows: the soft shading on the floor round where something stands on it, which keeps furniture built in
// code looking like it stands on the floor rather than floats over it. The decks have theirs baked in Blender
// (blender/bake.py); what's built here gets a soft patch on the floor under it, the shape of its footprint, fading
// out a hand's width round it. Cheap: no screen-space pass, and a room's patches are one mesh, one draw call.

/** Metres: how far past an object's footprint its shadow fades out. */
const SPREAD = 0.35;
/** How dark a shadow is at its darkest, under the object. */
const STRENGTH = 0.32;
/** Metres above the floor: clear of a holodeck room's carpet (0.005) and stripe (0.01). */
const LIFT = 0.016;
/** Metres: only what's lower than this stands on the floor and shades it (not signs or screens up on a stand). */
const LOW = 1.0;

/**
 * Draws each patch from where on it a fragment is, in metres from its object's centre (`spot`), and its footprint's
 * half size and corner radius (`foot`): dark under the footprint, fading out SPREAD past its edge.
 */
const material = new THREE.ShaderMaterial({
  uniforms: { spread: { value: SPREAD }, strength: { value: STRENGTH } },
  vertexShader: /* glsl */ `
    attribute vec2 spot;
    attribute vec3 foot;
    varying vec2 vSpot;
    varying vec3 vFoot;
    void main() {
      vSpot = spot;
      vFoot = foot;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float spread;
    uniform float strength;
    varying vec2 vSpot;
    varying vec3 vFoot;
    void main() {
      // how far outside the footprint, a rectangle with rounded corners
      vec2 q = abs(vSpot) - vFoot.xy + vFoot.z;
      float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - vFoot.z;
      float fade = 1.0 - clamp(d / spread, 0.0, 1.0);
      gl_FragColor = vec4(0.0, 0.0, 0.0, strength * fade * fade);
      #include <colorspace_fragment>
    }`,
  transparent: true,
  depthWrite: false,
});

/** The footprint of what in `object` stands low enough to shade the floor, in its own frame: x and z, min and max. */
export function footprintOf(object: THREE.Object3D): THREE.Box3 | null {
  object.updateWorldMatrix(true, true);
  const toObject = object.matrixWorld.clone().invert();
  const m = new THREE.Matrix4();
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  object.traverse((o) => {
    if (!isMesh(o) || !o.visible) return;
    const mesh = o;
    part.copy(boundsOf(mesh.geometry)).applyMatrix4(m.multiplyMatrices(toObject, mesh.matrixWorld));
    if (part.min.y < LOW) box.union(part);
  });
  return box.isEmpty() ? null : box;
}

/**
 * Collects the contact shadows of what stands in `root` (a room, say), to draw them as one mesh in its frame. Add
 * each thing once it's built and in place, before anyone sits in it: a character would stretch its footprint.
 */
export class ContactShadows {
  private readonly parts: THREE.BufferGeometry[] = [];

  constructor(private readonly root: THREE.Object3D) {}

  /** Shades the floor under `object`: round (a chair, a plant pot, a round table) or a rectangle with soft corners. */
  add(object: THREE.Object3D, shape: 'round' | 'square' = 'square'): void {
    const foot = footprintOf(object);
    if (!foot) return;
    this.root.updateWorldMatrix(true, false);
    const toRoot = this.root.matrixWorld.clone().invert().multiply(object.matrixWorld);
    const turn = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    toRoot.decompose(new THREE.Vector3(), turn, scale);
    const hx = ((foot.max.x - foot.min.x) / 2) * scale.x;
    const hz = ((foot.max.z - foot.min.z) / 2) * scale.z;
    const corner = shape === 'round' ? Math.min(hx, hz) : Math.min(0.08, hx, hz);
    const w = hx + SPREAD;
    const d = hz + SPREAD;
    const g = new THREE.PlaneGeometry(2 * w, 2 * d).rotateX(-Math.PI / 2);
    const spot = new Float32Array(g.attributes.position.count * 2);
    const footAttr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      spot.set([g.attributes.position.getX(i), g.attributes.position.getZ(i)], i * 2);
      footAttr.set([hx, hz, corner], i * 3);
    }
    g.setAttribute('spot', new THREE.BufferAttribute(spot, 2));
    g.setAttribute('foot', new THREE.BufferAttribute(footAttr, 3));
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    // centred under the footprint, turned with the object, on the floor of the root's frame
    const centre = new THREE.Vector3((foot.min.x + foot.max.x) / 2, 0, (foot.min.z + foot.max.z) / 2).applyMatrix4(toRoot);
    g.applyQuaternion(turn);
    g.translate(centre.x, LIFT, centre.z);
    this.parts.push(g);
  }

  /** The shadows collected, as one mesh to add to the root; null if there are none. */
  build(): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts);
    for (const g of this.parts) g.dispose();
    this.parts.length = 0;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'contact shadows';
    // after the floors, before anything else see-through, so a sign or bubble isn't shaded by them
    mesh.renderOrder = -1;
    // the floor's, not something to pick
    mesh.raycast = () => {};
    return mesh;
  }
}

/** Shades the floor under `object` alone, as a mesh of its own in its frame. */
export function contactShadow(object: THREE.Object3D, shape: 'round' | 'square' = 'square'): THREE.Mesh | null {
  const shadows = new ContactShadows(object);
  shadows.add(object, shape);
  return shadows.build();
}
