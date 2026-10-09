import { describe, expect, it } from 'vitest';
import type { Agent, Contact, LeadWork } from '../../shared/types';
import { applyContacts, CONTACT_LIMITS, contactsForPrompt } from './contacts';
import { goalRecord, noteForPrompt, reopenedWork } from './lead';

const ok = (result: Contact[] | { error: string }): Contact[] => {
  if ('error' in result) throw new Error(result.error);
  return result;
};
const landed = { slice: 1, startedAt: 0, landedAt: 5, title: 'Web push' };

describe('contacts', () => {
  it('logs a loose thread against the slice it was noticed in, numbering them', () => {
    const work = { slice: 1, waypoints: [{ slice: 1, startedAt: 0 }] };
    const first = ok(applyContacts(work, { contact: ' Auth  off the LAN? ' }, 10));
    expect(first).toEqual([{ id: 'c1', text: 'Auth off the LAN?', slice: 1, at: 10 }]);
    const second = ok(applyContacts({ ...work, contacts: first }, { contact: 'Polling drains battery?' }, 11));
    expect(second.map((c) => c.id)).toEqual(['c1', 'c2']);
    // noticed after a landing, before the next slice ships: it belongs to the one that landed
    expect(ok(applyContacts({ slice: 2, waypoints: [landed, { slice: 2, startedAt: 5 }] }, { contact: 'PWA icon blurry' }, 12))[0].slice).toBe(1);
  });

  it('closes one as pursued in the slice under way, or dropped with why', () => {
    const contacts: Contact[] = [{ id: 'c1', text: 'Auth off the LAN?', slice: 1, at: 0 }, { id: 'c2', text: 'Dark mode', slice: 1, at: 0 }];
    const work = { slice: 2, waypoints: [landed, { slice: 2, startedAt: 5 }], contacts };
    const pursued = ok(applyContacts(work, { closeContact: { id: 'c1', as: 'pursued' } }, 20));
    expect(pursued[0].closed).toEqual({ as: 'pursued', slice: 2, at: 20 });
    const dropped = ok(applyContacts(work, { closeContact: { id: 'c2', as: 'dropped', why: 'The system  setting covers it' } }, 20));
    expect(dropped[1].closed).toEqual({ as: 'dropped', why: 'The system setting covers it', slice: 1, at: 20 });
    // closing one and logging another at once
    expect(ok(applyContacts(work, { closeContact: { id: 'c2', as: 'dropped' }, contact: 'Two captains at once?' }, 20)).map((c) => [c.id, !!c.closed])).toEqual([['c1', false], ['c2', true], ['c3', false]]);
  });

  it('refuses what it can’t do, saying which are open', () => {
    const contacts: Contact[] = [{ id: 'c1', text: 'Auth off the LAN?', slice: 1, at: 0 }, { id: 'c2', text: 'Dark mode', slice: 1, at: 0, closed: { as: 'dropped', slice: 1, at: 1 } }];
    const work = { slice: 1, contacts };
    expect(applyContacts(work, { closeContact: { id: 'c9', as: 'dropped' } }, 2)).toEqual({ error: 'There\'s no contact c9. Open contacts: c1 (Auth off the LAN?).' });
    expect(applyContacts(work, { closeContact: { id: 'c2', as: 'pursued' } }, 2)).toEqual({ error: 'Contact c2 was already dropped.' });
    expect(applyContacts(work, { contact: 'auth off the LAN?' }, 2)).toEqual({ error: 'That\'s already open as c1.' });
    expect(applyContacts(work, { contact: 'x'.repeat(CONTACT_LIMITS.text + 1) }, 2)).toHaveProperty('error');
    const full = Array.from({ length: CONTACT_LIMITS.open }, (_, i) => ({ id: `c${i + 1}`, text: `Thread ${i + 1}`, slice: 1, at: 0 }));
    expect(applyContacts({ slice: 1, contacts: full }, { contact: 'One more' }, 2)).toHaveProperty('error');
    // closing one makes room in the same update
    expect(ok(applyContacts({ slice: 1, contacts: full }, { closeContact: { id: 'c1', as: 'dropped' }, contact: 'One more' }, 2))).toHaveLength(CONTACT_LIMITS.open + 1);
  });

  it('forgets the oldest closed ones once there are too many to keep', () => {
    const closed = { as: 'dropped' as const, slice: 1, at: 1 };
    const many = Array.from({ length: CONTACT_LIMITS.kept }, (_, i) => ({ id: `c${i + 1}`, text: `Thread ${i + 1}`, slice: 1, at: 0, ...(i < 25 && { closed }) }));
    const after = ok(applyContacts({ slice: 1, contacts: many }, { contact: 'Another' }, 2));
    expect(after).toHaveLength(CONTACT_LIMITS.kept);
    expect(after[0].id).toBe('c2');
    expect(after.at(-1)).toMatchObject({ id: `c${CONTACT_LIMITS.kept + 1}`, text: 'Another' });
  });

  it('reminds the lead of the open ones with the note', () => {
    const contacts: Contact[] = [{ id: 'c1', text: 'Auth off the LAN?', slice: 1, at: 0 }, { id: 'c2', text: 'Dark mode', slice: 1, at: 0, closed: { as: 'dropped', slice: 1, at: 1 } }];
    expect(contactsForPrompt(contacts)).toBe('Open contacts (loose threads: close each with the note tool\'s closeContact when you pursue or drop it):\n- c1: Auth off the LAN? (noticed in slice 1)');
    expect(contactsForPrompt([contacts[1]])).toBeUndefined();
    expect(noteForPrompt({ title: 'Tricorder', contacts })).toContain('- c1: Auth off the LAN?');
  });

  it('travel with a closed goal and come back when it reopens', () => {
    const contacts: Contact[] = [{ id: 'c1', text: 'Auth off the LAN?', slice: 1, at: 0 }];
    const work: LeadWork = { station: 0, title: 'Tricorder', repos: [{ repo: 'acme/web', folder: 'web', baseBranch: 'main' }], slice: 1, prs: [], contacts };
    const lead = { id: 'lead_p_1', name: 'Lt. Varga', branch: 'focus/tricorder-1-ab12', startedAt: 0, lead: work } as Agent;
    expect(reopenedWork(goalRecord(lead, 9), 2).contacts).toEqual(contacts);
  });
});
