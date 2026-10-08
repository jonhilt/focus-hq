import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { regionAt, shown } from './regions';

const command = new THREE.Box3(new THREE.Vector3(-20, -1, 60), new THREE.Vector3(20, 6, 100));
const briefing = (p: THREE.Vector3) => Math.abs(p.x) > 40;

describe('regionAt', () => {
  it('is the command deck inside its box', () => {
    expect(regionAt(new THREE.Vector3(0, 1.6, 85), command, briefing)).toBe('command');
  });
  it('is a briefing room inside one', () => {
    expect(regionAt(new THREE.Vector3(45, 1.6, -6), command, briefing)).toBe('briefing');
  });
  it('is the holodeck deck anywhere else', () => {
    expect(regionAt(new THREE.Vector3(3, 1.6, -6), command, briefing)).toBe('holodecks');
  });
});

describe('shown', () => {
  it('draws only the command deck from the command deck', () => {
    expect(shown('command')).toEqual({ command: true, holodecks: false, briefing: false });
  });
  it('draws the holodecks from the holodecks, and the briefing rooms, whose doors might be open', () => {
    expect(shown('holodecks')).toEqual({ command: false, holodecks: true, briefing: true });
  });
  it('draws only the briefing rooms from a briefing room', () => {
    expect(shown('briefing')).toEqual({ command: false, holodecks: false, briefing: true });
  });
  it('draws everything when not culling', () => {
    expect(shown(null)).toEqual({ command: true, holodecks: true, briefing: true });
  });
});
