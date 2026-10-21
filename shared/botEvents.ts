import { artifactUrl } from './artifacts';
import type { DecisionEvent, InboxItem } from './captainsInbox';
import type { Agent } from './types';

// What Focus tells a bot speaking for the captain (Grok, over its webhook: docs/ledger.md#the-captains-inbox-api),
// worked out by comparing what's waiting, and what the leads have shown, with how it stood before. Pure, so it's
// tested (botEvents.test.ts); server/bot.ts sends them.

export type BotEvent =
  /** Something needs the captain, or a lead's turn has the chief of staff's words ready: as soon as it's judged. */
  | { event: 'item-opened'; item: InboxItem }
  /** It's no longer waiting: decided (by the captain, a bot or the chief of staff) or withdrawn (it went another way). */
  | { event: 'item-closed'; id: string; how: 'decided'; decision: DecisionEvent }
  | { event: 'item-closed'; id: string; how: 'withdrawn' }
  /** A lead put something on their station's screen (a briefing, a mockup, a diagram): its live page and picture. */
  | { event: 'shown'; projectId: string; agentId: string; who: string; goal: string; title: string; html: string; image?: string };

/** What a bot hears of: waiting items by id (not those the chief of staff is still reading), and the leads' shown things by when. */
export interface BotSeen {
  items: Map<string, InboxItem>;
  shown: Map<string, number>;
}

/** What's waiting now, as a bot hears of it: what the chief of staff is still reading waits until it's judged. */
export const heard = (open: readonly InboxItem[]): Map<string, InboxItem> => new Map(open.filter((i) => i.lane !== 'judging').map((i) => [i.id, i]));

/** What the leads have shown, each by lead and id, with when it was last shown (showing it again is news again). */
export const shownBy = (leads: readonly Agent[]): Map<string, number> =>
  new Map(leads.flatMap((l) => (l.lead?.artifacts ?? []).map((a) => [`${l.id}/${a.id}`, a.at] as const)));

/** The events between how things stood (`before`) and how they stand, with the decisions taken lately to tell decided from withdrawn. */
export function botEvents(before: BotSeen, now: BotSeen, decided: readonly DecisionEvent[], leads: readonly Agent[]): BotEvent[] {
  const events: BotEvent[] = [];
  for (const [id, item] of now.items) if (!before.items.has(id)) events.push({ event: 'item-opened', item });
  for (const id of before.items.keys()) {
    if (now.items.has(id)) continue;
    const decision = decided.find((d) => d.item.id === id);
    events.push(decision ? { event: 'item-closed', id, how: 'decided', decision } : { event: 'item-closed', id, how: 'withdrawn' });
  }
  for (const lead of leads) {
    for (const a of lead.lead?.artifacts ?? []) {
      const key = `${lead.id}/${a.id}`;
      if (now.shown.get(key) !== a.at || before.shown.get(key) === a.at) continue;
      events.push({
        event: 'shown', projectId: lead.projectId, agentId: lead.id, who: lead.name, goal: lead.lead?.title ?? lead.issue.title, title: a.title,
        html: artifactUrl(lead.id, a, 'html'), ...(a.image && { image: artifactUrl(lead.id, a, 'jpg') }),
      });
    }
  }
  return events;
}
