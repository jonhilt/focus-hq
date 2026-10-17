// The loose threads a goal's lead notices along the way (a question, a risk, an idea off the course): sensor contacts on
// its chart, open until the lead pursues or drops them, or the captain spins one (or an idea for next) off as a goal. The lead logs and closes them through the note tool; these are
// the pure decisions, and `notedGoal` in `lead.ts` calls them.

import type { Contact, LeadWork } from '../../shared/types';
import { notedSlice } from './waypoints';

/** How long a contact may be, how many may be open at once (enough to keep threads, too few for a backlog), and how many are kept. */
export const CONTACT_LIMITS = { text: 160, why: 160, open: 8, kept: 30 } as const;

/** What the note tool can do with contacts: log one, close one, or both at once. */
export interface ContactInput {
  contact?: string;
  closeContact?: { id: string; as: 'pursued' | 'dropped'; why?: string };
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
const listed = (contacts: readonly Contact[]) => contacts.filter((c) => !c.closed).map((c) => `${c.id} (${c.text})`).join(', ') || 'none';

/**
 * The goal's contacts after the lead logs or closes one, or why it was refused (then nothing changes). A contact is
 * noticed in the slice the note is about (`notedSlice`: the one that landed, until the next ships), and so is one
 * dropped; one pursued is taken up in the slice under way. Closed ones go first once there are too many to keep.
 */
export function applyContacts(work: Pick<LeadWork, 'slice' | 'waypoints' | 'contacts'>, input: ContactInput, now: number): Contact[] | { error: string } {
  const L = CONTACT_LIMITS;
  let all = work.contacts ?? [];
  if (input.closeContact) {
    const { id, as } = input.closeContact;
    const found = openContact(all, id);
    if ('error' in found) return found;
    const why = clean(input.closeContact.why ?? '');
    if (why.length > L.why) return { error: `Why is ${why.length} characters (at most ${L.why}).` };
    const closed = { as, ...(why && { why }), slice: as === 'pursued' ? work.slice : notedSlice(work), at: now };
    all = all.map((c) => (c === found ? { ...c, closed } : c));
  }
  const text = clean(input.contact ?? '');
  if (text) {
    if (text.length > L.text) return { error: `The contact is ${text.length} characters (at most ${L.text}).` };
    const open = all.filter((c) => !c.closed);
    const same = open.find((c) => c.text.toLowerCase() === text.toLowerCase());
    if (same) return { error: `That's already open as ${same.id}.` };
    if (open.length >= L.open) return { error: `There are ${open.length} open contacts already (at most ${L.open}): pursue or drop one first with closeContact. Open contacts: ${listed(all)}.` };
    const id = `c${Math.max(0, ...all.map((c) => Number(c.id.slice(1)) || 0)) + 1}`;
    all = [...all, { id, text, slice: notedSlice(work), at: now }];
  }
  for (let over = all.length - L.kept; over > 0; over--) {
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

/** Why the captain can't spin contact `id` off as a goal of its own, if they can't: it has to be open. */
export function spinOffRefusal(contacts: readonly Contact[] | undefined, id: string): string | undefined {
  const found = openContact(contacts ?? [], id);
  return 'error' in found ? found.error : undefined;
}

/**
 * The goal's contacts once the captain has spun `id` off as a goal of its own (`goal`, its lead, unless it's waiting in
 * line for a station), in the slice under way.
 */
export function spunOffContacts(work: Pick<LeadWork, 'slice' | 'contacts'>, id: string, to: { goal?: string; title: string }, now: number): Contact[] {
  return (work.contacts ?? []).map((c) => (c.id === id.trim() && !c.closed ? { ...c, closed: { as: 'spun off', ...(to.goal && { goal: to.goal }), title: to.title, slice: work.slice, at: now } } : c));
}

/** What the lead hears once the captain has spun one of their contacts off: it's someone else's now. */
export function spunOffNote(c: Contact, title: string, station: number | undefined): string {
  const where = station === undefined ? 'waiting in line for a team station' : `at team station ${station + 1}`;
  return `The captain spun contact ${c.id} (${c.text}) off as a goal of its own, “${title}”, ${where}. It's closed on your chart: leave that thread to the new goal.`;
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
export function spunOffIdeaNote(idea: string, title: string, station: number | undefined): string {
  const where = station === undefined ? 'waiting in line for a team station' : `at team station ${station + 1}`;
  return `The captain spun your idea for next (${clean(idea)}) off as a goal of its own, “${title}”, ${where}. It's off your ideas for next: leave it to the new goal.`;
}

/** The open contacts, for what the lead hears with the note: so the threads survive a summarised conversation. */
export function contactsForPrompt(contacts: readonly Contact[] | undefined): string | undefined {
  const open = (contacts ?? []).filter((c) => !c.closed);
  if (!open.length) return undefined;
  return `Open contacts (loose threads: close each with the note tool's closeContact when you pursue or drop it):\n${open.map((c) => `- ${c.id}: ${c.text} (noticed in slice ${c.slice})`).join('\n')}`;
}
