import { describe, expect, it } from 'vitest';
import { readInteraction, readMarker, readSurface } from './deckExtras';

describe('readMarker', () => {
  it('leaves scenery alone', () => {
    expect(readMarker({})).toBeNull();
    expect(readMarker({ name: 'pilaster' })).toBeNull();
  });

  it('reads each kind of marker with what it needs', () => {
    expect(readMarker({ marker: 'collider' })).toEqual({ kind: 'collider' });
    expect(readMarker({ marker: 'door', width: 2, height: 2.5 })).toEqual({ kind: 'door', width: 2, height: 2.5 });
    expect(readMarker({ marker: 'place', label: '🌌 Bridge' })).toEqual({ kind: 'place', label: '🌌 Bridge' });
    expect(readMarker({ marker: 'area', label: 'Turbolift' })).toEqual({ kind: 'area', label: 'Turbolift' });
    expect(readMarker({ marker: 'seat', crew: 'number-one' })).toEqual({ kind: 'seat', crew: 'number-one' });
    expect(readMarker({ marker: 'seat', crew: 'engineer' })).toEqual({ kind: 'seat', crew: 'engineer' });
    expect(readMarker({ marker: 'seat', crew: 'station-lead' })).toEqual({ kind: 'seat', crew: 'station-lead' });
    expect(readMarker({ marker: 'seat', crew: 'station-helper-4' })).toEqual({ kind: 'seat', crew: 'station-helper-4' });
    expect(readMarker({ marker: 'seat', crew: 'station-reviewer' })).toEqual({ kind: 'seat', crew: 'station-reviewer' });
    expect(readMarker({ marker: 'turbolift', label: 'Deck 1 · Bridge' })).toEqual({ kind: 'turbolift', label: 'Deck 1 · Bridge' });
    expect(readMarker({ marker: 'portal', width: 2, height: 2.5, depth: 0.75 })).toEqual({ kind: 'portal', width: 2, height: 2.5, depth: 0.75 });
  });

  it('fails on a marker it doesn’t know or one missing what it needs', () => {
    expect(() => readMarker({ marker: 'window' })).toThrow(/unknown marker/);
    expect(() => readMarker({ marker: 'door', width: 2 })).toThrow(/height should be a number/);
    expect(() => readMarker({ marker: 'place' })).toThrow(/label should be a string/);
    expect(() => readMarker({ marker: 'turbolift' })).toThrow(/label should be a string/);
    expect(() => readMarker({ marker: 'portal', width: 2, height: 2.5 })).toThrow(/depth should be a number/);
    expect(() => readMarker({ marker: 'seat', crew: 'cook' })).toThrow(/unknown crew/);
    expect(() => readMarker({ marker: 'seat', crew: 'station-helper-5' })).toThrow(/unknown crew/);
  });
});

describe('readSurface', () => {
  it('draws a plain material in toon', () => {
    expect(readSurface({})).toEqual({ kind: 'toon' });
  });

  it('reads the surfaces the browser draws itself', () => {
    expect(readSurface({ surface: 'space' })).toEqual({ kind: 'space' });
    expect(readSurface({ surface: 'accent' })).toEqual({ kind: 'accent' });
    expect(readSurface({ surface: 'lamp' })).toEqual({ kind: 'lamp' });
    expect(readSurface({ surface: 'readout', seed: 21, w: 2.4, h: 0.9 })).toEqual({ kind: 'readout', seed: 21, w: 2.4, h: 0.9 });
    expect(readSurface({ surface: 'console', seed: 51, w: 2.9, h: 0.45, stations: 2 })).toEqual({ kind: 'console', seed: 51, w: 2.9, h: 0.45, stations: 2 });
    expect(readSurface({ surface: 'sign', text: 'Turbolift', color: '#ff9900', code: '01-12' })).toEqual({
      kind: 'sign',
      text: 'Turbolift',
      color: '#ff9900',
      sub: undefined,
      code: '01-12',
    });
    expect(readSurface({ surface: 'screen', screen: 'mission-control' })).toEqual({ kind: 'screen', screen: 'mission-control' });
    expect(readSurface({ surface: 'screen', screen: 'team-station' })).toEqual({ kind: 'screen', screen: 'team-station' });
    expect(readSurface({ surface: 'screen', screen: 'team-station-sign' })).toEqual({ kind: 'screen', screen: 'team-station-sign' });
    expect(readSurface({ surface: 'screen', screen: 'team-station-note' })).toEqual({ kind: 'screen', screen: 'team-station-note' });
    expect(readSurface({ surface: 'screen', screen: 'msd' })).toEqual({ kind: 'screen', screen: 'msd' });
    expect(readSurface({ surface: 'star-chart' })).toEqual({ kind: 'star-chart' });
    expect(readSurface({ surface: 'warp-core', part: 'column' })).toEqual({ kind: 'warp-core', part: 'column' });
    expect(readSurface({ surface: 'warp-core', part: 'chamber' })).toEqual({ kind: 'warp-core', part: 'chamber' });
  });

  it('fails on a surface it doesn’t know or one missing what it needs', () => {
    expect(() => readSurface({ surface: 'hologram' })).toThrow(/unknown surface/);
    expect(() => readSurface({ surface: 'readout', seed: 3 })).toThrow(/w should be a number/);
    expect(() => readSurface({ surface: 'screen', screen: 'weather' })).toThrow(/unknown screen/);
    expect(() => readSurface({ surface: 'warp-core', part: 'nacelle' })).toThrow(/unknown part of the warp core/);
  });
});

describe('readInteraction', () => {
  it('leaves scenery you can’t use alone', () => {
    expect(readInteraction({})).toBeNull();
    expect(readInteraction({ name: 'desk' })).toBeNull();
  });

  it('reads what pressing E does, and the hint for it', () => {
    expect(readInteraction({ interact: 'manager', label: 'Use the ready room console' })).toEqual({
      interaction: { kind: 'manager' },
      label: 'Use the ready room console',
    });
    expect(readInteraction({ interact: 'turbolift', label: 'Use the turbolift' })).toEqual({ interaction: { kind: 'turbolift' }, label: 'Use the turbolift' });
    expect(readInteraction({ interact: 'engineering', label: 'Retros' })).toEqual({ interaction: { kind: 'engineering' }, label: 'Retros' });
    expect(readInteraction({ interact: 'ledger', label: 'Review the ledger' })).toEqual({ interaction: { kind: 'ledger' }, label: 'Review the ledger' });
  });

  it('fails on an interaction it doesn’t know or one without a hint', () => {
    expect(() => readInteraction({ interact: 'replicator', label: 'Tea, Earl Grey, hot' })).toThrow(/unknown interaction/);
    expect(() => readInteraction({ interact: 'manager' })).toThrow(/label should be a string/);
  });
});
