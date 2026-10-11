// The frame-stats log's arithmetic (ui/frameStats.ts sends it, server/frameStats.ts keeps it): how a second of frames
// is summed up, which frames count as hitches, and what a page load's log is called.
import type { Spread } from '../../shared/types';

/** How often (ms) a sample of the frames is taken, and how often the samples go to the office. */
export const SAMPLE_EVERY = 1000;
export const SEND_EVERY = 5000;
/** A frame slower than this (ms, under 20 fps) is a hitch, logged with what came with it. */
export const HITCH = 50;
/** At most this many hitches are logged a sample, so a page that's stalling all the time doesn't flood the log. */
export const HITCHES_PER_SAMPLE = 10;

const tenth = (ms: number) => Math.round(ms * 10) / 10;

/** The typical, the slowest but one in twenty, and the slowest of `ms`, to a tenth of a millisecond. */
export function spread(ms: number[]): Spread {
  if (!ms.length) return { median: 0, p95: 0, max: 0 };
  const sorted = [...ms].sort((a, b) => a - b);
  const at = (q: number) => tenth(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]);
  return { median: at(0.5), p95: at(0.95), max: tenth(sorted[sorted.length - 1]) };
}

/** A page load's log, named for when it opened (so they sort by time) and a few letters to tell two apart. */
export function sessionId(opened: Date, suffix: string): string {
  return `${opened.toISOString().replace(/[:.]/g, '-')}-${suffix}`;
}
