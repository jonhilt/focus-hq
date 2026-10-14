import { ENTRANCE_X } from './hallLayout';

// The studio: an empty holodeck where the captain describes something to see and its computer, a Claude session of its
// own, builds it as a moving scene in the middle of the hall, to walk round, spin, pause and scrub (docs/studio.md,
// studioHall.ts, takes.ts). Nothing here draws, so it can be tested without a browser.

/**
 * The studio's hall: bigger than a training hall on the inside, as a holodeck can be. It keeps the hall's entrance, but
 * its round wall stands `radius` from the middle of the floor (a training hall's is 11 m) and its ceiling `height` up,
 * so its entrance wall runs wider either side of the doorway, out to where the round wall meets it.
 */
export const STUDIO_HALL = { radius: 17, height: 8 };
/** How far either side of the middle the hall's own entrance wall reaches, which the studio keeps (blender/training_hall.py). */
const ENTRANCE_HALF = 2.4;

/** How far round the studio's round wall goes, from straight ahead either way, to its entrance wall. */
export const STUDIO_SPAN = Math.acos(ENTRANCE_X / STUDIO_HALL.radius);

/**
 * Where the player can't walk past the studio's walls (the hall's frame): small squares `half` either side of points
 * `step` apart along its round wall and along its entrance wall from either side of the hall's own out to the round one.
 */
export function studioWalls(step = 0.3, half = 0.2): { x: number; z: number; half: number }[] {
  const r = STUDIO_HALL.radius + half / 2;
  const out: { x: number; z: number; half: number }[] = [];
  const n = Math.ceil((2 * STUDIO_SPAN * r) / step);
  for (let i = 0; i <= n; i++) {
    const a = -STUDIO_SPAN + (2 * STUDIO_SPAN * i) / n;
    out.push({ x: r * Math.cos(a), z: r * Math.sin(a), half });
  }
  const wide = STUDIO_HALL.radius * Math.sin(STUDIO_SPAN);
  for (let z = ENTRANCE_HALF; z <= wide + step; z += step) for (const side of [-1, 1]) out.push({ x: ENTRANCE_X - half / 2, z: side * z, half });
  return out;
}

/** Whether a collider of the hall's own (its middle in the hall's frame) is one the studio keeps: its entrance wall's, round the doorway. */
export function keepsHallCollider(x: number, z: number): boolean {
  return x < ENTRANCE_X + 0.35 && Math.abs(z) < ENTRANCE_HALF + 0.1;
}

/**
 * The far wall's hologram (the hall's frame, +X straight ahead from the entrance): curved round it `r` from the middle,
 * `half` radians either side of straight ahead, from `bottom` to `top`, high enough to read over the scene.
 */
export const STUDIO_WALL = { r: 16.3, half: 0.42, bottom: 4.4, top: 7.9 };

/** The round stage a scene stands on in the middle of the hall: within `radius` of its middle, up to `height` (as its script is told). */
export const SCENE_STAGE = { radius: 6, height: 8 };

/** How long a scene holds its last frame before it loops (s). */
export const SCENE_HOLD = 1.2;
/** The speeds the captain steps through with - and =. */
export const SCENE_SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;
/** How fast the scene turns while Q or R is held (radians a second), and how far [ or ] scrubs (s). */
export const SPIN_RATE = 1.4;
export const SCRUB_STEP = 0.5;

/**
 * How the captain's playing the scene in the hall: where it's got to (`t`, from 0 to its seconds and a moment's hold,
 * looping), paused or not, at what speed, and how far it's been spun. It's the scene's own clock, not the wall's, so
 * pausing and scrubbing are just changes to it.
 */
export class ScenePlayback {
  t = 0;
  paused = false;
  speed = 1;
  spin = 0;
  /** Which way it's turning while a key's held: -1, 0 or 1. */
  turning = 0;

  /** Starts a new scene (or a new version of one) from its beginning, playing; keeps the spin and speed. */
  restart(): void {
    this.t = 0;
    this.paused = false;
  }

  /** Moves on `dt` seconds of the wall's time, for a scene `seconds` long. */
  advance(dt: number, seconds: number): void {
    this.spin += this.turning * SPIN_RATE * dt;
    if (!this.paused) this.t = (this.t + dt * this.speed) % (seconds + SCENE_HOLD);
  }

  /** The moment to draw: its time, held on the last frame through the hold. */
  at(seconds: number): number {
    return Math.min(seconds, this.t);
  }

  /** Steps `by` seconds through a scene `seconds` long (pausing it, so you can look), without wrapping round. */
  scrub(by: number, seconds: number): void {
    this.paused = true;
    this.t = Math.min(seconds, Math.max(0, Math.min(this.t, seconds) + by));
  }

  /** A step faster (+1) or slower (-1) through SCENE_SPEEDS. */
  stepSpeed(dir: 1 | -1): void {
    const i = SCENE_SPEEDS.findIndex((s) => s >= this.speed - 1e-6);
    const next = Math.min(SCENE_SPEEDS.length - 1, Math.max(0, (i < 0 ? SCENE_SPEEDS.length - 1 : i) + dir));
    this.speed = SCENE_SPEEDS[next];
  }
}

/** A moment on a take's contact sheet: when, and what's ending then, if it's a phase. */
export interface SheetMoment {
  t: number;
  label: string;
}

/**
 * The moments a take's contact sheet shows (contactSheet.ts), `count` of them in order: the middle of each of its
 * phases (what happens during it) and its end (the moment it lands), spread out when there are more than fit, filled
 * out with even steps through it, and always its last moment.
 */
export function sheetMoments(seconds: number, phases: Record<string, [number, number]> = {}, count = 6): SheetMoment[] {
  const at = (t: number) => Math.round(Math.min(seconds, Math.max(0, t)) * 10) / 10;
  const end = at(seconds);
  const near = (list: readonly SheetMoment[], t: number) => list.some((m) => Math.abs(m.t - t) < seconds / (count * 2));
  const candidates: SheetMoment[] = [];
  for (const [name, [from, to]] of Object.entries(phases).sort((a, b) => a[1][0] - b[1][0])) {
    for (const m of [{ t: at((from + to) / 2), label: `${name} under way` }, { t: at(to), label: `${name} lands` }]) {
      if (m.t < end && !near(candidates, m.t)) candidates.push(m);
    }
  }
  const room = count - 1;
  const picked = candidates.length > room ? Array.from({ length: room }, (_, i) => candidates[Math.round((i * (candidates.length - 1)) / (room - 1))]) : candidates;
  // even steps through it, skipping any too near a moment already picked
  for (let k = 1; k < count && picked.length < room; k++) {
    const t = at((seconds * k) / count);
    if (!near(picked, t)) picked.push({ t, label: '' });
  }
  return [...picked.sort((a, b) => a.t - b.t), { t: end, label: 'the end' }];
}

/** The shelf's arc of cards round you: `distance` from your eyes, `step` radians apart, as many as `reach` either side of the one picked shown. */
export const SHELF = { distance: 2.6, step: 0.6, reach: 3, drop: 0.15 };

/** Where a card on the shelf sits: its turn round you from straight ahead (radians, + to your left), how big it is, and how solid. */
export interface ShelfSpot {
  angle: number;
  scale: number;
  opacity: number;
}

/**
 * Where each of `n` cards sits on the shelf's arc while `at` (the one picked, eased, so it can be between two) is in
 * front of you: later ones to your right, the one in front bigger, those further round fading out past `reach`.
 */
export function shelfSpots(n: number, at: number): ShelfSpot[] {
  return Array.from({ length: n }, (_, i) => {
    const off = i - at;
    const away = Math.abs(off);
    return {
      angle: -off * SHELF.step,
      scale: 1 + 0.35 * Math.max(0, 1 - away),
      opacity: Math.max(0, Math.min(1, SHELF.reach + 0.5 - away)),
    };
  });
}

/** The shelf's pick: which card's in front, moved `by` and kept on the shelf of `n`. */
export function shelfMove(picked: number, by: number, n: number): number {
  return Math.max(0, Math.min(n - 1, picked + by));
}
