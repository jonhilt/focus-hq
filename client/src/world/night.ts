import * as THREE from 'three';

// Night on the ship: from evening to morning by the captain's own clock, its lights dim and turn blue, and so do the
// surfaces drawn unlit that stand for lit ones (the decks' ceilings and light panels, the holodecks' skies and ground).
// Screens, LCARS and glows aren't registered, so they stay as bright as ever and stand out in the dark.

/** Hours (local, 0–23) the night starts and ends. */
export const NIGHT_FROM = 20;
export const NIGHT_TO = 7;
/** Seconds the ship takes to dim or brighten all the way. */
export const FADE = 2.5;
/** What a surface dimmed is multiplied by at full night (linear): about a seventh as bright, and bluer. */
export const NIGHT = new THREE.Color().setRGB(0.12, 0.14, 0.22);
/**
 * What a light is: darker still, since by day the office's lights add up to far more than a toon surface shows (its
 * brightest band clips), so a light only a quarter as bright would still leave the walls nearly white.
 */
export const NIGHT_LIGHT = new THREE.Color().setRGB(0.05, 0.06, 0.1);

/** Whether the clock says it's night at `date`. */
export function clockNight(date: Date): boolean {
  const hour = date.getHours();
  return hour >= NIGHT_FROM || hour < NIGHT_TO;
}

/** When the clock next changes over after `date`: this evening, or the morning after. */
export function nextChange(date: Date): Date {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  const hour = date.getHours();
  if (hour >= NIGHT_FROM) next.setDate(next.getDate() + 1);
  next.setHours(clockNight(date) ? NIGHT_TO : NIGHT_FROM);
  return next;
}

/** B pressed: the ship as the captain wants it, until the clock next changes over. */
export interface Override {
  night: boolean;
  /** When it lapses (ms since the epoch), and the clock's back in charge. */
  until: number;
}

/** Whether the ship should be dark at `now`, given the captain's last say (if they've had one). */
export function nightWanted(now: Date, override: Override | null): boolean {
  return override && now.getTime() < override.until ? override.night : clockNight(now);
}

/** What pressing B at `now` leaves: the other of what the ship is now, until the clock next changes over. */
export function toggle(now: Date, override: Override | null): Override {
  return { night: !nightWanted(now, override), until: nextChange(now).getTime() };
}

/** How dark the ship is (0 day, 1 night) `dt` seconds on from `level`, heading for `night`. */
export function fade(level: number, night: boolean, dt: number): number {
  const step = dt / FADE;
  return night ? Math.min(1, level + step) : Math.max(0, level - step);
}

/** Something dimmed at night: its colour, and that colour by day. */
interface Dimmed {
  color: THREE.Color;
  day: THREE.Color;
  night: THREE.Color;
}

const dimmed = new Set<Dimmed>();
const scratch = new THREE.Color();
let level = 0;

function shade(d: Dimmed): void {
  d.color.copy(d.day).multiply(scratch.setRGB(1, 1, 1).lerp(d.night, level));
}

/**
 * Dims `color` at night, from what it is now, until `owner` (the material it's part of) is disposed. For an unlit
 * surface that stands for a lit one: a ceiling, a sky. A light's colour dims the same way, to `NIGHT_LIGHT`.
 */
export function dimsAtNight(color: THREE.Color, owner?: THREE.EventDispatcher<{ dispose: object }>, night = NIGHT): void {
  const d = { color, day: color.clone(), night };
  dimmed.add(d);
  shade(d);
  owner?.addEventListener('dispose', () => dimmed.delete(d));
}

/** Sets how dark the ship is, 0 (day) to 1 (night). */
export function setNightLevel(to: number): void {
  if (to === level) return;
  level = to;
  for (const d of dimmed) shade(d);
}

export function nightLevel(): number {
  return level;
}
