import type { LeadWork } from '../../../shared/types';
import { INTERRUPTED_ERROR, type TurnEnding } from '../runJournal';
import type { Target } from '../runMachine';

// What a goal lead's new turn does to the "Close the goal?" card their last one left the user. Pure, so it's unit
// tested (turnStartRules.test.ts); sessions.ts acts on it as each of their turns starts.

/** What the lead's new turn does to their proposal to close the goal. */
export type ClosingAtTurnStart =
  /** Nothing proposed, or the turn picks back up the one a restart cut off as it proposed: it stands. */
  | { kind: 'keep' }
  /** The lead carries on, whoever woke them: the proposal is set aside, and the goal's thread says so (`line`). */
  | { kind: 'set-aside'; line: string };

/** The quiet line the goal's thread shows for a card set aside because the lead carried on (`thread.ts`). */
export const setAsideLine = (card: string, lead: string): string => `✻ ${card} — set aside: ${lead.split(' ').at(-1) ?? lead} carried on`;

/** What the "Close the goal?" card is called in the set-aside line. */
export const WRAP_UP_CARD = 'Close the goal?';

/**
 * Whether a lead's new turn sets aside their proposal to close the goal. Any new turn does, whoever started it (the
 * chief of staff, Ops, QA, the scheduler): the lead is at work again, so the user isn't asked to close a goal under way.
 * The user's own message clears the proposal as it's sent (`Comms.message`), so there's nothing left to set aside then.
 * One turn doesn't: picking back up the turn a restart cut off (`last` ended with no decision, interrupted), as that's
 * where the proposal was made, not a turn after it.
 */
export function closingAtTurnStart(lead: { name: string; closing?: LeadWork['closing'] }, last?: { target?: Target; outcome: TurnEnding }): ClosingAtTurnStart {
  if (!lead.closing) return { kind: 'keep' };
  if (last && last.target === undefined && last.outcome.error === INTERRUPTED_ERROR) return { kind: 'keep' };
  return { kind: 'set-aside', line: setAsideLine(WRAP_UP_CARD, lead.name) };
}
