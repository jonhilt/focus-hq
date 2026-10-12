import type { Agent, Studio, StudioGap } from '../../../shared/types';

// The studio: an empty holodeck taken over by the goal that's making a video, where the captain stands while its lead
// and they think it through (docs/studio.md). Its premise is on the far wall, its beats in a row of cards round under
// it, and each gap in what we know hangs in the air beside the premise as a light, its question on a tag that comes up
// as you walk over (studioHall.ts, questionLights.ts). Nothing here draws, so it can be tested without a browser.

/** The goal whose studio the holodeck shows: of the leads with one, the one whose lead last changed it. */
export function studioOf(leads: readonly Agent[]): { lead: Agent; studio: Studio } | undefined {
  let best: { lead: Agent; studio: Studio } | undefined;
  for (const lead of leads) {
    const studio = lead.lead?.studio;
    if (studio && (!best || studio.at > best.studio.at)) best = { lead, studio };
  }
  return best;
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

/** The studio's gaps as lights: answered ones went up, dropped ones down. */
export function gapLights(gaps: readonly StudioGap[]): Lit[] {
  return gaps.map((g) => ({
    id: g.id,
    text: g.text,
    label: `Gap ${g.id}`,
    ...(g.closed && { settled: g.closed.as === 'answered' ? ('up' as const) : ('down' as const) }),
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
 * Where each gap's light hangs, either side of the premise: `across` metres round the wall from straight ahead (to the
 * right as you face it), `out` from the wall, `y` up; alternately left and right, at different heights and depths so
 * their tags don't sit on each other.
 */
export const GAP_SLOTS: readonly { across: number; out: number; y: number }[] = [
  { across: -4.6, out: 1.6, y: 3.6 },
  { across: 4.6, out: 1.9, y: 3.9 },
  { across: -5.6, out: 2.2, y: 3.0 },
  { across: 5.6, out: 1.5, y: 3.2 },
  { across: -4.9, out: 1.2, y: 4.7 },
  { across: 4.9, out: 1.3, y: 4.8 },
  { across: -6.4, out: 1.8, y: 4.2 },
  { across: 6.4, out: 2.1, y: 4.3 },
];

/** Where the beats' row of cards starts (its first card's left edge), in radians round from straight ahead. */
export function beatsFrom(count: number): number {
  const { card, gap, cardR } = STUDIO_WALL;
  return -(count * card + (count - 1) * gap) / 2 / cardR;
}
