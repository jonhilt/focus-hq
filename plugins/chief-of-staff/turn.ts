import { blocks, leadTail, messageFrom, transcriptLines } from '../../plugin-api/server';

// What the chief of staff reads of a lead's turn (README.md): the end of what the lead said since the last message to
// it, from its transcript, clipped as the ledger's `captain-replies` keep it, so verdicts and replies compare.

/** The end of what the lead said this turn, and the transcript's last line, which names the turn. */
export interface TurnTail {
  text: string;
  uuid: string;
}

/**
 * What the lead said since the last message to it (anyone's: the captain's, Ops'), clipped to its end, and the
 * uuid of the transcript's last line. Undefined when the lead said nothing since, or the transcript has no lines.
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
  return said.length && uuid ? { text: leadTail(said), uuid } : undefined;
}

/** Claude Code's own words, as the turn's last line, when your plan's limit stops it: "You've hit your session limit · resets 2pm". */
const LIMIT = /(?:^|\n)You['’]ve hit your [^\n·]*limit(?: · [^\n]*)?$/;

/** Whether the turn ended at your plan's usage limit: Ops carries those on itself, so there's nothing to judge. */
export const atUsageLimit = (text: string): boolean => LIMIT.test(text.trim());
