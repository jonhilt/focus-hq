// Which waiting line Kokoro says next. Pure, so it's unit tested (speechRules.test.ts); speech.ts queues the lines and
// has the speech worker say them.

/** How soon a line is wanted: now (an answer, someone talking), or ahead of time (a briefing's next beat, fetched early). */
export type LineUrgency = 'now' | 'ahead';

/**
 * Which waiting line Kokoro says next: the first wanted now, else the first wanted ahead of time. Kokoro says one line
 * at a time, and a briefing fetches its lines ahead, so an answer would otherwise wait behind the narration.
 */
export function nextLine(waiting: readonly { urgency: LineUrgency }[]): number {
  const now = waiting.findIndex((l) => l.urgency === 'now');
  return now >= 0 ? now : waiting.length ? 0 : -1;
}
