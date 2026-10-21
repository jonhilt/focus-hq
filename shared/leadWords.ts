import type { GoalArtifact, TermLine } from './types';

// What a lead said and showed in the turn that's waiting on the captain, from their terminal: Comms' reading pane and
// the inbox's API both put it in front of them. Pure, so it's tested (client/src/ui/briefing.test.ts).

/**
 * What an agent said last, from its terminal: its last run of text lines, past whatever came after (the office's log
 * of a turn ending, or the tool call a raised hand is for), at most `max` characters of its end, from a whole line.
 */
export function lastWords(lines: readonly TermLine[], max = 1500): string {
  let end = lines.length;
  while (end > 0 && lines[end - 1].kind !== 'text') end--;
  let start = end;
  while (start > 0 && lines[start - 1].kind === 'text') start--;
  const said = lines.slice(start, end).map((l) => l.text).join('\n').trim();
  if (said.length <= max) return said;
  const tail = said.slice(-max);
  const cut = tail.indexOf('\n');
  return `…${cut >= 0 ? tail.slice(cut) : tail}`;
}

/**
 * What a lead showed on their screen during the turn that's waiting on the captain (since the captain last wrote to
 * them, a ▶ line in their terminal), newest first; with no word from the captain in view, only the latest. A lead often asks
 * "A, B or C?" of options it showed rather than asked with pictures, so the briefing puts them in front of the captain.
 */
export function shownThisTurn(artifacts: readonly GoalArtifact[] | undefined, lines: readonly TermLine[]): GoalArtifact[] {
  const newest = [...(artifacts ?? [])].sort((a, b) => b.at - a.at);
  // words to the lead are ▶ lines; the office's own notes of a hand raised or approved, or a question asked, aren't
  const spoke = lines.findLast((l) => l.kind === 'manager' && l.text.startsWith('▶'));
  return spoke ? newest.filter((a) => a.at >= spoke.t) : newest.slice(0, 1);
}
