// The captain's chairs: where your eyes are sat in one, and what each is for (main.ts sits you down and stands you up).

import * as THREE from 'three';
import type { ManagerTab } from '../ui/context';
import type { Chair } from './deckExtras';
import type { Seat } from './layout';

/** How high your eyes are, sat in one of the captain's chairs. */
export const SEATED_EYE = 1.2;

/** Where your eyes are sat in a chair, looking level the way it faces. */
export function seatedView({ at, facing }: Seat): { eye: THREE.Vector3; lookAt: THREE.Vector3 } {
  const ahead = facing.clone().sub(at).setY(0).normalize();
  const eye = new THREE.Vector3(at.x, at.y + SEATED_EYE, at.z);
  return { eye, lookAt: eye.clone().add(ahead) };
}

/** What a chair puts to hand, opened with E while you're sat in it: what needs you, the ready room's console, your ideas. */
export type ChairUse = { kind: 'comms' } | { kind: 'manager'; tab?: ManagerTab };

export const CHAIR_USE: Record<Chair, { use: ChairUse; label: string }> = {
  bridge: { use: { kind: 'comms' }, label: 'What needs you' },
  'ready-room': { use: { kind: 'manager' }, label: 'Use the ready room console' },
  lounge: { use: { kind: 'manager', tab: 'personal-log' }, label: 'Your personal log' },
};

/** Whether a movement key stands you up out of a chair. */
export const STAND_KEYS: ReadonlySet<string> = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

/**
 * The chair whose use E puts to hand: the one you're sat in, unless the crosshair's on something else to use (one of
 * the chair's own parts, which you're sat among, doesn't count).
 */
export function chairInHand(seatedIn: Chair | null, aimed: { kind: string } | null): Chair | null {
  return seatedIn && (!aimed || aimed.kind === 'sit') ? seatedIn : null;
}
