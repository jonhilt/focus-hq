import type * as THREE from 'three';

/**
 * The parts of the ship that never see each other except through a team station's door (portal.ts): the command
 * deck, the holodeck deck, and the team stations' briefing rooms. Decks stand side by side in world space and briefing
 * rooms out beyond the holodecks, so from any one of them every other would be drawn, hidden behind its walls; the
 * World draws only the one the camera's in.
 */
export type Region = 'command' | 'holodecks' | 'briefing';

/** Which region a world position is in: the command deck's box, a briefing room, or else the holodeck deck. */
export function regionAt(p: THREE.Vector3, command: THREE.Box3, inBriefingRoom: (p: THREE.Vector3) => boolean): Region {
  if (command.containsPoint(p)) return 'command';
  if (inBriefingRoom(p)) return 'briefing';
  return 'holodecks';
}

/** What's drawn from each region: its own part of the ship and nothing else. */
export function shown(region: Region | null): Record<Region, boolean> {
  if (!region) return { command: true, holodecks: true, briefing: true };
  return { command: region === 'command', holodecks: region === 'holodecks', briefing: region !== 'command' };
}
