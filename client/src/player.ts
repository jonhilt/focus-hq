import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { canMove, clearToward } from './collision';
import type { Box2 } from './world/layout';
import { EYE_HEIGHT } from './world/layout';

const RADIUS = 0.3;
const WALK = 4.2;
const RUN = 7.5;

/** First-person walking with WASD + mouse look, sliding along walls. */
export class Player {
  readonly controls: PointerLockControls;
  private keys = new Set<string>();
  private velocity = new THREE.Vector3();
  private bob = 0;
  enabled = true;
  colliders: Box2[] = [];

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    this.controls = new PointerLockControls(camera, dom);
    camera.position.set(0, EYE_HEIGHT, 8);
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get locked(): boolean {
    return this.controls.isLocked;
  }

  lock(): void {
    try {
      const result = this.controls.lock() as unknown;
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // pointer lock can be refused (e.g. right after an Esc); the user can click again
    }
  }

  unlock(): void {
    this.controls.unlock();
    this.keys.clear();
  }

  /** Puts the player somewhere, looking at a point. */
  teleport(feet: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.camera.position.set(feet.x, EYE_HEIGHT, feet.z);
    this.camera.lookAt(lookAt);
    this.velocity.set(0, 0, 0);
  }

  /**
   * Carries the player through a doorway to the other end (world/portal.ts): `through` moves where they stand, the way
   * they face and the way they're going all alike, so they walk on as if nothing happened. The far doorway's jambs
   * needn't block just where the near one's did (at an angle they're a chain of boxes that bulge into the opening), so
   * anyone who comes out against one is slid along the doorway towards its middle until they're clear: `doorway` is
   * the far one's frame (world).
   */
  transport(through: THREE.Matrix4, doorway: THREE.Matrix4): void {
    const turn = new THREE.Quaternion().setFromRotationMatrix(through);
    const pos = this.camera.position;
    const y = pos.y;
    pos.applyMatrix4(through).setY(y);
    this.camera.quaternion.premultiply(turn);
    this.velocity.applyQuaternion(turn);
    // to the point level with you on the doorway's centre line: across it, not out of it
    const across = new THREE.Vector3().setFromMatrixColumn(doorway, 0).setY(0).normalize();
    const off = pos.clone().sub(new THREE.Vector3().setFromMatrixPosition(doorway));
    const to = pos.clone().addScaledVector(across, -across.dot(off));
    const clear = clearToward(this.colliders, pos.x, pos.z, to.x, to.z, RADIUS);
    if (clear) pos.set(clear.x, y, clear.z);
  }

  update(dt: number): void {
    const active = this.enabled && this.controls.isLocked;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const wish = new THREE.Vector3();
    if (active) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) wish.add(forward);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) wish.sub(forward);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) wish.add(right);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) wish.sub(right);
    }
    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? RUN : WALK;
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    // smooth acceleration / friction
    this.velocity.lerp(wish, Math.min(1, dt * 12));

    const pos = this.camera.position;
    const step = this.velocity.clone().multiplyScalar(dt);
    // resolve each axis separately so the player slides along walls
    if (canMove(this.colliders, pos.x, pos.z, pos.x + step.x, pos.z, RADIUS)) pos.x += step.x;
    if (canMove(this.colliders, pos.x, pos.z, pos.x, pos.z + step.z, RADIUS)) pos.z += step.z;

    const moving = this.velocity.length();
    this.bob += dt * moving * 2.2;
    pos.y = EYE_HEIGHT + Math.sin(this.bob) * 0.035 * Math.min(1, moving / WALK);
  }
}
