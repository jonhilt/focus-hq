// The briefings plugin's parts its server and browser share (README.md): where the captain was in a briefing when they
// asked about it, what the lead hears of their question, and the beats as the screen hears of them from the player.
import type { GoalArtifact, ResumeCost } from '../../plugin-api/shared';

/** The plugin's id, as FOCUS_PLUGINS and a project's settings name it. */
export const BRIEFINGS = 'briefings';

/** Where the captain was in a briefing (an explainer) when they asked about it: its beat, counted from 0, and that beat's title. */
export interface BriefingSpot {
  beat: number;
  title: string;
}

/**
 * What the lead hears when the captain asks about one of their briefings, up close: which one, the beat they were on,
 * and that the answer is read out in the lead's voice as they write it, so it should be spoken, short and plain.
 */
export function briefingQuestion(briefing: Pick<GoalArtifact, 'id' | 'title'>, spot: BriefingSpot | undefined, question: string): string {
  const where = spot ? `, at beat ${spot.beat + 1}, “${spot.title}”` : '';
  return [
    `A question about your briefing “${briefing.title}” (\`${briefing.id}\`${where}): ${question.trim()}`,
    'I’m listening up close, and what you write back is read out to me in your voice as you write it. Answer in a few spoken sentences: plain words, no code, paths, tables or lists. If you need to look something up first, say so in a line before you do. If a picture would answer it better, answer aloud first, then explain it again under the same id.',
  ].join('\n\n');
}

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

/**
 * What came of a question about a lead's briefing: it went to the lead, who answers as they write; the quick answerer
 * answered it (the lead was busy); or, as for any message, a question for the captain first.
 */
export type BriefingReply = { by: 'lead' } | { by: 'quick'; text: string } | { costly: ResumeCost };

/** The beat a question about a briefing was asked on: { beat, title }, anything else none. */
export const briefingSpot = (v: unknown): BriefingSpot | undefined => {
  if (!v || typeof v !== 'object' || !('beat' in v)) return undefined;
  const { beat } = v;
  if (typeof beat !== 'number' || !Number.isInteger(beat) || beat < 0) return undefined;
  return { beat, title: 'title' in v && typeof v.title === 'string' ? v.title.slice(0, 200) : '' };
};
