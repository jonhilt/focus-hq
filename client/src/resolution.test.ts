import { describe, expect, it } from 'vitest';
import { adapt, initialResolution, type Level, levels, type ResolutionState } from './resolution';

const frames = (ms: number, n = 60) => Array.from({ length: n }, () => ms);
const SIXTY = 1000 / 60;
/** The CPU busy for a few ms of each frame: slow frames are waiting on the GPU. */
const idle = frames(4);
/** A retina screen's ladder without the occlusion, so each step is a pixel ratio. */
const RETINA = levels(2, false);
/** The level of `ladder` at `ratio`, without the occlusion. */
const at = (ratio: number, ladder: Level[] = RETINA): ResolutionState => ({ level: ladder.findIndex((l) => l.ratio === ratio && !l.occlusion), blocked: {} });
const ratio = (state: ResolutionState, ladder: Level[] = RETINA) => ladder[state.level].ratio;

describe('levels', () => {
  it('climbs through each pixel ratio up to the finest the screen has, then adds the occlusion at the top', () => {
    expect(levels(1, true)).toEqual([
      { ratio: 0.75, occlusion: false },
      { ratio: 1, occlusion: false },
      { ratio: 1, occlusion: true },
    ]);
    expect(levels(1.5, false).map((l) => l.ratio)).toEqual([0.75, 1, 1.25, 1.5]);
  });
});

describe('adapt', () => {
  it('starts at the top of the ladder', () => {
    const ladder = levels(2, true);
    expect(ladder[initialResolution(ladder).level]).toEqual({ ratio: 2, occlusion: true });
  });

  it('drops the occlusion first when frames run slow, then pixels', () => {
    const ladder = levels(2, true);
    let state = adapt(initialResolution(ladder), frames(30), idle, SIXTY, ladder, 0);
    expect(ladder[state.level]).toEqual({ ratio: 2, occlusion: false });
    state = adapt(state, frames(30), idle, SIXTY, ladder, 1500);
    expect(ladder[state.level]).toEqual({ ratio: 1.75, occlusion: false });
  });

  it('steps down a ratio when frames run slow', () => {
    expect(ratio(adapt(initialResolution(RETINA), frames(30), idle, SIXTY, RETINA, 0))).toBe(1.75);
  });

  it('stays put while frames keep up with the screen at its finest', () => {
    const start = initialResolution(RETINA);
    expect(adapt(start, frames(SIXTY), idle, SIXTY, RETINA, 0)).toBe(start);
  });

  it('stays put when a little slow but not slow enough to drop', () => {
    const state = at(1.5);
    // under 45 fps but over 40: neither keeping up nor slow enough to lose detail over
    expect(adapt(state, frames(22), idle, SIXTY, RETINA, 0)).toBe(state);
  });

  it('climbs back a ratio when keeping up with the screen', () => {
    expect(ratio(adapt(at(1.5), frames(SIXTY), idle, SIXTY, RETINA, 0))).toBe(1.75);
  });

  it('climbs back at 60 fps on a faster screen too', () => {
    expect(ratio(adapt(at(1.5), frames(SIXTY), idle, 1000 / 120, RETINA, 0))).toBe(1.75);
  });

  it('leaves the resolution alone when frames are slow because the CPU is busy: fewer pixels would not help', () => {
    const state = initialResolution(RETINA);
    expect(adapt(state, frames(30), frames(25), SIXTY, RETINA, 0)).toBe(state);
  });

  it('frees a level it left when the one below runs slow too: it was not to blame', () => {
    let state = adapt(initialResolution(RETINA), frames(30), idle, SIXTY, RETINA, 0);
    state = adapt(state, frames(30), idle, SIXTY, RETINA, 1500);
    expect(ratio(state)).toBe(1.5);
    // 1.75 is held off, 2 is free again: once frames keep up, it climbs straight back as far as 1.75 lets it
    expect(state.blocked[RETINA.length - 1]).toBeUndefined();
    expect(ratio(adapt(state, frames(SIXTY), idle, SIXTY, RETINA, 3000))).toBe(1.5);
    expect(ratio(adapt(state, frames(SIXTY), idle, SIXTY, RETINA, 13_000))).toBe(1.75);
  });

  it('leaves a level that ran slow alone for a while, then tries it again, waiting longer each time', () => {
    let state = adapt(at(2), frames(30), idle, SIXTY, RETINA, 0);
    expect(ratio(state)).toBe(1.75);
    // keeping up at 1.75, but 2 ran slow just now
    expect(ratio(adapt(state, frames(SIXTY), idle, SIXTY, RETINA, 5_000))).toBe(1.75);
    state = adapt(state, frames(SIXTY), idle, SIXTY, RETINA, 11_000);
    expect(ratio(state)).toBe(2);
    // slow again: left alone twice as long
    state = adapt(state, frames(30), idle, SIXTY, RETINA, 12_000);
    expect(ratio(adapt(state, frames(SIXTY), idle, SIXTY, RETINA, 12_000 + 11_000))).toBe(1.75);
    expect(ratio(adapt(state, frames(SIXTY), idle, SIXTY, RETINA, 12_000 + 21_000))).toBe(2);
  });

  it('is slow by the screen too: a 120 Hz screen keeping up at 60 fps is fine', () => {
    const state = at(2);
    expect(adapt(state, frames(SIXTY), idle, 1000 / 120, RETINA, 0)).toBe(state);
  });

  it('decides on a very slow machine’s handful of frames, but not on fewer', () => {
    // 3 fps: five frames in a window and a bit
    expect(ratio(adapt(at(1), frames(330, 5), idle, SIXTY, RETINA, 0))).toBe(0.75);
    expect(adapt(at(1), frames(330, 4), idle, SIXTY, RETINA, 0).level).toBe(at(1).level);
  });

  it('never goes below the plainest level', () => {
    const plainest = at(0.75);
    expect(adapt(plainest, frames(60), idle, SIXTY, RETINA, 0)).toBe(plainest);
  });
});
