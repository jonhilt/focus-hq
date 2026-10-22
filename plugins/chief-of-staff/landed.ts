import type { LedgerEvent } from '../../plugin-api/shared';

// A goal's lead's slice that merged itself in Show (README.md#landed-in-show): the captain is told, on a card of its
// own in Comms, off the badge, and answers Got it, Redirect (words to the lead) or Revert (the lead undoes it as their
// next slice). Worked out from the ledger each time, a `merged` line Ops made in Show that no `captain-decision`
// answers yet, so it keeps nothing and outlives a restart. Pure, so it's tested (landed.test.ts).

/** How long a landed card waits for the captain before it's let go: what landed a week ago is history, not news. */
export const LANDED_DAYS = 7;

/** A slice that landed in Show, waiting for the captain to hear of it. */
export interface LandedItem {
  /** `landed:<projectId>:<repo>#<number>`: what a `captain-decision` answers it by. */
  id: string;
  projectId: string;
  repo: string;
  number: number;
  /** The goal it's a slice of, by title. */
  goal?: string;
  /** Its lead, by agent id: who a Redirect or a Revert goes to. */
  leadId?: string;
  /** Its lead, by name. */
  who: string;
  /** When it merged. */
  at: number;
  /** Why the chief of staff kept it in Show, as it read the ship. */
  why?: string;
}

export const landedId = (projectId: string, repo: string, number: number): string => `landed:${projectId}:${repo}#${number}`;

/** What the captain says to a landed card. */
export type LandedAnswer = { ack: true } | { redirect: string } | { revert: string };

/** A landed card's answer from a request's body: `{ ack: true }`, `{ redirect: "…" }` or `{ revert: "…" }` (the reason may be empty). */
export function landedAnswerOf(body: Record<string, unknown>): LandedAnswer {
  if (typeof body.redirect === 'string') {
    if (!body.redirect.trim()) throw new Error('Say what the lead should do instead');
    return { redirect: body.redirect.trim() };
  }
  if (typeof body.revert === 'string') return { revert: body.revert.trim() };
  if (body.ack === true) return { ack: true };
  throw new Error('Answer with ack, redirect or revert');
}

/**
 * The slices that landed in Show in the shown projects (`shown`), newest first, that the captain hasn't answered yet:
 * Ops merged them (`by: office`) within `LANDED_DAYS`. `nameOf` names a lead by agent id, while they're aboard.
 */
export function landedItems(ledger: readonly LedgerEvent[], shown: ReadonlySet<string>, now: number, nameOf: (id: string) => string | undefined): LandedItem[] {
  const answered = new Set(ledger.flatMap((e) => (e.kind === 'captain-decision' && e.item.kind === 'landed' ? [e.item.id] : [])));
  const since = now - LANDED_DAYS * 86_400_000;
  const out: LandedItem[] = [];
  for (const e of ledger) {
    if (e.kind !== 'merged' || e.by !== 'office' || e.lane !== 'show' || e.at < since || !shown.has(e.projectId)) continue;
    const id = landedId(e.projectId, e.repo, e.pr);
    if (answered.has(id)) continue;
    const read = ledger.findLast((r) => r.kind === 'cos-lane' && r.prs.some((p) => p.repo === e.repo && p.pr === e.pr));
    const who = (e.lead && nameOf(e.lead)) ?? (read?.kind === 'cos-lane' ? read.agent : 'A lead');
    out.push({ id, projectId: e.projectId, repo: e.repo, number: e.pr, ...(e.goal && { goal: e.goal }), ...(e.lead && { leadId: e.lead }), who, at: e.at, ...(read?.kind === 'cos-lane' && { why: read.why }) });
  }
  return out.reverse();
}

/** Where a landed slice is, said short: `shop#7`. */
export const landedWhere = (item: Pick<LandedItem, 'repo' | 'number'>): string => `${item.repo.split('/')[1] ?? item.repo}#${item.number}`;

/** What a landed card's answer comes to in the ledger, in a few words. */
export function landedAnswerText(a: LandedAnswer): string {
  if ('redirect' in a) return `Redirect: ${a.redirect}`;
  if ('revert' in a) return a.revert ? `Revert: ${a.revert}` : 'Revert';
  return 'Got it';
}

/** What the lead hears for a Redirect or a Revert, from the captain; nothing for Got it. */
export function landedMessage(item: LandedItem, a: LandedAnswer): string | undefined {
  const where = `${item.repo}#${item.number}`;
  if ('redirect' in a) return `About ${where}, which merged in Show: ${a.redirect}`;
  if ('revert' in a) {
    const why = a.revert ? ` ${a.revert.replace(/[.!?]*$/, '.')}` : '';
    return `Please revert ${where}: it merged in Show and I want it undone.${why} Make the revert your next slice (revert its merge commit, ship it in Ask), and say what went wrong if you can see it.`;
  }
  return undefined;
}
