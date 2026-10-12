import type { StudioTake, StudioThread } from '../../../shared/types';

// The studio: an empty holodeck where the captain and its computer, a Claude session of its own, think a video through
// (docs/studio.md). Its premise is on the far wall, its beats in a row of cards round under it, each loose thread hangs
// in the air in a row across the hall as a light, its question on a tag that comes up as you walk over, and the computer's
// takes play side by side on the floor (studioHall.ts, questionLights.ts, takes.ts). Nothing here draws, so it can be
// tested without a browser.

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
 * round under it, each `card` metres wide with `gap` between, from `cardBottom` to `cardTop`.
 */
export const STUDIO_WALL = { r: 10.3, half: 0.36, bottom: 2.5, top: 5.5, card: 1.7, gap: 0.18, cardR: 9.9, cardBottom: 0.75, cardTop: 2.15 };

/**
 * Where each thread's light hangs (the hall's frame): in a row across the hall between the entrance and the takes, `x`
 * from the middle (towards the far wall), `z` across, `y` up, just over your head, so they're in view as you walk in and
 * their tags read from where you stand; the nearest the middle first, alternately left and right, leaving the view down
 * the middle to the premise clear, and alternately higher and lower so their tags don't sit on each other.
 */
export const THREAD_SLOTS: readonly { x: number; z: number; y: number }[] = [
  { x: -4.2, z: -1.8, y: 1.9 },
  { x: -4.2, z: 1.8, y: 2.15 },
  { x: -4.4, z: -3.6, y: 2.15 },
  { x: -4.4, z: 3.6, y: 1.9 },
  { x: -4.6, z: -5.4, y: 1.9 },
  { x: -4.6, z: 5.4, y: 2.15 },
  { x: -4.8, z: -7.2, y: 2.15 },
  { x: -4.8, z: 7.2, y: 1.9 },
];

/** Where the beats' row of cards starts (its first card's left edge), in radians round from straight ahead. */
export function beatsFrom(count: number): number {
  const { card, gap, cardR } = STUDIO_WALL;
  return -(count * card + (count - 1) * gap) / 2 / cardR;
}

/** How many takes play on the floor at once: the newest. */
export const TAKES_SHOWN = 3;

/**
 * Each take's floor (the hall's frame): `width` across and `depth` deep, side by side across the hall in the order
 * they're shown, left to right as you face the far wall, `x` from the middle towards it; the take's own +z (its front)
 * faces back towards the entrance, where you come in.
 */
export const TAKE_PLOT = { width: 6, depth: 5, gap: 0.6, x: 0.6 };

/** The takes on the floor: the newest few, in the order they were first staged. */
export function shownTakes(takes: readonly StudioTake[]): StudioTake[] {
  return takes.slice(-TAKES_SHOWN);
}

/** Where take `i` of `n` stands across the hall (its middle's z in the hall's frame), the row centred on the hall. */
export function plotZ(i: number, n: number): number {
  const step = TAKE_PLOT.width + TAKE_PLOT.gap;
  return (i - (n - 1) / 2) * step;
}
