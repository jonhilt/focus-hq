import type * as THREE from 'three';

/**
 * The parts of the ship that never see each other except through a doorway that's a portal (portal.ts): the command
 * deck, the holodeck deck, the training halls (each reached through its holodeck's door on the deck) and the team
 * stations' briefing rooms. Decks stand side by side in world space, and briefing rooms and halls out beyond the
 * holodecks, so from any one of them every other would be drawn, hidden behind its walls; the World draws only the one
 * the camera's in.
 */
export type Region = 'command' | 'holodecks' | 'hall' | 'briefing';

/** Which region a world position is in: the command deck's box, a briefing room, a training hall, or else the holodeck deck. */
export function regionAt(p: THREE.Vector3, command: THREE.Box3, inBriefingRoom: (p: THREE.Vector3) => boolean, inHall: (p: THREE.Vector3) => boolean = () => false): Region {
  if (command.containsPoint(p)) return 'command';
  if (inBriefingRoom(p)) return 'briefing';
  if (inHall(p)) return 'hall';
  return 'holodecks';
}

/**
 * What's drawn from each region: its own part of the ship and nothing else, but for the briefing rooms, whose doors
 * stand in the holodecks and halls (each briefing room's hidden unless you're in it or its door's open).
 */
export function shown(region: Region | null): Record<Region, boolean> {
  if (!region) return { command: true, holodecks: true, hall: true, briefing: true };
  return { command: region === 'command', holodecks: region === 'holodecks', hall: region === 'hall', briefing: region !== 'command' };
}
