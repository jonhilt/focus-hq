import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { chairInHand, SEATED_EYE, seatedView } from './chairs';

describe('seatedView', () => {
  it('puts your eyes over the chair, looking level the way it faces', () => {
    const { eye, lookAt } = seatedView({ at: new THREE.Vector3(2, 0, -3), facing: new THREE.Vector3(2, 0.5, -5) });
    expect(eye.toArray()).toEqual([2, SEATED_EYE, -3]);
    expect(lookAt.clone().sub(eye).toArray()).toEqual([0, 0, -1]);
  });
});

describe('chairInHand', () => {
  it('is nothing on your feet', () => {
    expect(chairInHand(null, null)).toBeNull();
    expect(chairInHand(null, { kind: 'sit' })).toBeNull();
  });

  it('is the chair you’re in, with nothing else under the crosshair', () => {
    expect(chairInHand('bridge', null)).toBe('bridge');
  });

  it('is the chair you’re in, with the chair’s own parts under the crosshair', () => {
    expect(chairInHand('lounge', { kind: 'sit' })).toBe('lounge');
  });

  it('gives way to something else you aim at from the chair', () => {
    expect(chairInHand('ready-room', { kind: 'manager' })).toBeNull();
  });
});
