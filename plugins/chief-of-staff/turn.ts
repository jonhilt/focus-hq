import { blocks, leadTail, messageFrom, transcriptLines } from '../../plugin-api/server';

// What the chief of staff reads of a lead's turn (README.md): what the lead said since the last message to it, from its
// transcript. The judge reads all of it: clipped to its last 2,000 characters, as the ledger's `captain-replies` keep
// it, a long turn reached the judge from its middle, and its verdict missed what was asked (28 October 2026). Jev
// routes by the clipped end, as it was trained.

/** How much of a turn the judge reads at most, from its end: a guard against a runaway turn, not a clip. */
const TURN_MAX = 50_000;

/** What the lead said this turn, whole and clipped as the ledger keeps it, and the transcript's last line, which names the turn. */
export interface TurnTail {
  text: string;
  clipped: string;
  uuid: string;
}

/**
 * What the lead said since the last message to it (anyone's: the captain's, Ops'), whole and clipped to its end, and
 * the uuid of the transcript's last line. Undefined when the lead said nothing since, or the transcript has no lines.
 */
export function turnTail(jsonl: string): TurnTail | undefined {
  let said: string[] = [];
  let uuid: string | undefined;
  for (const line of transcriptLines(jsonl)) {
    if (line.uuid) uuid = line.uuid;
    if (line.type === 'assistant') {
      for (const b of blocks(line)) if (b.type === 'text' && b.text?.trim()) said.push(b.text.trim());
    } else if (line.type === 'user' && !line.isMeta && blocks(line).some((b) => b.type === 'text' && b.text?.trim() && messageFrom(b.text))) said = [];
  }
  if (!said.length || !uuid) return undefined;
  const all = said.join('\n\n');
  return { text: all.length > TURN_MAX ? `[−${all.length - TURN_MAX}]… ${all.slice(-TURN_MAX)}` : all, clipped: leadTail(said), uuid };
}

/** Claude Code's own words, as the turn's last line, when your plan's limit stops it: "You've hit your session limit · resets 2pm". */
const LIMIT = /(?:^|\n)You['’]ve hit your [^\n·]*limit(?: · [^\n]*)?$/;

/** Whether the turn ended at your plan's usage limit: Ops carries those on itself, so there's nothing to judge. */
export const atUsageLimit = (text: string): boolean => LIMIT.test(text.trim());
