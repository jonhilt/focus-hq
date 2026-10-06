import * as THREE from 'three';
import { numberOne } from '../../../shared/crew';
import { state } from '../net/state';
import { type Builder, interactive } from './builder';
import { Character } from './character';
import { OFFICE } from './layout';
import { numberOneView } from './numberOneView';
import { chair } from './props';

/**
 * Number One in the ready room: in a visitor's chair at the corner of the captain's desk, turned to the captain's
 * chair, off to the side so the way in and the desk's console and inbox stay clear. Built in world coordinates.
 */
export class FirstOfficer {
  private character: Character;

  /** `seat` is where the visitor's chair stands, `captain` the captain's chair they turn to. */
  constructor(b: Builder, seat: THREE.Vector3, captain: THREE.Vector3) {
    const g = new THREE.Group();
    g.position.copy(seat);
    // chairs and characters face +X: turn them to the captain
    g.rotation.y = Math.atan2(-(captain.z - seat.z), captain.x - seat.x);
    g.add(chair('#7b2d43'));
    // there's no keyboard on the visitor's side of the desk: they read and tap a PADD
    this.character = new Character(numberOneView(state.numberOne), 'padd');
    g.add(this.character.group);
    b.add(g);
    b.collide(seat.x - 0.4, seat.x + 0.4, seat.z - 0.4, seat.z + 0.4);
    interactive(g, { kind: 'number-one' }, () => `Talk to ${numberOne().name}, your first officer`);
  }

  sync(): void {
    this.character.set(numberOneView(state.numberOne));
  }

  update(t: number, camera: THREE.Vector3): void {
    if (camera.z < OFFICE.z0) return;
    this.character.update(t, camera.distanceTo(this.character.group.getWorldPosition(tmp)));
  }

  dispose(): void {
    this.character.dispose();
  }
}

const tmp = new THREE.Vector3();
