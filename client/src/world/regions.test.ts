import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { regionAt, shown } from './regions';

const decks = {
  command: new THREE.Box3(new THREE.Vector3(-20, -1, 60), new THREE.Vector3(20, 6, 100)),
  engineering: new THREE.Box3(new THREE.Vector3(-8, -5, 133), new THREE.Vector3(8, 6, 147)),
  cartography: new THREE.Box3(new THREE.Vector3(-13, -11, 177), new THREE.Vector3(13, 15, 207)),
};
const briefing = (p: THREE.Vector3) => Math.abs(p.x) > 40;

describe('regionAt', () => {
  it('is the command deck inside its box', () => {
    expect(regionAt(new THREE.Vector3(0, 1.6, 85), decks, briefing)).toBe('command');
  });
  it('is main engineering inside its box', () => {
    expect(regionAt(new THREE.Vector3(2, 1.6, 140), decks, briefing)).toBe('engineering');
  });
  it('is stellar cartography inside its sphere, high up in it too', () => {
    expect(regionAt(new THREE.Vector3(0, 1.6, 190), decks, briefing)).toBe('cartography');
    expect(regionAt(new THREE.Vector3(4, 10, 186), decks, briefing)).toBe('cartography');
  });
  it('is a briefing room inside one', () => {
    expect(regionAt(new THREE.Vector3(45, 1.6, -6), decks, briefing)).toBe('briefing');
  });
  it('is a training hall inside one', () => {
    expect(regionAt(new THREE.Vector3(150, 1.6, -6), decks, briefing, (p) => p.x > 100)).toBe('briefing');
    expect(regionAt(new THREE.Vector3(150, 1.6, -6), decks, () => false, (p) => p.x > 100)).toBe('hall');
  });
  it('is a transporter room inside one', () => {
    expect(regionAt(new THREE.Vector3(0, 1.6, 240), decks, briefing, () => false, (p) => p.z > 200)).toBe('transporter');
  });
  it('is the holodeck deck anywhere else', () => {
    expect(regionAt(new THREE.Vector3(3, 1.6, -6), decks, briefing)).toBe('holodecks');
  });
});

describe('shown', () => {
  it('draws only the command deck from the command deck', () => {
    expect(shown('command')).toEqual({ command: true, engineering: false, cartography: false, holodecks: false, hall: false, briefing: false, transporter: false });
  });
  it('draws only main engineering from main engineering', () => {
    expect(shown('engineering')).toEqual({ command: false, engineering: true, cartography: false, holodecks: false, hall: false, briefing: false, transporter: false });
  });
  it('draws the holodecks from the holodecks, and the briefing rooms, whose doors might be open', () => {
    expect(shown('holodecks')).toEqual({ command: false, engineering: false, cartography: false, holodecks: true, hall: false, briefing: true, transporter: false });
  });
  it('draws only the briefing rooms from a briefing room', () => {
    expect(shown('briefing')).toEqual({ command: false, engineering: false, cartography: false, holodecks: false, hall: false, briefing: true, transporter: false });
  });
  it('draws only the hall from a training hall, and the briefing rooms its pods open onto', () => {
    expect(shown('hall')).toEqual({ command: false, engineering: false, cartography: false, holodecks: false, hall: true, briefing: true, transporter: false });
  });
  it('draws only the transporter rooms from a transporter room', () => {
    expect(shown('transporter')).toEqual({ command: false, engineering: false, cartography: false, holodecks: false, hall: false, briefing: false, transporter: true });
  });
  it('draws only stellar cartography from stellar cartography', () => {
    expect(shown('cartography')).toEqual({ command: false, engineering: false, cartography: true, holodecks: false, hall: false, briefing: false, transporter: false });
  });
  it('draws everything when not culling', () => {
    expect(shown(null)).toEqual({ command: true, engineering: true, cartography: true, holodecks: true, hall: true, briefing: true, transporter: true });
  });
});
