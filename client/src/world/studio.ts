import type { StudioPitches, StudioTake, StudioThread } from '../../../shared/types';
import { ENTRANCE_X } from './hallLayout';

// The studio: an empty holodeck where the captain and its computer, a Claude session of its own, think a video through
// (docs/studio.md). Its premise is on the far wall, its beats in a row of cards round under it, each loose thread hangs
// in the air in a row across the hall as a light, its question on a tag that comes up as you walk over, and the computer's
// takes play side by side on the floor (studioHall.ts, questionLights.ts, takes.ts). Nothing here draws, so it can be
// tested without a browser.

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

/** The warm light an open question glows in. */
export const QUESTION_LIGHT = '#ffc35c';

/** Which way a light goes once its question's settled: up, answered (green); down, dropped (dim). */
export type Settled = 'up' | 'down';

/** A question hanging in the air as a light: its id, its words, what its tag calls it, and how it went, once it has. */
export interface Lit {
  id: string;
  text: string;
  label: string;
  settled?: Settled;
}

/** The video's loose threads as lights: answered ones went up, dropped ones down. */
export function threadLights(threads: readonly StudioThread[]): Lit[] {
  return threads.map((t) => ({
    id: t.id,
    text: t.text,
    label: `Thread ${t.id}`,
    ...(t.closed && { settled: t.closed.as === 'answered' ? ('up' as const) : ('down' as const) }),
  }));
}

/**
 * Which light each open question has: one that's lit keeps its place (`held`, id → slot) while the others come and go,
 * and a new one takes the first free place, passing over those a settled light is still going from (`leaving`, and the
 * ones settled just now) while there's another; and the lit ones that have since been settled, and which way they go
 * (one that's gone from the list goes down).
 */
export function placeLights(
  lits: readonly Lit[],
  held: ReadonlyMap<string, number>,
  slots: number,
  leaving: ReadonlySet<number> = new Set(),
): { slots: Map<string, number>; settled: { id: string; way: Settled }[] } {
  const open = lits.filter((l) => !l.settled);
  const openIds = new Set(open.map((l) => l.id));
  const placed = new Map<string, number>();
  for (const [id, slot] of held) if (openIds.has(id)) placed.set(id, slot);
  const taken = new Set(placed.values());
  const going = new Set([...leaving, ...[...held].filter(([id]) => !openIds.has(id)).map(([, slot]) => slot)]);
  const order = [...Array.from({ length: slots }, (_, i) => i).filter((i) => !going.has(i)), ...going];
  for (const l of open) {
    if (placed.has(l.id)) continue;
    const free = order.find((i) => !taken.has(i));
    if (free === undefined) break;
    placed.set(l.id, free);
    taken.add(free);
  }
  const settled = [...held.keys()].filter((id) => !openIds.has(id)).map((id) => ({ id, way: lits.find((l) => l.id === id)?.settled ?? ('down' as const) }));
  return { slots: placed, settled };
}

/**
 * The premise on the far wall (the hall's frame, +X straight ahead from the entrance): a hologram curved round it `r`
 * from the middle, `half` radians either side of straight ahead, from `bottom` to `top`; and the beats' cards in a row
 * round under it, each `card` metres wide with `gap` between, from `cardBottom` to `cardTop`: high enough to read over
 * the takes standing in front of them.
 */
export const STUDIO_WALL = { r: 16.3, half: 0.42, bottom: 4.4, top: 7.9, card: 2, gap: 0.22, cardR: 15.9, cardBottom: 2.85, cardTop: 4.2 };

/**
 * Where each thread's light hangs (the hall's frame): in a row across the hall between the entrance and the takes, `x`
 * from the middle (towards the far wall), `z` across, `y` up, just over your head, so they're in view as you walk in and
 * their tags read from where you stand; the nearest the middle first, alternately left and right, leaving the view down
 * the middle to the premise clear, and alternately higher and lower so their tags don't sit on each other.
 */
export const THREAD_SLOTS: readonly { x: number; z: number; y: number }[] = [
  { x: -6, z: -1.6, y: 1.9 },
  { x: -6, z: 1.6, y: 2.15 },
  { x: -6.2, z: -3.4, y: 2.15 },
  { x: -6.2, z: 3.4, y: 1.9 },
  { x: -6.4, z: -5.2, y: 1.9 },
  { x: -6.4, z: 5.2, y: 2.15 },
  { x: -6.6, z: -7, y: 2.15 },
  { x: -6.6, z: 7, y: 1.9 },
];

/** Where the beats' row of cards starts (its first card's left edge), in radians round from straight ahead. */
export function beatsFrom(count: number): number {
  const { card, gap, cardR } = STUDIO_WALL;
  return -(count * card + (count - 1) * gap) / 2 / cardR;
}

/** Each take's floor before it's scaled to fit the room: `width` across and `depth` deep, as its script is told. */
export const TAKE_PLOT = { width: 8, depth: 6 };
/** Round the room: floors `gap` apart, their outer edges `margin` in from the round wall, and none nearer the entrance wall than `door`. */
const RING = { gap: 1, margin: 0.8, door: 0.5 };
/** The smallest a take's floor is scaled to, however many there are. */
const MIN_SCALE = 0.4;

/** The takes on the floor in the order they stand round the room: by beat (any for no beat last), each beat's as first staged. */
export function shownTakes(takes: readonly StudioTake[]): StudioTake[] {
  return takes.map((t, i) => ({ t, i })).sort((a, b) => (a.t.beat ?? Infinity) - (b.t.beat ?? Infinity) || a.i - b.i).map(({ t }) => t);
}

/** Where a take stands (the hall's frame): its floor's middle, its turn about Y (its front, +z, towards the middle of the room), and its scale. */
export interface TakeSpot {
  x: number;
  z: number;
  face: number;
  scale: number;
}

/**
 * Where each of `n` takes stands: in a horseshoe round the middle of the room, in order from the left of the entrance
 * round to its right, each facing in, so from the middle you can turn and see the whole video. They're full size while
 * they fit inside the walls, and scaled down together, a step at a time, once there are too many.
 */
export function takeSpots(n: number): TakeSpot[] {
  if (n <= 0) return [];
  for (let scale = 1; scale >= MIN_SCALE; scale = Math.round((scale - 0.05) * 100) / 100) {
    const spots = ring(n, scale);
    if (spots.every(fits)) return spots;
  }
  return ring(n, MIN_SCALE);
}

function ring(n: number, scale: number): TakeSpot[] {
  const r = STUDIO_HALL.radius - RING.margin - (TAKE_PLOT.depth * scale) / 2;
  const step = (TAKE_PLOT.width * scale + RING.gap) / r;
  return Array.from({ length: n }, (_, i) => {
    const a = (i - (n - 1) / 2) * step;
    return { x: r * Math.cos(a), z: r * Math.sin(a), face: -Math.PI / 2 - a, scale };
  });
}

/** A take's floor's corners (the hall's frame). */
export function spotCorners({ x, z, face, scale }: TakeSpot): { x: number; z: number }[] {
  const w = (TAKE_PLOT.width * scale) / 2;
  const d = (TAKE_PLOT.depth * scale) / 2;
  return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([u, v]) => ({ x: x + u * Math.cos(face) + v * Math.sin(face), z: z - u * Math.sin(face) + v * Math.cos(face) }));
}

const fits = (spot: TakeSpot) => spotCorners(spot).every((c) => Math.hypot(c.x, c.z) <= STUDIO_HALL.radius - 0.3 && c.x >= ENTRANCE_X + RING.door);

/** A moment on a take's contact sheet: when, and what's ending then, if it's a phase. */
export interface SheetMoment {
  t: number;
  label: string;
}

/**
 * The moments a take's contact sheet shows (contactSheet.ts), `count` of them in order: the end of each of its phases
 * (the moment each lands), as many as fit, filled out with even steps through it, and always its last moment.
 */
export function sheetMoments(seconds: number, phases: Record<string, [number, number]> = {}, count = 4): SheetMoment[] {
  const at = (t: number) => Math.round(Math.min(seconds, Math.max(0, t)) * 10) / 10;
  const ends = Object.entries(phases)
    .map(([name, [, to]]) => ({ t: at(to), label: `${name} lands` }))
    .filter((m) => m.t < at(seconds))
    .sort((a, b) => a.t - b.t);
  const picked = ends.filter((_, i) => i % Math.ceil(ends.length / (count - 1)) === 0).slice(0, count - 1);
  // even steps through it, skipping any too near a moment already picked
  for (let k = 1; k < count && picked.length < count - 1; k++) {
    const t = at((seconds * k) / count);
    if (!picked.some((m) => Math.abs(m.t - t) < seconds / (count * 2))) picked.push({ t, label: '' });
  }
  return [...picked.sort((a, b) => a.t - b.t), { t: at(seconds), label: 'the end' }];
}

/** The pitches still waiting on the captain, oldest first: each beat's latest, until a take is staged for that beat after it. */
export function openPitches(pitches: readonly StudioPitches[] = [], takes: readonly StudioTake[]): StudioPitches[] {
  return pitches.filter((set) => !takes.some((t) => t.beat === set.beat && t.at > set.at)).sort((a, b) => a.at - b.at);
}
