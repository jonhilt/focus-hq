import type * as THREE from 'three';

/**
 * The parts of the ship that never see each other except through a doorway that's a portal (portal.ts): the command
 * deck, main engineering, the holodeck deck, the training halls (each reached through its holodeck's door on the deck)
 * and the goal viewing stations' briefing rooms; and their transporter rooms, which you only beam into. Decks
 * stand side by side in world space, briefing rooms and halls out beyond the holodecks and transporter rooms beyond
 * main engineering, so from any one of them every other would be drawn, hidden behind its walls; the World draws only
 * the one the camera's in (and of the transporter rooms, only the one it's in). A plugin's spaces (`ShipHost.space`)
 * stand furthest out of all, each a region of its own like a transporter room.
 */
export type Region = 'command' | 'engineering' | 'holodecks' | 'hall' | 'briefing' | 'transporter' | 'space';

/** Where the decks that stand on their own are, each a box round it. */
export interface DeckBoxes {
  command: THREE.Box3;
  engineering: THREE.Box3;
}

/**
 * Which region a world position is in: a deck's box, a briefing room, a training hall, a transporter room, a plugin's
 * space, or else the holodeck deck.
 */
export function regionAt(
  p: THREE.Vector3,
  decks: DeckBoxes,
  inBriefingRoom: (p: THREE.Vector3) => boolean,
  inHall: (p: THREE.Vector3) => boolean = () => false,
  inTransporterRoom: (p: THREE.Vector3) => boolean = () => false,
  inSpace: (p: THREE.Vector3) => boolean = () => false,
): Region {
  if (decks.command.containsPoint(p)) return 'command';
  if (decks.engineering.containsPoint(p)) return 'engineering';
  if (inBriefingRoom(p)) return 'briefing';
  if (inHall(p)) return 'hall';
  if (inTransporterRoom(p)) return 'transporter';
  if (inSpace(p)) return 'space';
  return 'holodecks';
}

/**
 * What's drawn from each region: its own part of the ship and nothing else, but for the briefing rooms, whose doors
 * stand in the holodecks and halls (each briefing room's hidden unless you're in it or its door's open).
 */
export function shown(region: Region | null): Record<Region, boolean> {
  if (!region) return { command: true, engineering: true, holodecks: true, hall: true, briefing: true, transporter: true, space: true };
  return {
    command: region === 'command',
    engineering: region === 'engineering',
    holodecks: region === 'holodecks',
    hall: region === 'hall',
    briefing: region !== 'command' && region !== 'engineering' && region !== 'transporter' && region !== 'space',
    transporter: region === 'transporter',
    space: region === 'space',
  };
}
