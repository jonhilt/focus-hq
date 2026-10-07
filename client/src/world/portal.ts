import * as THREE from 'three';
import type { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { clipNear, inDoorway, throughDoor } from './doorway';
import { noOutline } from './materials';
import { SlidingDoors } from './starship';

// A pair of doorways that lead into each other, wherever in the world they stand: a team station's door in a holodeck
// and the briefing room through it, which stands far off and is far bigger than the holodeck could hold. While the
// doors are open, the alcove behind the one you're looking at shows the other end, drawn from where you'd be if you
// stood that far from the other doorway (and turned the same way to it), into a texture the alcove samples wherever
// it lands on the screen. Step over the threshold and you're moved to that spot, facing that way, so what you see
// doesn't change: only where you are.

/** One end: a doorway's centre on the floor, in the middle of its wall, facing out into its room along forward (-Z). */
export interface Doorway {
  /** The doorway's frame, in world space. */
  matrix: THREE.Matrix4;
  width: number;
  height: number;
  /** How deep the alcove behind it is. */
  depth: number;
}

/** What every alcove is drawn with: the other end's picture, sampled where the alcove lands on the screen. */
const surface = new THREE.ShaderMaterial({
  uniforms: { map: { value: null }, size: { value: new THREE.Vector2(1, 1) } },
  vertexShader: /* glsl */ `
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform vec2 size;
    void main() {
      gl_FragColor = texture2D(map, gl_FragCoord.xy / size);
      #include <colorspace_fragment>
    }`,
  side: THREE.DoubleSide,
});
noOutline(surface);

/**
 * The inside of the alcove behind a doorway, in its frame: just inside the frame's jambs and under the doors' tops,
 * clear of the floor and of the alcove's back wall, so it never shares a plane with them. It's open at the front, so
 * it can't be clipped away as you step through: from in front, every way through the doorway ends on one of its faces.
 */
function alcove({ width, height, depth }: Doorway): THREE.BufferGeometry {
  const w = width - 0.008;
  const h = height - 0.014;
  const deep = depth - 0.05;
  const g = new THREE.BoxGeometry(w, h, deep).translate(0, 0.01 + h / 2, deep / 2);
  // BoxGeometry's faces come +x, -x, +y, -y, +z, -z, two triangles each: the last is the one across the doorway
  g.setIndex(Array.from(g.getIndex()!.array.slice(0, 30)));
  g.clearGroups();
  return g;
}

export interface PortalEnd {
  doorway: Doorway;
  /** Its doors and its alcove, in world space. */
  group: THREE.Group;
  /** World space to the doorway's frame. */
  inverse: THREE.Matrix4;
  /** From this end's side of the world to the other end's: through this doorway and out of the other. */
  through: THREE.Matrix4;
  doors: SlidingDoors;
  /** The alcove behind the doorway, showing the other end while you look through the open doors. */
  view: THREE.Mesh;
  other: PortalEnd;
}

const tmp = new THREE.Vector3();

/** Two doorways, each opening onto the other, their doors sliding together as if one. Built in world space. */
export class Portal {
  readonly ends: [PortalEnd, PortalEnd];

  constructor(a: Doorway, b: Doorway) {
    const end = (d: Doorway, to: Doorway): PortalEnd => {
      const at = new THREE.Vector3().setFromMatrixPosition(d.matrix);
      const along = new THREE.Vector3().setFromMatrixColumn(d.matrix, 0);
      const doors = new SlidingDoors(at, Math.atan2(-along.z, along.x), d.width, d.height);
      const view = new THREE.Mesh(alcove(d), surface);
      view.matrixAutoUpdate = false;
      view.matrix.copy(d.matrix);
      view.matrixWorldNeedsUpdate = true;
      view.visible = false;
      // you can't use what's at the other end from here: look straight through to what's behind
      view.raycast = () => {};
      const group = new THREE.Group().add(doors.group, view);
      return { doorway: d, group, inverse: d.matrix.clone().invert(), through: throughDoor(d.matrix, to.matrix), doors, view, other: undefined! };
    };
    const ea = end(a, b);
    const eb = end(b, a);
    ea.other = eb;
    eb.other = ea;
    this.ends = [ea, eb];
  }

  /** Whether the doors are open at all, so you might see through. */
  get ajar(): boolean {
    return this.ends[0].doors.ajar;
  }

  /** Opens both pairs of doors as you near either, the nearer making the sound. */
  update(eye: THREE.Vector3, dt: number): void {
    const [a, b] = this.ends.map((e) => Math.hypot(eye.x - e.doorway.matrix.elements[12], eye.z - e.doorway.matrix.elements[14]));
    const [near, far] = a <= b ? this.ends : [this.ends[1], this.ends[0]];
    near.doors.sense(Math.min(a, b), dt);
    far.doors.sense(Math.min(a, b), dt, true);
  }

  /** Where stepping through takes you, if `eye` has just stepped into either doorway. */
  crossing(eye: THREE.Vector3): THREE.Matrix4 | null {
    for (const end of this.ends) {
      if (inDoorway(tmp.copy(eye).applyMatrix4(end.inverse), end.doorway.width, end.doorway.depth)) return end.through;
    }
    return null;
  }
}

/** How near an open doorway must be to draw what's through it: the doors only open when you're closer still. */
const VIEW_RANGE = 12;
/** How much further than the camera's the far plane is for the other end, so tilting it (clipNear) cuts nothing off. */
const FAR = 100;
/**
 * How far behind the other doorway the camera must be to clip at it. Any nearer and its tilted near plane leaves so
 * little depth that screens and windows lose to the walls they hang on; but nearer than that there's nothing in the
 * way to clip, only the back of the doorway's frame, which the frame you're looking through hides.
 */
const CLIP_FROM = 0.3;

/**
 * Draws the other end of the open doorway you're looking at, each frame before the scene, for its alcove to show:
 * the whole scene again, from the camera carried through the doorway, with nothing behind the other doorway drawn.
 */
export class PortalView {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly frustum = new THREE.Frustum();
  private readonly size = new THREE.Vector2();
  private readonly m = new THREE.Matrix4();
  private readonly plane = new THREE.Plane();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly effect: OutlineEffect,
  ) {
    renderer.getDrawingBufferSize(this.size);
    // as the screen is: multisampled, with a stencil for holodeck landscapes, and half floats for the linear colours
    // it holds until the alcove draws them to the screen
    this.target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true });
    surface.uniforms.map.value = this.target.texture;
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, portals: Portal[]): void {
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let shown: PortalEnd | undefined;
    let nearest = VIEW_RANGE;
    for (const portal of portals) {
      for (const end of portal.ends) {
        // every alcove stays hidden while the other end is drawn, or one might sample the picture it's drawn into
        end.view.visible = false;
        if (!end.doors.ajar) continue;
        const local = tmp.copy(camera.position).applyMatrix4(end.inverse);
        const d = local.length();
        // from behind the doorway there's nothing to see through it
        if (local.z >= 0 || d >= nearest || !this.frustum.intersectsObject(end.view)) continue;
        shown = end;
        nearest = d;
      }
    }
    if (!shown) return;

    const v = this.camera;
    v.matrixWorld.multiplyMatrices(shown.through, camera.matrixWorld);
    v.matrixWorldInverse.copy(v.matrixWorld).invert();
    v.fov = camera.fov;
    v.aspect = camera.aspect;
    v.near = camera.near;
    v.far = camera.far * FAR;
    v.updateProjectionMatrix();
    // the other doorway, facing out into its room: everything between it and the carried camera is in the way
    const far = shown.other.doorway.matrix;
    this.plane.setFromNormalAndCoplanarPoint(tmp.setFromMatrixColumn(far, 2).negate().normalize(), new THREE.Vector3().setFromMatrixPosition(far));
    this.plane.applyMatrix4(v.matrixWorldInverse);
    if (-this.plane.constant > CLIP_FROM) clipNear(v.projectionMatrix, this.plane);
    v.projectionMatrixInverse.copy(v.projectionMatrix).invert();

    this.renderer.getDrawingBufferSize(this.size);
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);
    surface.uniforms.size.value.copy(this.size);
    this.renderer.setRenderTarget(this.target);
    this.effect.render(scene, v);
    this.renderer.setRenderTarget(null);
    shown.view.visible = true;
  }
}
