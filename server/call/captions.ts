import type { CallLine } from '../../shared/types';

// A call's captions, built from the transcript fragments the session streams: pure, so it's unit tested
// (captions.test.ts).

/** A fragment within this long of the line before it, from the same speaker, carries that line on. */
export const SAME_LINE_MS = 2_500;
/** The captions kept: the call's latest lines. */
export const MAX_LINES = 40;

/** Adds a fragment of what `who` said (or a note from the office, always a line of its own) at `at`. */
export function addCaption(lines: CallLine[], who: CallLine['who'], fragment: string, at: number): CallLine[] {
  const last = lines.at(-1);
  if (last && last.who === who && who !== 'office' && at - last.at < SAME_LINE_MS) return [...lines.slice(0, -1), { who, text: last.text + fragment, at }];
  const text = fragment.trimStart();
  if (!text) return lines;
  return [...lines, { who, text, at }].slice(-MAX_LINES);
}
