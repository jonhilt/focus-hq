export { lastWords, shownThisTurn } from '../../../shared/leadWords';

// Comms' inbox (commsPanel.ts, needCard.ts), what needs the captain: what it says a lead said last,
// and which item it keeps in front of them as the list changes. Pure, so it's tested (briefing.test.ts).

/**
 * Which of `keys` the briefing shows: the one it showed (`current`) while it's still there; once it's gone (answered),
 * whatever has taken its place (`at`), or the last; -1 with nothing left.
 */
export function focusIndex(keys: readonly string[], current: string | null, at: number): number {
  if (!keys.length) return -1;
  const still = current === null ? -1 : keys.indexOf(current);
  return still >= 0 ? still : Math.min(Math.max(at, 0), keys.length - 1);
}

/**
 * The briefing's order while it's open: what it already had in the order it had them (so reading a lead's turn, which
 * moves it from the hails to the end of the needs, doesn't move it out from under the captain), then anything new in
 * the order it came.
 */
export function keptOrder(before: readonly string[], keys: readonly string[]): string[] {
  const now = new Set(keys);
  const kept = before.filter((k) => now.has(k));
  const had = new Set(kept);
  return [...kept, ...keys.filter((k) => !had.has(k))];
}
