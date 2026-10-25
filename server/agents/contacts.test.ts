import { describe, expect, it } from 'vitest';
import type { Contact, LeadAgent, LeadWork } from '../../shared/types';
import { CONTACT_LIMITS, contactToSpinOff, spunOff, spunOffIdea, spunOffIdeaNote, threadContacts } from './contacts';
import { goalRecord, reopenedWork } from './lead';

const landed = { slice: 1, startedAt: 0, landedAt: 5, title: 'Web push' };

describe('contacts', () => {
  it('opens one for each loose thread the brief lists, against the slice it was noticed in, numbering them', () => {
    const work = { slice: 1, waypoints: [{ slice: 1, startedAt: 0 }] };
    const first = threadContacts(work, [' Auth  off the LAN? '], 10);
    expect(first).toEqual([{ id: 'c1', text: 'Auth off the LAN?', slice: 1, at: 10 }]);
    // the same thread again keeps its contact; a new one is numbered on; one listed twice is one
    const second = threadContacts({ ...work, contacts: first }, ['auth off the LAN?', 'Polling drains battery?', 'Polling drains battery?'], 11);
    expect(second.map((c) => [c.id, c.at])).toEqual([['c1', 10], ['c2', 11]]);
    // noticed after a landing, before the next slice ships: it belongs to the one that landed
    expect(threadContacts({ slice: 2, waypoints: [landed, { slice: 2, startedAt: 5 }] }, ['PWA icon blurry'], 12)[0].slice).toBe(1);
    expect(threadContacts(work, [], 12)).toEqual([]);
  });

  it('clears an open one the brief no longer lists, and opens it afresh if it comes back', () => {
    const contacts: Contact[] = [{ id: 'c1', text: 'Auth off the LAN?', slice: 1, at: 0 }, { id: 'c2', text: 'Dark mode', slice: 1, at: 0, closed: { as: 'dropped', slice: 1, at: 1 } }];
    const work = { slice: 2, waypoints: [landed, { slice: 2, startedAt: 5, title: 'Badges' }], contacts };
    const cleared = threadContacts(work, [], 20);
    expect(cleared[0].closed).toEqual({ as: 'cleared', slice: 2, at: 20 });
    expect(cleared[1]).toBe(contacts[1]);
    expect(threadContacts({ ...work, contacts: cleared }, ['Auth off the LAN?'], 21).map((c) => [c.id, c.closed?.as])).toEqual([['c1', 'cleared'], ['c2', 'dropped'], ['c3', undefined]]);
  });

  it('keeps one the captain spun off closed while the brief still lists it', () => {
    const contacts: Contact[] = [{ id: 'c1', text: 'Auth off the LAN?', slice: 1, at: 0, closed: { as: 'spun off', title: 'Auth', slice: 1, at: 1 } }];
    expect(threadContacts({ slice: 1, contacts }, ['Auth off the LAN?'], 2)).toEqual(contacts);
  });

  it('cuts a long thread short on the chart', () => {
    const [c] = threadContacts({ slice: 1 }, ['x'.repeat(CONTACT_LIMITS.text + 40)], 1);
    expect(c.text).toHaveLength(CONTACT_LIMITS.text);
    expect(c.text.endsWith('…')).toBe(true);
  });

  it('spins an open one off as a goal of its own, in the slice under way', () => {
    const contacts: Contact[] = [{ id: 'c1', text: 'Auth off the LAN?', slice: 1, at: 0 }, { id: 'c2', text: 'Dark mode', slice: 1, at: 0, closed: { as: 'dropped', slice: 1, at: 1 } }];
    expect(contactToSpinOff(contacts, ' c1 ')).toBe(contacts[0]);
    expect(contactToSpinOff(contacts, 'c2')).toEqual({ error: 'Contact c2 was already dropped.' });
    expect(contactToSpinOff(undefined, 'c1')).toEqual({ error: 'There\'s no contact c1. Open contacts: none.' });
    // started at a station: linked to its lead, under the lead's title
    const lead = { id: 'lead-p-x', lead: { station: 2, title: 'Auth off the LAN', repos: [], slice: 1, prs: [] } };
    const after = spunOff({ slice: 3, contacts }, contacts[0], { agent: lead }, 'Auth off the LAN? Look into it', 9);
    expect(after.contacts[0].closed).toEqual({ as: 'spun off', goal: 'lead-p-x', title: 'Auth off the LAN', slice: 3, at: 9 });
    expect(after.contacts[1]).toBe(contacts[1]);
    expect(after.note).toBe('The captain spun one of your loose threads (Auth off the LAN?) off as a goal of its own, “Auth off the LAN”, at team station 3. Leave that thread to the new goal: take it off your brief.');
    // waiting in line, it has no lead yet, and goes by its first words
    const queued = spunOff({ slice: 3, contacts }, contacts[0], { queued: { id: 'q1', text: 'Auth off the LAN? Look into it', at: 8 } }, 'Auth off the LAN? Look into it', 9);
    expect(queued.contacts[0].closed).toEqual({ as: 'spun off', title: 'Auth off the LAN? Look into it', slice: 3, at: 9 });
    expect(queued.note).toContain('“Auth off the LAN? Look into it”, waiting in line for a team station.');
  });

  it('spins an idea for next off, taking it off the lead’s ideas', () => {
    const next = ['Show it in the header', 'Tidy the store code'];
    expect(spunOffIdea(next, ' Tidy the  store code')).toEqual(['Show it in the header']);
    expect(spunOffIdea(next, 'Dark mode')).toHaveProperty('error');
    expect(spunOffIdea(undefined, 'Dark mode')).toHaveProperty('error');
    expect(spunOffIdeaNote('Tidy the store code', 'Tidy the store', 0)).toContain('(Tidy the store code) off as a goal of its own, “Tidy the store”, at team station 1');
  });

  it('forgets the oldest closed ones once there are too many to keep', () => {
    const closed = { as: 'dropped' as const, slice: 1, at: 1 };
    const many = Array.from({ length: CONTACT_LIMITS.kept }, (_, i) => ({ id: `c${i + 1}`, text: `Thread ${i + 1}`, slice: 1, at: 0, ...(i < 25 && { closed }) }));
    const after = threadContacts({ slice: 1, contacts: many }, [...many.slice(25).map((c) => c.text), 'Another'], 2);
    expect(after).toHaveLength(CONTACT_LIMITS.kept);
    expect(after[0].id).toBe('c2');
    expect(after.at(-1)).toMatchObject({ id: `c${CONTACT_LIMITS.kept + 1}`, text: 'Another' });
  });

  it('travel with a closed goal and come back when it reopens', () => {
    const contacts: Contact[] = [{ id: 'c1', text: 'Auth off the LAN?', slice: 1, at: 0 }];
    const work: LeadWork = { station: 0, title: 'Tricorder', repos: [{ repo: 'acme/web', folder: 'web', baseBranch: 'main' }], slice: 1, prs: [], contacts };
    const lead = { id: 'lead_p_1', name: 'Lt. Varga', branch: 'focus/tricorder-1-ab12', startedAt: 0, lead: work } as LeadAgent;
    expect(reopenedWork(goalRecord(lead, 9), 2).contacts).toEqual(contacts);
  });
});
