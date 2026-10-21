// The demo ship's pace: how fast its pretend agents go, 1 being `pnpm run demo`'s.
// The captain steps it slower or faster along a ladder, from the ready room's settings or with - and = aboard. Pure.

/** The paces it steps through: below 1 is slower than `pnpm run demo`. */
export const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const;

/** The pace a step slower (`by` -1) or faster (+1) than `speed`, from wherever it is on the ladder or between rungs. */
export function nextSpeed(speed: number, by: 1 | -1): number {
  if (by > 0) return SPEEDS.find((s) => s > speed + 1e-9) ?? SPEEDS[SPEEDS.length - 1];
  return [...SPEEDS].reverse().find((s) => s < speed - 1e-9) ?? SPEEDS[0];
}

/** A pace someone asked for, kept to the ladder's range. */
export function clampSpeed(speed: unknown): number {
  const n = typeof speed === 'number' && Number.isFinite(speed) ? speed : 1;
  return Math.min(SPEEDS[SPEEDS.length - 1], Math.max(SPEEDS[0], n));
}

/** A pace as the captain reads it: `1×`, `0.5×`. */
export function paceLabel(speed: number): string {
  return `${Number(speed.toFixed(2))}×`;
}
