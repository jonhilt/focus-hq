import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { clockNight, dimsAtNight, FADE, fade, nextChange, nightWanted, setNightLevel, toggle } from './night';

const at = (hour: number, minute = 0) => new Date(2026, 9, 16, hour, minute);

describe('night', () => {
  afterEach(() => setNightLevel(0));

  it('falls at eight in the evening and lifts at seven in the morning, by the local clock', () => {
    expect(clockNight(at(19, 59))).toBe(false);
    expect(clockNight(at(20))).toBe(true);
    expect(clockNight(at(0))).toBe(true);
    expect(clockNight(at(6, 59))).toBe(true);
    expect(clockNight(at(7))).toBe(false);
    expect(clockNight(at(12))).toBe(false);
  });

  it('changes over next this evening, or the morning after', () => {
    expect(nextChange(at(12, 30))).toEqual(at(20));
    expect(nextChange(at(3))).toEqual(at(7));
    expect(nextChange(at(22, 15))).toEqual(new Date(2026, 9, 17, 7));
  });

  it('follows the clock until the captain says otherwise', () => {
    expect(nightWanted(at(22), null)).toBe(true);
    expect(nightWanted(at(12), null)).toBe(false);
  });

  it('keeps the captain’s say until the clock next changes over, and not into the night after', () => {
    const lightsUp = toggle(at(22), null);
    expect(nightWanted(at(23), lightsUp)).toBe(false);
    expect(nightWanted(new Date(2026, 9, 17, 6, 59), lightsUp)).toBe(false);
    expect(nightWanted(new Date(2026, 9, 17, 21), lightsUp)).toBe(true);
  });

  it('dimmed early in the evening, stays dark into the clock’s own night, and lets the morning come', () => {
    const early = toggle(at(18), null);
    expect(nightWanted(at(19), early)).toBe(true);
    // the clock's own night starts at eight: the override's over, and it's night anyway
    expect(nightWanted(at(21), early)).toBe(true);
    expect(nightWanted(new Date(2026, 9, 17, 8), early)).toBe(false);
  });

  it('pressed again, goes back to what the clock says', () => {
    const dimmed = toggle(at(12), null);
    expect(nightWanted(at(12), toggle(at(12), dimmed))).toBe(false);
  });

  it('fades all the way in FADE seconds, and no further', () => {
    expect(fade(0, true, FADE / 2)).toBeCloseTo(0.5);
    expect(fade(0.9, true, FADE)).toBe(1);
    expect(fade(0.1, false, FADE)).toBe(0);
    expect(fade(1, true, 0.1)).toBe(1);
  });

  it('dims what it’s given from its daytime colour, and brings it back by day', () => {
    const ceiling = new THREE.Color('#ffffff');
    dimsAtNight(ceiling);
    setNightLevel(1);
    expect(ceiling.r).toBeLessThan(0.5);
    expect(ceiling.b).toBeGreaterThan(ceiling.r);
    setNightLevel(0);
    expect(ceiling.getHexString()).toBe('ffffff');
  });

  it('starts something registered at night already dark, and forgets it once its material is disposed', () => {
    setNightLevel(1);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    dimsAtNight(mat.color, mat);
    expect(mat.color.r).toBeLessThan(0.5);
    mat.dispose();
    const left = mat.color.getHex();
    setNightLevel(0);
    expect(mat.color.getHex()).toBe(left);
  });
});
