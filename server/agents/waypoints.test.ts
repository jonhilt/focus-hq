import { describe, expect, it } from 'vitest';
import type { Agent, GoalNote, LeadWork } from '../../shared/types';
import { goalRecord, reopenedWork } from './lead';
import { landedWaypoint, nextWaypoints, notedSlice, notedWaypoint, opening, shippedWaypoint, WAYPOINT_LIMITS, withWaypoint } from './waypoints';

const note = (done: string, learned: string[] = []): GoalNote => ({ done, slice: [], learned, next: [] });

describe('waypoints', () => {
  it('adds this slice’s waypoint the first time anything happens in it, starting then', () => {
    expect(withWaypoint({ slice: 2, waypoints: undefined }, 50, (w) => w)).toEqual([{ slice: 2, startedAt: 50 }]);
    const course = [{ slice: 1, startedAt: 10, landedAt: 40 }, { slice: 2, startedAt: 40 }];
    expect(withWaypoint({ slice: 2, waypoints: course }, 50, (w) => ({ ...w, title: 'Header' }))).toEqual([course[0], { slice: 2, startedAt: 40, title: 'Header' }]);
  });

  it('keeps the latest ones when a goal runs long', () => {
    const course = Array.from({ length: WAYPOINT_LIMITS.kept }, (_, i) => ({ slice: i + 1, startedAt: i }));
    const after = withWaypoint({ slice: WAYPOINT_LIMITS.kept + 1, waypoints: course }, 99, (w) => w);
    expect(after).toHaveLength(WAYPOINT_LIMITS.kept);
    expect(after[0].slice).toBe(2);
    expect(after.at(-1)).toEqual({ slice: WAYPOINT_LIMITS.kept + 1, startedAt: 99 });
  });

  it('takes the slice’s intent from what it first shipped with', () => {
    const first = shippedWaypoint({ slice: 1, waypoints: [{ slice: 1, startedAt: 0 }] }, { title: 'Saved items  survive a reload', summary: '## What\n\nSaves **items** to [the store](http://x).\n\nTested by hand.' }, 5);
    expect(first).toEqual([{ slice: 1, startedAt: 0, title: 'Saved items survive a reload', summary: 'Saves items to the store.' }]);
    // shipping again (to fix what QA found) leaves it, as it leaves what the pull requests say
    expect(shippedWaypoint({ slice: 1, waypoints: first }, { title: 'Fix what QA found', summary: 'Handles the empty case.' }, 9)).toEqual(first);
    expect(shippedWaypoint({ slice: 1, waypoints: [{ slice: 1, startedAt: 0 }] }, { title: 'Saved items', summary: '' }, 9)).toEqual([{ slice: 1, startedAt: 0, title: 'Saved items' }]);
  });

  it('cuts a long description at a word', () => {
    const text = 'word '.repeat(100);
    const cut = opening(text, 40);
    expect(cut.length).toBeLessThanOrEqual(40);
    expect(cut).toMatch(/word…$/);
    expect(opening('- one\n- two')).toBe('one two');
    expect(opening('')).toBe('');
  });

  it('puts a lesson the lead adds on this slice’s waypoint, keeping its last few', () => {
    const work = { slice: 2, waypoints: [{ slice: 1, startedAt: 0, landedAt: 5 }, { slice: 2, startedAt: 5, title: 'Header' }], note: note('Saved items work') };
    let after = notedWaypoint(work, { learned: ' The store  is fine ' }, note('Saved items work', ['The store is fine']), 9);
    expect(after?.[1]).toEqual({ slice: 2, startedAt: 5, title: 'Header', learned: ['The store is fine'] });
    for (const line of ['b', 'c', 'd']) after = notedWaypoint({ ...work, waypoints: after }, { learned: line }, note('Saved items work'), 9);
    expect(after?.[1].learned).toEqual(['b', 'c', 'd']);
    // merging old lessons, or a note that changes nothing on the course, leaves the waypoints as they were
    expect(notedWaypoint(work, { allLearned: ['merged'] }, note('Saved items work', ['merged']), 9)).toBe(work.waypoints);
    expect(notedWaypoint(work, { next: ['Header'] }, note('Saved items work'), 9)).toBe(work.waypoints);
  });

  it('puts what the lead notes after a landing on the slice that landed, until the next one ships', () => {
    const landed = { slice: 1, startedAt: 0, landedAt: 5, title: 'Saved items' };
    const work = { slice: 2, waypoints: [landed, { slice: 2, startedAt: 5 }], note: note('Saved items work') };
    expect(notedSlice(work)).toBe(1);
    const after = notedWaypoint(work, { learned: 'The store holds up', done: 'Saved items, in the header' }, note('Saved items, in the header'), 9);
    expect(after).toEqual([{ ...landed, learned: ['The store holds up'], turnedFrom: 'Saved items work' }, { slice: 2, startedAt: 5 }]);
    // once this slice ships, what's noted is about it
    expect(notedSlice({ slice: 2, waypoints: [landed, { slice: 2, startedAt: 5, title: 'Header' }] })).toBe(2);
    // with nothing shipped yet, it's the slice under way
    expect(notedSlice({ slice: 1, waypoints: [{ slice: 1, startedAt: 0 }] })).toBe(1);
    expect(notedSlice({ slice: 3, waypoints: undefined })).toBe(3);
  });

  it('marks a course correction when done changes, from what it was as the slice began', () => {
    const work = { slice: 2, waypoints: [{ slice: 2, startedAt: 5 }], note: note('Push notifications') };
    const turned = notedWaypoint(work, { done: 'A badge' }, note('A badge'), 9);
    expect(turned).toEqual([{ slice: 2, startedAt: 5, turnedFrom: 'Push notifications' }]);
    // changing it again keeps where the slice started from; changing it back is no correction at all
    expect(notedWaypoint({ ...work, waypoints: turned, note: note('A badge') }, { done: 'A badge and a sound' }, note('A badge and a sound'), 9)?.[0].turnedFrom).toBe('Push notifications');
    expect(notedWaypoint({ ...work, waypoints: turned, note: note('A badge') }, { done: 'Push notifications' }, note('Push notifications'), 9)).toEqual([{ slice: 2, startedAt: 5 }]);
    // agreeing done for the first time isn't a correction
    expect(notedWaypoint({ ...work, note: undefined }, { done: 'A badge' }, note('A badge'), 9)).toBe(work.waypoints);
  });

  it('lands the slice when its last pull request does, and starts the next when the lead moves on', () => {
    const work = { slice: 1, waypoints: [{ slice: 1, startedAt: 0, title: 'Saved items' }] };
    const landed = landedWaypoint(work, 20);
    expect(landed).toEqual([{ slice: 1, startedAt: 0, title: 'Saved items', landedAt: 20 }]);
    expect(nextWaypoints({ slice: 1, waypoints: landed }, 30)).toEqual([landed[0], { slice: 2, startedAt: 30 }]);
    // a goal started before waypoints were kept still gets its course from here on
    expect(nextWaypoints({ slice: 3, waypoints: undefined }, 30)).toEqual([{ slice: 3, startedAt: 30, landedAt: 30 }, { slice: 4, startedAt: 30 }]);
  });

  it('travel with a closed goal and come back when it reopens', () => {
    const waypoints = [{ slice: 1, startedAt: 0, landedAt: 5, title: 'Saved items' }, { slice: 2, startedAt: 5 }];
    const work: LeadWork = { station: 1, title: 'Saved items', repos: [{ repo: 'acme/web', folder: 'web', baseBranch: 'main' }], slice: 2, prs: [], waypoints };
    const lead = { id: 'lead_p_1', name: 'Lt. Varga', branch: 'focus/saved-2-ab12', startedAt: 0, lead: work } as Agent;
    const record = goalRecord(lead, 99);
    expect(record.waypoints).toEqual(waypoints);
    expect(reopenedWork(record, 3).waypoints).toEqual(waypoints);
    expect(goalRecord({ ...lead, lead: { ...work, waypoints: undefined } }, 99)).not.toHaveProperty('waypoints');
  });
});
