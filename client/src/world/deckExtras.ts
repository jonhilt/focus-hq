// What blender/kit.py writes into a deck's glTF extras (its objects' and materials' custom properties), read once as
// the deck loads. A deck that doesn't match is a bug in the Blender script, so it fails loudly rather than guessing.

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
  | { kind: 'area'; label: string };

/** How a deck's surface is drawn. */
export type Surface =
  | { kind: 'toon'; outline: boolean }
  /** Its colour, unshaded: lights, ceilings. */
  | { kind: 'unlit' }
  /** Speckled carpet in its colour, tiled every UV unit. */
  | { kind: 'carpet' }
  /** A viewport onto the stars. */
  | { kind: 'space' }
  | { kind: 'keys' }
  | { kind: 'readout'; seed: number; w: number; h: number }
  | { kind: 'sign'; text: string; color: string; sub?: string; code?: string };

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
    default:
      return fail('unknown marker', e);
  }
}

/** How a material's extras say to draw it. */
export function readSurface(e: Extras): Surface {
  switch (e.surface) {
    case undefined:
      return { kind: 'toon', outline: e.outline !== 0 };
    case 'unlit':
    case 'carpet':
    case 'space':
    case 'keys':
      return { kind: e.surface };
    case 'readout':
      return { kind: 'readout', seed: num(e, 'seed'), w: num(e, 'w'), h: num(e, 'h') };
    case 'sign':
      return { kind: 'sign', text: str(e, 'text'), color: str(e, 'color'), sub: optStr(e, 'sub'), code: optStr(e, 'code') };
    default:
      return fail('unknown surface', e);
  }
}
