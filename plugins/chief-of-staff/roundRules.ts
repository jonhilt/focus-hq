import type { Agent, LedgerEvent } from '../../plugin-api/shared';
import { CHIEF_OF_STAFF, MAX_REPLIES, MAX_REPLY_TEXT, type Verdict } from './shared';

// How long a goal's lead has gone back and forth without the captain (README.md#a-cap-on-rounds-without-the-captain):
// each turn it carries on by itself, its words sent or the lead woken for Ops' news, is a round, and after
// `UNATTENDED_ROUNDS` of them in a row the next turn is a card, as `LEAD_FIX_ROUNDS` caps QA's send-backs. Worked out
// from the ledger, so a restart loses nothing. Pure, so it's tested (roundRules.test.ts).

/** How many rounds in a row a lead goes without the captain before their next turn is the captain's. */
export const UNATTENDED_ROUNDS = 3;

/**
 * How many rounds in a row the lead's latest judged turn ends without the captain: its turns judged (`cos-verdict`, by
 * their session) since the captain last decided something of theirs (a `captain-decision` not the chief of staff's own),
 * but the first, which the captain started. A turn that went unjudged (the lead said nothing) isn't a round.
 */
export function unattendedRounds(ledger: readonly LedgerEvent[], lead: Pick<Agent, 'name' | 'projectId' | 'sessionId'>): number {
  let turns = 0;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const e = ledger[i];
    if (e.projectId !== lead.projectId) continue;
    if (e.kind === 'captain-decision' && e.agent === lead.name && e.via !== CHIEF_OF_STAFF) break;
    if (e.kind === 'cos-verdict' && e.sessionId === lead.sessionId) turns++;
  }
  return Math.max(0, turns - 1);
}

/**
 * The verdict the captain's inbox files a turn by, after `rounds` without them: a turn it would carry on or send back
 * is a card once they reach `UNATTENDED_ROUNDS`, its words for the lead offered as a reply rather than sent. The
 * ledger keeps what it judged.
 */
export function capped(verdict: Verdict, rounds: number): Verdict {
  if (rounds < UNATTENDED_ROUNDS || (verdict.route !== 1 && verdict.route !== 4)) return verdict;
  const [first] = verdict.asks;
  const words = verdict.message.length <= MAX_REPLY_TEXT ? [{ label: 'Send its words', text: verdict.message }] : [];
  const replies = [...words, ...(first?.replies ?? [])].slice(0, MAX_REPLIES);
  return {
    route: 2,
    asks: [{ ask: `${rounds} rounds without you: ${first?.ask ?? ''}`, ...(replies.length && { replies }) }],
    why: `${rounds} rounds in a row went back and forth without you, so this one waits for you. ${verdict.why}`,
    message: `It would tell the lead: “${verdict.message}”`,
  };
}
