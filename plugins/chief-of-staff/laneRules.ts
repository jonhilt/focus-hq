import type { Agent, Attention, Lane as PrLane, LedgerEvent, PullRequest, QaReview } from '../../plugin-api/shared';
import { ACTIVE_STATUSES, higherLane, laneName, needLine, needsYou } from '../../plugin-api/shared';
import { forLead } from './cosRules';
import { AUTO_SEND_MS, type CosRead, JUDGING_MS, readOf, type Verdict } from './shared';
import { headlineOf } from './askRules';

// Where a hail goes in the captain's inbox once the chief of staff reads the leads' turns (README.md), and its read of a
// turn as it changes: being read, judged, its words held. And which of a lead's pull requests it has still to read for
// their lane (README.md#raising-a-pull-requests-lane), or must take a lost raise on again. Pure, so it's tested
// (laneRules.test.ts).

/**
 * Where a hail goes: `needs-you` (counted, and on the badge), `ready` (a lead's turn it would carry on or send back to
 * the lead, its words ready for the captain to send) or `judging` (a lead's turn it's reading, for up to `JUDGING_MS`;
 * then it needs the captain, judged or not). Only a lead's turn has its read; everything else needs the captain.
 */
export type Lane = 'needs-you' | 'ready' | 'judging';

export function laneOf(a: Attention, now: number): Lane {
  const read = a.kind === 'turn' ? readOf(a.agent) : undefined;
  if (!read) return 'needs-you';
  if (!read.judged) return now - read.at < JUDGING_MS ? 'judging' : 'needs-you';
  return forLead(read.judged) ? 'ready' : 'needs-you';
}

/** What needs the captain now: every hail (`needsYou`) but the turns it's reading or has words ready for, or they acknowledged. */
export function needingYou(agents: Agent[], prs: { projectId: string; pr: PullRequest & { resolver?: Agent } }[], reviews: ReadonlyMap<string, QaReview>, now: number): Attention[] {
  return needsYou(agents, prs, reviews).filter((a) => laneOf(a, now) === 'needs-you' && !(a.kind === 'turn' && readOf(a.agent)?.acked !== undefined));
}

/** What a hail needs, in a line: a lead's turn as it judged it (an interrupt, a card, or its words ready), when it has. */
export function lineOf(a: Attention, reviews: ReadonlyMap<string, QaReview>): { icon: string; what: string } {
  const judged = a.kind === 'turn' ? readOf(a.agent)?.judged : undefined;
  if (!judged) return needLine(a, reviews);
  return { icon: { 1: '▶', 2: '🗂', 3: '🚨', 4: '↩' }[judged.route], what: headlineOf(judged.asks) };
}

/** Whether Ops' news for a lead can wake them: `now`, `once-judged` (it's still reading their turn) or `no`. */
export type Waking = 'now' | 'once-judged' | 'no';

/**
 * Whether Ops' news can wake a goal's lead, or the captain owes them an answer: their turn has ended waiting on the
 * captain (a card, an interrupt, a turn it hasn't judged, a question, a goal ready to close, an error) and nobody's
 * answered it, read or not, or the captain stopped them. Waking them then would start their next turn, and what waited
 * would go from the captain's inbox unanswered (or the stop be undone), so the news waits for the captain's next
 * message. A turn it would carry on or send back owes the captain nothing, read or not; one it's still reading may yet
 * be a card, so the news waits until it's judged.
 */
export function waking(lead: Agent, now: number): Waking {
  // at work or about to be (a raised hand mid-turn included), a message goes into their turn: nothing of the captain's goes
  if (lead.status === 'queued' || ACTIVE_STATUSES.includes(lead.status)) return 'now';
  // stopped by the captain (or a plan's limit), or in error: only the captain carries them on
  if (lead.status !== 'done') return 'no';
  // a question, a goal ready to close: the captain's whatever it made of the turn
  const [hail] = needsYou([lead], [], new Map());
  if (hail && hail.kind !== 'turn') return 'no';
  // its read of the turn, whether the captain has read the turn or not (`needsYou` leaves a read turn out); one they
  // acknowledged owes them nothing (they've had their say: Got it), so news carries the lead on, as the captain's
  // standing order to carry on by default has it
  const read = readOf(lead);
  if (read?.acked !== undefined) return 'now';
  if (read?.judged) return forLead(read.judged) ? 'now' : 'no';
  return read && now - read.at < JUDGING_MS ? 'once-judged' : 'no';
}

/** Its read of a turn that's just ended, at `now`: being read. */
export const reading = (now: number): CosRead => ({ at: now });

/**
 * Its read once it's judged the turn, or nothing when the verdict comes too late: the turn's already judged, or it's
 * an earlier turn's (its judging began, `since`, before this one ended). Its words sending a turn back to the lead, in
 * a project where it sends them itself (`autoSend`), go after `AUTO_SEND_MS`; it never carries a lead on by itself,
 * so words that would are only ever the captain's to send (README.md#what-it-does-with-a-turn).
 */
export function judged(read: CosRead | undefined, verdict: Verdict, since: number, autoSend: boolean, now: number): CosRead | undefined {
  if (!read || read.judged || since < read.at) return undefined;
  return { ...read, judged: verdict, ...(autoSend && verdict.route === 4 && read.acked === undefined && { sendsAt: now + AUTO_SEND_MS }) };
}

/**
 * Its read once the captain acknowledges the turn (Got it) at `now`: whatever it made of the turn kept, its words no
 * longer going by themselves. With no read of the turn (it's off for the project, say), one is begun from when the
 * turn ended (`ended`), so the acknowledgement is kept until the lead's next turn all the same.
 */
export function acked(read: CosRead | undefined, ended: number, now: number): CosRead {
  const { sendsAt: _, ...rest } = read ?? { at: ended };
  return { ...rest, acked: now };
}

/** Its read with its words held for the captain, or nothing when they weren't going by themselves. */
export function held(read: CosRead | undefined): CosRead | undefined {
  if (read?.sendsAt === undefined) return undefined;
  const { sendsAt: _, ...rest } = read;
  return rest;
}

type ShipPr = { repo: string; number: number; sha?: string; lane?: PrLane; outcome?: unknown };

/** A goal's lead's pull request, as the lead's work has it. */
export type GoalPr = NonNullable<Agent['lead']>['prs'][number];

/** A pull request a lane read could still raise: open, in Ship or Show. Ask is as high as it goes. */
const raisable = (p: ShipPr): boolean => !p.outcome && (p.lane === 'ship' || p.lane === 'show');

type LaneRead = Extract<LedgerEvent, { kind: 'cos-lane' }>;

/** The latest `cos-lane` line that read this pull request at the commit it's at now, if one has. */
const readAt = (ledger: readonly LedgerEvent[], p: ShipPr): LaneRead | undefined =>
  ledger.findLast((e): e is LaneRead => e.kind === 'cos-lane' && e.prs.some((r) => r.repo === p.repo && r.pr === p.number && r.sha === p.sha));

/** Whether a read took this pull request higher than the lane it's in: the raise was lost (Focus went down before it was saved). */
const unapplied = (read: LaneRead, p: ShipPr): boolean => higherLane(p.lane ?? 'ask', read.to) !== (p.lane ?? 'ask');

/** The lead's pull requests it has still to read: each a read could raise (its recap picked Ship or Show), unread at its commit. */
export function unreadShip(lead: Pick<Agent, 'lead'>, ledger: readonly LedgerEvent[]): GoalPr[] {
  return (lead.lead?.prs ?? []).filter((p) => raisable(p) && !readAt(ledger, p));
}

/** The raises the ledger has that a lead's pull requests don't (lost to a restart), to take again, each on its own pull request. */
export function lostRaises(lead: Pick<Agent, 'lead'>, ledger: readonly LedgerEvent[]): { pr: GoalPr; lane: PrLane; why: string }[] {
  return (lead.lead?.prs ?? []).filter(raisable).flatMap((pr) => {
    const read = readAt(ledger, pr);
    return read && unapplied(read, pr) ? [{ pr, lane: read.to, why: read.why }] : [];
  });
}

/** Why Ops should hold a lead's pull request for now: one a read could raise, not yet read at its commit, or raised by a read and not yet in its lane. */
export function heldForRead(pr: ShipPr | undefined, ledger: readonly LedgerEvent[]): string | undefined {
  if (!pr || !raisable(pr)) return undefined;
  const read = readAt(ledger, pr);
  if (!read) return 'the chief of staff hasn’t read its lane yet';
  return unapplied(read, pr) ? `the chief of staff raised it to ${laneName(read.to)}` : undefined;
}

