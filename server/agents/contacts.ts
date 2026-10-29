// The loose threads a goal's lead notices along the way (a question, a risk, an idea off the course): sensor contacts on
// its chart, open while the lead's brief lists them under its loose threads, until the lead takes them off it or the
// captain spins one (or an idea for next) off as a goal. These are the pure decisions; `briefedGoal` in `briefFile.ts`
// and the leads' part call them.

import type { Agent, Contact, LeadWork } from '../../shared/types';
import { notedSlice } from './waypoints';

/** How long a contact's text may be (a longer thread is cut short on the chart), and how many contacts are kept. */
export const CONTACT_LIMITS = { text: 160, kept: 30 } as const;

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
const clip = (text: string) => (text.length <= CONTACT_LIMITS.text ? text : `${text.slice(0, CONTACT_LIMITS.text - 1).trimEnd()}…`);
const key = (text: string) => text.toLowerCase();
const listed = (contacts: readonly Contact[]) => contacts.filter((c) => !c.closed).map((c) => `${c.id} (${c.text})`).join(', ') || 'none';

/**
 * The goal's contacts once Ops has read the loose threads its brief lists: an open one the brief no longer lists is
 * cleared, and a thread it lists that no contact holds is a new one, noticed in the slice a note is about (`notedSlice`:
 * the one that landed, until the next ships). One the captain spun off stays closed while the brief still lists it.
 * Closed ones go first once there are too many to keep. Ids (c1, c2…) are Ops' own: the lead never needs them.
 */
export function threadContacts(work: Pick<LeadWork, 'slice' | 'waypoints' | 'contacts'>, threads: readonly string[], now: number): Contact[] {
  const texts = [...new Map(threads.map((t) => clip(clean(t))).filter(Boolean).map((t) => [key(t), t])).values()];
  const keys = new Set(texts.map(key));
  const slice = notedSlice(work);
  let all = (work.contacts ?? []).map((c): Contact => (!c.closed && !keys.has(key(c.text)) ? { ...c, closed: { as: 'cleared', slice, at: now } } : c));
  for (const text of texts) {
    const latest = all.findLast((c) => key(c.text) === key(text));
    if (latest && (!latest.closed || latest.closed.as === 'spun off')) continue;
    const id = `c${Math.max(0, ...all.map((c) => Number(c.id.slice(1)) || 0)) + 1}`;
    all = [...all, { id, text, slice, at: now }];
  }
  for (let over = all.length - CONTACT_LIMITS.kept; over > 0; over--) {
    const oldest = all.find((c) => c.closed);
    if (!oldest) break;
    all = all.filter((c) => c !== oldest);
  }
  return all;
}

/** The open contact `id`, or why it can't be closed. */
function openContact(contacts: readonly Contact[], id: string): Contact | { error: string } {
  const found = contacts.find((c) => c.id === id.trim());
  if (!found) return { error: `There's no contact ${id}. Open contacts: ${listed(contacts)}.` };
  if (found.closed) return { error: `Contact ${found.id} was already ${found.closed.as}.` };
  return found;
}

/** The contact `id` the captain wants to spin off as a goal of its own, or why they can't: it has to be open. */
export function contactToSpinOff(contacts: readonly Contact[] | undefined, id: string): Contact | { error: string } {
  return openContact(contacts ?? [], id);
}

/**
 * What spinning contact `c` off leaves the goal with, once the new goal has `started` (its lead): its contacts, with `c`
 * closed as spun off in the slice under way and linked to the new lead, and what the goal's lead hears. The new goal
 * goes by `firstWords` until its lead has a title.
 */
export function spunOff(
  work: Pick<LeadWork, 'slice' | 'contacts'>,
  c: Contact,
  started: { agent: Pick<Agent, 'id' | 'lead'> },
  firstWords: string,
  now: number,
): { contacts: Contact[]; note: string } {
  const lead = started.agent;
  const title = lead.lead?.title ?? firstWords;
  const closed = { as: 'spun off' as const, goal: lead.id, title, slice: work.slice, at: now };
  return {
    contacts: (work.contacts ?? []).map((x) => (x.id === c.id && !x.closed ? { ...x, closed } : x)),
    note: `The captain spun one of your loose threads (${c.text}) off as a goal of its own, “${title}”. Leave that thread to the new goal: take it off your brief.`,
  };
}

/**
 * The goal's ideas for next once the captain has spun `idea` off as a goal of its own: it's no longer this goal's to
 * take, or why it can't be (the lead has rewritten them since).
 */
export function spunOffIdea(next: readonly string[] | undefined, idea: string): string[] | { error: string } {
  const all = next ?? [];
  const at = all.findIndex((x) => clean(x) === clean(idea));
  if (at < 0) return { error: 'That idea isn’t one of the lead’s ideas for next any more: they’ve rewritten them since' };
  return all.filter((_, i) => i !== at);
}

/** What the lead hears once the captain has spun one of their ideas for next off as a goal of its own. */
export function spunOffIdeaNote(idea: string, title: string): string {
  return `The captain spun your idea for next (${clean(idea)}) off as a goal of its own, “${title}”. Leave it to the new goal: take it off your brief's ideas for next.`;
}
