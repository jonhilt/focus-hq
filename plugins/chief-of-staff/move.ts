import type { Agent } from '../../plugin-api/shared';
import { AUTO_SEND_EVERY, type CosRead, forLead, JUDGING_MS, readOf, type Verdict } from './shared';

// Whether the chief of staff holds a goal's next move, on the screen over its pod (`GoalPart.move`, README.md): while
// it reads the lead's turn, and while its words for the lead count down to sending themselves; or whether it hands the
// move to the captain, for what its read leaves them. Pure, so it's tested (move.test.ts).

/** A countdown's time left, as m:ss, rounded up so it reads 0:00 only once it's up. */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * How long past their time its words may take to go before they're the captain's to send: a few runs of its server
 * part's sending, so a send that keeps failing (or a project where it's stopped sending them) doesn't hold the move.
 */
export const SENDING_MS = 3 * AUTO_SEND_EVERY;

/** Its hold on a goal's move, or the move handed to the captain (`captain`), and why. */
export type CosMove = { why: string; counter?: string; captain?: boolean };

const yours = (why: string): CosMove => ({ why, captain: true });

/**
 * Its words for the lead (carry on, back to the lead) at `now`, going by themselves at `sendsAt` if they do: counting
 * down, going now, or waiting on the captain.
 */
function wordsMove(judged: Verdict, sendsAt: CosRead['sendsAt'], now: number): CosMove {
  const what = `${judged.route === 1 ? 'Carry on' : 'Back to the lead'}: ${judged.ask}`;
  if (sendsAt === undefined || now >= sendsAt + SENDING_MS) return yours(`${what} — ready for you to send from Comms`);
  return { why: now < sendsAt ? `${what} — sends by itself unless you hold it` : `${what} — sending it now`, counter: countdown(sendsAt - now) };
}

/**
 * Its say on `lead`'s next move at `now`, if it has one: it holds it while it reads their ended turn (until
 * `JUDGING_MS`), and while its words for them go by themselves at `sendsAt`, counted down (and a little past, as they
 * go). Otherwise what it read is the captain's, so it hands them the move: a card, an interrupt, words they held (or
 * that don't send themselves, or didn't go), and a turn it took too long to read. Nothing when it has no read.
 */
export function cosMove(lead: Pick<Agent, 'status' | 'lead'>, now: number): CosMove | undefined {
  const read = lead.status === 'done' ? readOf(lead) : undefined;
  if (!read) return undefined;
  const { judged, sendsAt } = read;
  if (!judged) return now - read.at < JUDGING_MS ? { why: 'Reading the turn, to see where it goes' } : yours('The chief of staff couldn’t read the turn in time: it’s yours');
  if (!forLead(judged)) return yours(`${judged.route === 2 ? 'A card' : 'An interrupt'} for you: ${judged.ask}`);
  return wordsMove(judged, sendsAt, now);
}
