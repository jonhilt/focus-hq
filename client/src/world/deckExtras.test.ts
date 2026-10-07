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
  });

  it('fails on a marker it doesn’t know or one missing what it needs', () => {
    expect(() => readMarker({ marker: 'window' })).toThrow(/unknown marker/);
    expect(() => readMarker({ marker: 'door', width: 2 })).toThrow(/height should be a number/);
    expect(() => readMarker({ marker: 'place' })).toThrow(/label should be a string/);
    expect(() => readMarker({ marker: 'turbolift' })).toThrow(/label should be a string/);
    expect(() => readMarker({ marker: 'seat', crew: 'cook' })).toThrow(/unknown crew/);
    expect(() => readMarker({ marker: 'seat', crew: 'station-helper-5' })).toThrow(/unknown crew/);
  });
});

describe('readSurface', () => {
  it('draws a plain material in toon, with an outline unless it says not to', () => {
    expect(readSurface({})).toEqual({ kind: 'toon', outline: true });
    expect(readSurface({ outline: 0 })).toEqual({ kind: 'toon', outline: false });
  });

  it('reads the surfaces the browser draws itself', () => {
    expect(readSurface({ surface: 'space', outline: 0 })).toEqual({ kind: 'space' });
    expect(readSurface({ surface: 'accent' })).toEqual({ kind: 'accent' });
    expect(readSurface({ surface: 'readout', seed: 21, w: 2.4, h: 0.9 })).toEqual({ kind: 'readout', seed: 21, w: 2.4, h: 0.9 });
    expect(readSurface({ surface: 'sign', text: 'Turbolift', color: '#ff9900', code: '01-12' })).toEqual({
      kind: 'sign',
      text: 'Turbolift',
      color: '#ff9900',
      sub: undefined,
      code: '01-12',
    });
    expect(readSurface({ surface: 'screen', screen: 'mission-control', outline: 0 })).toEqual({ kind: 'screen', screen: 'mission-control' });
    expect(readSurface({ surface: 'screen', screen: 'team-station', outline: 0 })).toEqual({ kind: 'screen', screen: 'team-station' });
    expect(readSurface({ surface: 'screen', screen: 'team-station-sign', outline: 0 })).toEqual({ kind: 'screen', screen: 'team-station-sign' });
    expect(readSurface({ surface: 'star-chart', outline: 0 })).toEqual({ kind: 'star-chart' });
  });

  it('fails on a surface it doesn’t know or one missing what it needs', () => {
    expect(() => readSurface({ surface: 'hologram' })).toThrow(/unknown surface/);
    expect(() => readSurface({ surface: 'readout', seed: 3 })).toThrow(/w should be a number/);
    expect(() => readSurface({ surface: 'screen', screen: 'weather' })).toThrow(/unknown screen/);
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
  });

  it('fails on an interaction it doesn’t know or one without a hint', () => {
    expect(() => readInteraction({ interact: 'replicator', label: 'Tea, Earl Grey, hot' })).toThrow(/unknown interaction/);
    expect(() => readInteraction({ interact: 'manager' })).toThrow(/label should be a string/);
  });
});
