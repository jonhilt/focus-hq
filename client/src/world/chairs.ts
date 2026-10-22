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

/** The chairs' names in the teleport panel, which beams you straight into one. */
export const CHAIR_LABEL: Record<Chair, string> = {
  bridge: '💺 Captain’s chair',
  'ready-room': '💺 Ready room desk',
  lounge: '💺 Head of the lounge table',
};

/** Where you get up to from a chair you beamed into: the nearest of the places on its deck (its room's). */
export function standingSpot(seat: Seat, places: readonly THREE.Vector3[]): THREE.Vector3 | undefined {
  let best: THREE.Vector3 | undefined;
  for (const p of places) if (!best || p.distanceToSquared(seat.at) < best.distanceToSquared(seat.at)) best = p;
  return best;
}

/**
 * What the core puts to hand in a chair, opened with E while you're sat in it: the ready room's console, your personal
 * log. The bridge's is a plugin's to fill (`ClientPlugin.chair`), or nothing.
 */
export const CHAIR_USE: Partial<Record<Chair, { tab?: ManagerTab; label: string }>> = {
  'ready-room': { label: 'Use the ready room console' },
  lounge: { tab: 'personal-log', label: 'Your personal log' },
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
