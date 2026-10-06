import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { stopAt } from './turbolift';

const stop = (label: string, x: number, z: number) => ({ label, position: new THREE.Vector3(x, 0, z), lookAt: new THREE.Vector3(x, 1.5, z - 4) });
const bridge = stop('Deck 1 · Bridge', 0, 89);
const holodecks = stop('Deck 4 · Holodecks', 0, 9);

describe('stopAt', () => {
  it('is the stop you’re standing at, anywhere in its car or by its call panel', () => {
    expect(stopAt([bridge, holodecks], new THREE.Vector3(0, 1.6, 89))).toBe(bridge);
    expect(stopAt([bridge, holodecks], new THREE.Vector3(2.1, 1.6, 8.8))).toBe(holodecks);
  });

  it('is the nearer of two stops you could be at', () => {
    const next = stop('Deck 2 · Lounge', 0, 11);
    expect(stopAt([holodecks, next], new THREE.Vector3(0, 1.6, 10.2))).toBe(next);
  });

  it('is none when you’re away from every stop', () => {
    expect(stopAt([bridge, holodecks], new THREE.Vector3(0, 1.6, 80))).toBeUndefined();
    expect(stopAt([], new THREE.Vector3(0, 1.6, 9))).toBeUndefined();
  });
});
