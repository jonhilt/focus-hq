// Where the machines' screen hangs in a holodeck: round the wall left of the entrance as you come in, over the pull
// request rack, as big as the stellar cartography chart opposite. Nothing here draws, so it's tested without a browser.
import { around, facingIn, HALL_SCREEN } from '../../plugin-api/layout';

export const HALL_MACHINES = { angle: (-3 * Math.PI) / 4, width: 4.2, aspect: 1.6, bottom: 1.5, reach: 6 } as const;

/** The screen's middle in the hall's frame, and its turn about Y to face the hall's middle (a plane faces +Z). */
export function hallMachines(): { at: { x: number; y: number; z: number }; yaw: number } {
  const at = around(HALL_SCREEN.r, HALL_MACHINES.angle, HALL_MACHINES.bottom + HALL_MACHINES.width / HALL_MACHINES.aspect / 2);
  return { at: { x: at.x, y: at.y, z: at.z }, yaw: facingIn(HALL_MACHINES.angle) + Math.PI };
}
