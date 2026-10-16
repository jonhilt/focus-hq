// Number One in the ready room (README.md): the plugin's part of the ship, in the visitor's chair at the captain's desk.
import * as THREE from 'three';
import { chatNow, NUMBER_ONE, numberOne, type NumberOneState } from './shared';
import { numberOneView } from './view';
import { chair, Character, contactShadow, onPluginState, pluginState, type Seat, seatYaw, type ShipHost, type ShipPart, type Ui } from '../../plugin-api/client';

/** Number One only reads their PADD while someone's near enough to see. */
const NEAR = 12;

const chat = () => chatNow(pluginState<NumberOneState>(NUMBER_ONE));

/**
 * Number One in the ready room's visitor chair, turned to the captain's chair, reading a PADD: pressing E on them opens
 * the chat (`talk`). Nothing when the deck has no seat for a guest.
 */
export function seatNumberOne(host: ShipHost, talk: (ui: Ui) => void): ShipPart | null {
  const seat = host.seat('command', 'ready-room-guest');
  return seat ? new FirstOfficer(host, seat, talk) : null;
}

class FirstOfficer implements ShipPart {
  private readonly character: Character;
  private readonly unsubscribe: () => void;

  /** `seat` faces the captain's chair, or a point on the way to it. */
  constructor(host: ShipHost, seat: Seat, talk: (ui: Ui) => void) {
    const g = new THREE.Group();
    g.position.copy(seat.at);
    g.rotation.y = seatYaw(seat);
    const visitor = chair('#7b2d43');
    g.add(visitor);
    // the ready room's floor has its occlusion baked in, but not under a chair built here (contactShadow.ts)
    const shadow = contactShadow(visitor, 'round');
    if (shadow) visitor.add(shadow);
    // there's no keyboard on the visitor's side of the desk: they read and tap a PADD
    this.character = new Character(numberOneView(chat()), 'padd');
    g.add(this.character.group);
    const { x, z } = seat.at;
    host.collide({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 });
    host.interactive(g, () => `Talk to ${numberOne().name}, your first officer`, talk);
    // in the ready room: drawn with the command deck
    host.mount('command', g);
    this.unsubscribe = onPluginState(NUMBER_ONE, () => this.character.set(numberOneView(chat())));
  }

  update(t: number, camera: THREE.Vector3): void {
    const dist = camera.distanceTo(this.character.group.getWorldPosition(tmp));
    if (dist > NEAR) return;
    this.character.update(t, dist);
  }

  dispose(): void {
    this.unsubscribe();
    this.character.dispose();
  }
}

const tmp = new THREE.Vector3();
