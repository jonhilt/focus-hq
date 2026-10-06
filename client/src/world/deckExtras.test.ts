import { describe, expect, it } from 'vitest';
import { readMarker, readSurface } from './deckExtras';

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
  });

  it('fails on a marker it doesn’t know or one missing what it needs', () => {
    expect(() => readMarker({ marker: 'window' })).toThrow(/unknown marker/);
    expect(() => readMarker({ marker: 'door', width: 2 })).toThrow(/height should be a number/);
    expect(() => readMarker({ marker: 'place' })).toThrow(/label should be a string/);
  });
});

describe('readSurface', () => {
  it('draws a plain material in toon, with an outline unless it says not to', () => {
    expect(readSurface({})).toEqual({ kind: 'toon', outline: true });
    expect(readSurface({ outline: 0 })).toEqual({ kind: 'toon', outline: false });
  });

  it('reads the surfaces the browser draws itself', () => {
    expect(readSurface({ surface: 'space', outline: 0 })).toEqual({ kind: 'space' });
    expect(readSurface({ surface: 'readout', seed: 21, w: 2.4, h: 0.9 })).toEqual({ kind: 'readout', seed: 21, w: 2.4, h: 0.9 });
    expect(readSurface({ surface: 'sign', text: 'Turbolift', color: '#ff9900', code: '01-12' })).toEqual({
      kind: 'sign',
      text: 'Turbolift',
      color: '#ff9900',
      sub: undefined,
      code: '01-12',
    });
  });

  it('fails on a surface it doesn’t know or one missing what it needs', () => {
    expect(() => readSurface({ surface: 'hologram' })).toThrow(/unknown surface/);
    expect(() => readSurface({ surface: 'readout', seed: 3 })).toThrow(/w should be a number/);
  });
});
