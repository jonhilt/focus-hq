import { describe, expect, it } from 'vitest';
import { adapt, initialResolution } from './resolution';

const frames = (ms: number, n = 60) => Array.from({ length: n }, () => ms);
const SIXTY = 1000 / 60;
/** The CPU busy for a few ms of each frame: slow frames are waiting on the GPU. */
const idle = frames(4);

describe('adapt', () => {
  it('starts at the finest ratio the screen has', () => {
    expect(initialResolution(2).ratio).toBe(2);
    expect(initialResolution(1).ratio).toBe(1);
    expect(initialResolution(1.5).ratio).toBe(1.5);
  });

  it('steps down a ratio when frames run slow', () => {
    const next = adapt(initialResolution(2), frames(30), idle, SIXTY, 2, 0);
    expect(next.ratio).toBe(1.75);
  });

  it('stays put while frames keep up with the screen at its finest', () => {
    const start = initialResolution(2);
    expect(adapt(start, frames(SIXTY), idle, SIXTY, 2, 0)).toBe(start);
  });

  it('stays put when a little slow but not slow enough to drop', () => {
    const state = { ratio: 1.5, blocked: {} };
    // under 45 fps but over 40: neither keeping up nor slow enough to lose detail over
    expect(adapt(state, frames(22), idle, SIXTY, 2, 0)).toBe(state);
  });

  it('climbs back a ratio when keeping up with the screen', () => {
    expect(adapt({ ratio: 1.5, blocked: {} }, frames(SIXTY), idle, SIXTY, 2, 0).ratio).toBe(1.75);
  });

  it('leaves the resolution alone when frames are slow because the CPU is busy: fewer pixels would not help', () => {
    const state = initialResolution(2);
    expect(adapt(state, frames(30), frames(25), SIXTY, 2, 0)).toBe(state);
  });

  it('frees a ratio it left when the one below runs slow too: it was not to blame', () => {
    let state = adapt(initialResolution(2), frames(30), idle, SIXTY, 2, 0);
    state = adapt(state, frames(30), idle, SIXTY, 2, 1500);
    expect(state.ratio).toBe(1.5);
    // 1.75 is held off, 2 is free again: once frames keep up, it climbs straight back as far as 1.75 lets it
    expect(state.blocked[2]).toBeUndefined();
    expect(adapt(state, frames(SIXTY), idle, SIXTY, 2, 3000).ratio).toBe(1.5);
    expect(adapt(state, frames(SIXTY), idle, SIXTY, 2, 13_000).ratio).toBe(1.75);
  });

  it("leaves a ratio that ran slow alone for a while, then tries it again, waiting longer each time", () => {
    let state = adapt({ ratio: 2, blocked: {} }, frames(30), idle, SIXTY, 2, 0);
    expect(state.ratio).toBe(1.75);
    // keeping up at 1.75, but 2 ran slow just now
    expect(adapt(state, frames(SIXTY), idle, SIXTY, 2, 5_000).ratio).toBe(1.75);
    state = adapt(state, frames(SIXTY), idle, SIXTY, 2, 11_000);
    expect(state.ratio).toBe(2);
    // slow again: left alone twice as long
    state = adapt(state, frames(30), idle, SIXTY, 2, 12_000);
    expect(adapt(state, frames(SIXTY), idle, SIXTY, 2, 12_000 + 11_000).ratio).toBe(1.75);
    expect(adapt(state, frames(SIXTY), idle, SIXTY, 2, 12_000 + 21_000).ratio).toBe(2);
  });

  it('is slow by the screen too: a 120 Hz screen keeping up at 60 fps is fine', () => {
    const state = { ratio: 2, blocked: {} };
    expect(adapt(state, frames(SIXTY), idle, 1000 / 120, 2, 0)).toBe(state);
  });

  it('never goes below the coarsest ratio, nor decides on too few frames', () => {
    const coarsest = { ratio: 0.75, blocked: {} };
    expect(adapt(coarsest, frames(60), idle, SIXTY, 2, 0)).toBe(coarsest);
    expect(adapt(initialResolution(2), frames(60, 5), idle, SIXTY, 2, 0).ratio).toBe(2);
  });
});
