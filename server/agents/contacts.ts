// The loose threads a goal's lead notices along the way (a question, a risk, an idea off the course): sensor contacts on
// its chart, open until the lead pursues or drops them. The lead logs and closes them through the note tool; these are
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
    const found = all.find((c) => c.id === id.trim());
    if (!found) return { error: `There's no contact ${id}. Open contacts: ${listed(all)}.` };
    if (found.closed) return { error: `Contact ${found.id} was already ${found.closed.as}.` };
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

/** The open contacts, for what the lead hears with the note: so the threads survive a summarised conversation. */
export function contactsForPrompt(contacts: readonly Contact[] | undefined): string | undefined {
  const open = (contacts ?? []).filter((c) => !c.closed);
  if (!open.length) return undefined;
  return `Open contacts (loose threads: close each with the note tool's closeContact when you pursue or drop it):\n${open.map((c) => `- ${c.id}: ${c.text} (noticed in slice ${c.slice})`).join('\n')}`;
}
