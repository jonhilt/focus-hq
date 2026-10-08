import * as THREE from 'three';
import { numberOne } from '../../../shared/crew';
import { state } from '../net/state';
import { interactive } from './builder';
import { Character } from './character';
import { contactShadow } from './contactShadow';
import { type Box2, type Seat, seatYaw } from './layout';
import { numberOneView } from './numberOneView';
import { chair } from './props';

/** Number One only reads their PADD while someone's near enough to see. */
const NEAR = 12;

/**
 * Number One in the ready room: in a visitor's chair, turned to the captain's chair. In world coordinates: whoever
 * seats them adds `group` to the scene and `footprint` to the colliders.
 */
export class FirstOfficer {
  readonly group = new THREE.Group();
  readonly footprint: Box2;
  private character: Character;

  /** `seat` faces the captain's chair, or a point on the way to it. */
  constructor(seat: Seat) {
    const g = this.group;
    g.position.copy(seat.at);
    g.rotation.y = seatYaw(seat);
    const visitor = chair('#7b2d43');
    g.add(visitor);
    // the ready room's floor has its occlusion baked in, but not under a chair built here (contactShadow.ts)
    const shadow = contactShadow(visitor, 'round');
    if (shadow) visitor.add(shadow);
    // there's no keyboard on the visitor's side of the desk: they read and tap a PADD
    this.character = new Character(numberOneView(state.numberOne), 'padd');
    g.add(this.character.group);
    const { x, z } = seat.at;
    this.footprint = { minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 };
    interactive(g, { kind: 'number-one' }, () => `Talk to ${numberOne().name}, your first officer`);
  }

  sync(): void {
    this.character.set(numberOneView(state.numberOne));
  }

  update(t: number, camera: THREE.Vector3): void {
    const dist = camera.distanceTo(this.character.group.getWorldPosition(tmp));
    if (dist > NEAR) return;
    this.character.update(t, dist);
  }

  dispose(): void {
    this.character.dispose();
  }
}

const tmp = new THREE.Vector3();
