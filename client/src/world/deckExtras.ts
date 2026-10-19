// What blender/kit.py writes into a deck's glTF extras (its objects' and materials' custom properties), read once as
// the deck loads. A deck that doesn't match is a bug in the Blender script, so it fails loudly rather than guessing.

import { isOneOf } from '../../../shared/records';
import type { Interaction } from './builder';
import type { CorePart } from './warpCore';

type Extras = Record<string, unknown>;

/** A marker in a deck: an empty the browser reads rather than draws. */
export type Marker =
  /** An empty cube: an axis-aligned box the player can't walk into. */
  | { kind: 'collider' }
  /** Sliding doors at a doorway's centre, sliding along the empty's X. */
  | { kind: 'door'; width: number; height: number }
  /** A teleport destination, looking along the empty's forward. */
  | { kind: 'place'; label: string }
  /** An empty cube: the floor it covers, named in the HUD. */
  | { kind: 'area'; label: string }
  /** Where a crew member's chair stands, turned along the empty's forward. */
  | { kind: 'seat'; crew: Crew }
  /** Where a turbolift stops: you stand here in its car, facing along the empty's forward (its doors). */
  | { kind: 'turbolift'; label: string }
  /**
   * A doorway to somewhere else (world/portal.ts), at its centre in the middle of its wall, the way in along the empty's
   * forward, with an alcove `depth` deep behind it.
   */
  | { kind: 'portal'; width: number; height: number; depth: number }
  /**
   * A transporter pad in a transporter room, at the middle of its top, where whoever beams in stands facing along the
   * empty's forward: its `tier`, 0 at the front to 2 at the back, and its `slot` along the tier, 0 at the door's end
   * to 5.
   */
  | { kind: 'pad'; tier: number; slot: number }
  /** Where the camera for a transporter room's feed stands, looking along the empty's forward, its vertical `fov` (degrees). */
  | { kind: 'camera'; fov: number };

/** The helpers' seats in a team station's briefing room, in the order helpers take them. */
export const HELPER_SEATS = ['station-helper-1', 'station-helper-2', 'station-helper-3', 'station-helper-4'] as const;

/**
 * Crew a model seats: a guest in the ready room's visitor chair (a plugin's, when one sits there), the chief engineer at
 * the engineering station, and in a team station's briefing room its lead, their helpers and the goal's reviewer.
 */
const CREW = ['ready-room-guest', 'engineer', 'station-lead', ...HELPER_SEATS, 'station-reviewer'] as const;
export type Crew = (typeof CREW)[number];
const isCrew = (v: unknown): v is Crew => isOneOf(CREW, v);

/**
 * A screen the browser keeps drawing on: mission control is the World's dashboard, the MSD main engineering's cutaway
 * of the ship; a team station shows its lead's
 * session, its name, goal and whether it's in session on its sign, the lead's note on the goal on its goal board,
 * the goal's star chart (stellar cartography) on the other side of it, the viewer's pane switches beside its screen, and the feeds from its transporter rooms (each picture and its caption
 * numbered by its `feed`) under a strip saying how many workflows wait for one; a transporter room shows the workflow it's running on its tactical
 * display, and who's still waiting to beam in on its pattern buffer's readout.
 */
const SCREENS = [
  'mission-control',
  'msd',
  'team-station',
  'team-station-sign',
  'team-station-note',
  'team-station-chart',
  'team-station-panes',
  'team-station-feed',
  'team-station-feed-caption',
  'team-station-feeds',
  'transporter-tactical',
  'transporter-buffer',
  'transporter-script',
] as const;
export type ScreenName = (typeof SCREENS)[number];
/** The screens a deck has, which the World draws. */
export type DeckScreen = Extract<ScreenName, 'mission-control' | 'msd'>;
const DECK_SCREENS: readonly ScreenName[] = ['mission-control', 'msd'];
export const isDeckScreen = (v: ScreenName): v is DeckScreen => DECK_SCREENS.includes(v);
const isScreen = (v: unknown): v is ScreenName => isOneOf(SCREENS, v);

/**
 * A part of a module the browser finds and changes as it goes, so it's kept out of merging: a transporter pad's lit
 * ring (in the colour of whoever's on it) and the glow of the emitter over it, and the pattern buffer's glowing columns.
 */
export type Part = { kind: 'pad-ring' | 'pad-emitter'; tier: number; slot: number } | { kind: 'buffer-glow' };

/** How a deck's surface is drawn. */
export type Surface =
  | { kind: 'toon' }
  /** Its colour, unshaded: lights, ceilings. */
  | { kind: 'unlit' }
  /** Speckled carpet in its colour, tiled every UV unit. */
  | { kind: 'carpet' }
  /** A viewport onto the stars. */
  | { kind: 'space' }
  | { kind: 'keys' }
  | { kind: 'readout'; seed: number; w: number; h: number }
  /** An LCARS console top, w×h metres, with a station for each of `stations` crew side by side. */
  | { kind: 'console'; seed: number; w: number; h: number; stations: number }
  | { kind: 'sign'; text: string; color: string; sub?: string; code?: string }
  /** `feed`: which of a team station's transporter rooms a feed's picture or caption is from (0 to 2). */
  | { kind: 'screen'; screen: ScreenName; feed?: number }
  /** The colour of whatever it's part of: a team station's accent. */
  | { kind: 'accent' }
  /** A team station door's lamps, lit while its goal room is in session. */
  | { kind: 'lamp' }
  /** Long-range sensors, as on the lounge wall. */
  | { kind: 'star-chart' }
  /** Part of the warp core, glowing and pulsing (warpCore.ts). */
  | { kind: 'warp-core'; part: CorePart };

function fail(what: string, extras: Extras): never {
  throw new Error(`Deck extras: ${what} in ${JSON.stringify(extras)}`);
}

function num(e: Extras, key: string): number {
  const v = e[key];
  return typeof v === 'number' ? v : fail(`${key} should be a number`, e);
}

function str(e: Extras, key: string): string {
  const v = e[key];
  return typeof v === 'string' ? v : fail(`${key} should be a string`, e);
}

function optStr(e: Extras, key: string): string | undefined {
  return e[key] === undefined ? undefined : str(e, key);
}

/** The marker an object's extras make it, or null for scenery. */
export function readMarker(e: Extras): Marker | null {
  switch (e.marker) {
    case undefined:
      return null;
    case 'collider':
      return { kind: 'collider' };
    case 'door':
      return { kind: 'door', width: num(e, 'width'), height: num(e, 'height') };
    case 'place':
      return { kind: 'place', label: str(e, 'label') };
    case 'area':
      return { kind: 'area', label: str(e, 'label') };
    case 'seat':
      return { kind: 'seat', crew: isCrew(e.crew) ? e.crew : fail('unknown crew', e) };
    case 'turbolift':
      return { kind: 'turbolift', label: str(e, 'label') };
    case 'portal':
      return { kind: 'portal', width: num(e, 'width'), height: num(e, 'height'), depth: num(e, 'depth') };
    case 'pad':
      return { kind: 'pad', tier: num(e, 'tier'), slot: num(e, 'slot') };
    case 'camera':
      return { kind: 'camera', fov: num(e, 'fov') };
    default:
      return fail('unknown marker', e);
  }
}

/** How a material's extras say to draw it. */
export function readSurface(e: Extras): Surface {
  switch (e.surface) {
    case undefined:
      return { kind: 'toon' };
    case 'unlit':
    case 'carpet':
    case 'space':
    case 'keys':
    case 'star-chart':
    case 'accent':
    case 'lamp':
      return { kind: e.surface };
    case 'readout':
      return { kind: 'readout', seed: num(e, 'seed'), w: num(e, 'w'), h: num(e, 'h') };
    case 'console':
      return { kind: 'console', seed: num(e, 'seed'), w: num(e, 'w'), h: num(e, 'h'), stations: num(e, 'stations') };
    case 'sign':
      return { kind: 'sign', text: str(e, 'text'), color: str(e, 'color'), sub: optStr(e, 'sub'), code: optStr(e, 'code') };
    case 'screen':
      return { kind: 'screen', screen: isScreen(e.screen) ? e.screen : fail('unknown screen', e), ...(e.feed !== undefined && { feed: num(e, 'feed') }) };
    case 'warp-core':
      return { kind: 'warp-core', part: e.part === 'column' || e.part === 'chamber' ? e.part : fail('unknown part of the warp core', e) };
    default:
      return fail('unknown surface', e);
  }
}

/** What pressing E on an object does, and the hint for it, or null for scenery you can't use. */
export function readInteraction(e: Extras): { interaction: Interaction; label: string } | null {
  switch (e.interact) {
    case undefined:
      return null;
    case 'manager':
    case 'turbolift':
    case 'engineering':
    case 'energise':
    case 'ledger':
      return { interaction: { kind: e.interact }, label: str(e, 'label') };
    default:
      return fail('unknown interaction', e);
  }
}

/** The part an object's extras name it, or null for anything else. */
export function readPart(e: Extras): Part | null {
  switch (e.part) {
    case undefined:
      return null;
    case 'pad-ring':
    case 'pad-emitter':
      return { kind: e.part, tier: num(e, 'tier'), slot: num(e, 'slot') };
    case 'buffer-glow':
      return { kind: 'buffer-glow' };
    default:
      return fail('unknown part', e);
  }
}
