import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { HolodeckDeck } from './holodeckDeck';
import { ROOM_WIDTH } from './layout';

// decks draw with the ship's look, whose sounds remember in localStorage whether they're on
vi.hoisted(() => Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => undefined } }));

/** A scene of the deck's modules, each with a stop marker named after it, so a part shows which module it's a copy of. */
function modules(): THREE.Object3D {
  const scene = new THREE.Group();
  for (const name of ['head', 'row_even', 'row_odd', 'tail']) {
    const module = new THREE.Group();
    module.name = name;
    const stop = new THREE.Object3D();
    stop.userData = { marker: 'turbolift', label: name };
    module.add(stop);
    scene.add(module);
  }
  return scene;
}

describe('HolodeckDeck.assemble', () => {
  it('puts the head at the top of the hallway, a row of holodecks every ROOM_WIDTH south of it, and the tail after the last', () => {
    const { head, rows, tail } = HolodeckDeck.of(modules()).assemble(3);
    expect(head.stops[0].position.z).toBe(0);
    expect(rows.map((r) => r.stops[0].position.z)).toEqual([0, -ROOM_WIDTH, -2 * ROOM_WIDTH]);
    expect(tail.stops[0].position.z).toBe(-3 * ROOM_WIDTH);
  });

  it('alternates even and odd rows, starting with an even one', () => {
    const { head, rows, tail } = HolodeckDeck.of(modules()).assemble(3);
    expect([head, ...rows, tail].map((d) => d.stops[0].label)).toEqual(['head', 'row_even', 'row_odd', 'row_even', 'tail']);
  });

  it('fails on a deck missing a module', () => {
    const scene = modules();
    scene.remove(scene.getObjectByName('tail')!);
    expect(() => HolodeckDeck.of(scene)).toThrow(/no tail module/);
  });
});
