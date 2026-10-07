import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Deck } from './deck';
import { ROOM_WIDTH } from './layout';

/** The holodeck deck put together for a number of rows: its head, a deck for each row, and its tail. */
export interface HolodeckParts {
  head: Deck;
  rows: Deck[];
  tail: Deck;
}

/**
 * The holodeck deck, built in Blender as modules (blender/holodeck_deck.py), put together for however many rows of
 * holodecks the ship has: its head north of z = 0 and its hallway running south from there, so the holodecks stand
 * where roomSlot puts them.
 */
export class HolodeckDeck {
  private constructor(
    private readonly head: THREE.Object3D,
    private readonly rows: readonly [even: THREE.Object3D, odd: THREE.Object3D],
    private readonly tail: THREE.Object3D,
  ) {}

  static async load(url: string): Promise<HolodeckDeck> {
    const { scene } = await new GLTFLoader().loadAsync(url);
    return HolodeckDeck.of(scene);
  }

  /** The deck whose modules are in `scene`, by name. */
  static of(scene: THREE.Object3D): HolodeckDeck {
    const module = (name: string): THREE.Object3D => {
      const found = scene.getObjectByName(name);
      if (!found) throw new Error(`The holodeck deck has no ${name} module`);
      return found;
    };
    return new HolodeckDeck(module('head'), [module('row_even'), module('row_odd')], module('tail'));
  }

  assemble(rows: number): HolodeckParts {
    const at = (z: number) => new THREE.Vector3(0, 0, z);
    return {
      head: Deck.from(this.head, at(0)),
      rows: Array.from({ length: rows }, (_, r) => Deck.from(this.rows[r % 2], at(-r * ROOM_WIDTH))),
      tail: Deck.from(this.tail, at(-rows * ROOM_WIDTH)),
    };
  }
}
