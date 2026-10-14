import type * as THREE from 'three';

/**
 * The parts of the ship that never see each other except through a doorway that's a portal (portal.ts): the command
 * deck, main engineering, the holodeck deck, the training halls (each reached through its holodeck's door on the deck)
 * and the team stations' briefing rooms; and the team stations' transporter rooms, which you only beam into. Decks
 * stand side by side in world space, briefing rooms and halls out beyond the holodecks and transporter rooms beyond
 * main engineering, so from any one of them every other would be drawn, hidden behind its walls; the World draws only
 * the one the camera's in (and of the transporter rooms, only the one it's in). Stellar cartography stands beyond main
 * engineering, a deck of its own.
 */
export type Region = 'command' | 'engineering' | 'cartography' | 'holodecks' | 'hall' | 'briefing' | 'transporter';

/** Where the decks that stand on their own are, each a box round it. */
export interface DeckBoxes {
  command: THREE.Box3;
  engineering: THREE.Box3;
  cartography: THREE.Box3;
}

/**
 * Which region a world position is in: a deck's box, a briefing room, a training hall, a transporter room, or else
 * the holodeck deck.
 */
export function regionAt(
  p: THREE.Vector3,
  decks: DeckBoxes,
  inBriefingRoom: (p: THREE.Vector3) => boolean,
  inHall: (p: THREE.Vector3) => boolean = () => false,
  inTransporterRoom: (p: THREE.Vector3) => boolean = () => false,
): Region {
  if (decks.command.containsPoint(p)) return 'command';
  if (decks.engineering.containsPoint(p)) return 'engineering';
  if (decks.cartography.containsPoint(p)) return 'cartography';
  if (inBriefingRoom(p)) return 'briefing';
  if (inHall(p)) return 'hall';
  if (inTransporterRoom(p)) return 'transporter';
  return 'holodecks';
}

/**
 * What's drawn from each region: its own part of the ship and nothing else, but for the briefing rooms, whose doors
 * stand in the holodecks and halls (each briefing room's hidden unless you're in it or its door's open).
 */
export function shown(region: Region | null): Record<Region, boolean> {
  if (!region) return { command: true, engineering: true, cartography: true, holodecks: true, hall: true, briefing: true, transporter: true };
  return {
    command: region === 'command',
    engineering: region === 'engineering',
    cartography: region === 'cartography',
    holodecks: region === 'holodecks',
    hall: region === 'hall',
    briefing: region === 'holodecks' || region === 'hall' || region === 'briefing',
    transporter: region === 'transporter',
  };
}
