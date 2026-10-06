import * as THREE from 'three';
import { numberOne } from '../../../shared/crew';
import { state } from '../net/state';
import { interactive } from './builder';
import { Character } from './character';
import type { Box2 } from './layout';
import { numberOneView } from './numberOneView';
import { chair } from './props';

/** Number One only reads their PADD while someone's near enough to see. */
const NEAR = 12;

/** Where Number One's chair stands, and a point they turn to face: the captain's chair, or on the way to it. */
export interface Seat {
  at: THREE.Vector3;
  facing: THREE.Vector3;
}

/**
 * Number One in the ready room: in a visitor's chair, turned to the captain's chair. In world coordinates: whoever
 * seats them adds `group` to the scene and `footprint` to the colliders.
 */
export class FirstOfficer {
  readonly group = new THREE.Group();
  readonly footprint: Box2;
  private character: Character;

  constructor({ at: seat, facing }: Seat) {
    const g = this.group;
    g.position.copy(seat);
    // chairs and characters face +X: turn them to the captain
    g.rotation.y = Math.atan2(-(facing.z - seat.z), facing.x - seat.x);
    g.add(chair('#7b2d43'));
    // there's no keyboard on the visitor's side of the desk: they read and tap a PADD
    this.character = new Character(numberOneView(state.numberOne), 'padd');
    g.add(this.character.group);
    this.footprint = { minX: seat.x - 0.4, maxX: seat.x + 0.4, minZ: seat.z - 0.4, maxZ: seat.z + 0.4 };
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
