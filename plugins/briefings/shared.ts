// The briefings plugin's parts its server and browser share (README.md): the beats as the screen hears of them from the
// player, and what a new version of a briefing changed.

/** The plugin's id, as FOCUS_PLUGINS and a project's settings name it. */
export const BRIEFINGS = 'briefings';

/** A briefing's beats as the screen hears of them from its player: each one's line (its narration) and title. */
export interface BriefingBeats {
  lines: string[];
  titles?: string[];
}

/**
 * The first beat a new version of a briefing changed (its line or title differs, or it's new), counted from 0; -1 when
 * every beat reads as it did (only the stage changed, say), or there was nothing before to compare it with.
 */
export function firstChangedBeat(before: BriefingBeats | undefined, after: BriefingBeats): number {
  if (!before) return -1;
  const differs = (i: number) => before.lines[i] !== after.lines[i] || (before.titles?.[i] ?? '') !== (after.titles?.[i] ?? '');
  for (let i = 0; i < after.lines.length; i++) if (i >= before.lines.length || differs(i)) return i;
  return -1;
}
