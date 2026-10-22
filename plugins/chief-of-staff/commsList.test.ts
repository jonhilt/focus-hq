import { describe, expect, it } from 'vitest';
import type { DecisionEvent, InboxItem } from './inbox';
import { decidedBy, decidedByCaptain, lanes, perProject, readingLine, sendsIn, sentByCos, stepped, tagOf, trayLine, waited } from './commsList';

const item = (over: Partial<InboxItem>): InboxItem => ({ id: 'x', kind: 'turn', projectId: 'p', who: 'Ada', goal: 'Wishlist', what: 'w', lane: 'needs-you', ...over });
const cos = (route: 1 | 2 | 3 | 4) => ({ route, ask: 'a', why: 'w', message: 'm' });

describe('Comms list', () => {
  it('tags a turn by how the chief of staff judged it, and anything else by what it asks', () => {
    expect(tagOf(item({ cos: cos(3) }))).toBe('Interrupt');
    expect(tagOf(item({ cos: cos(2) }))).toBe('Card');
    expect(tagOf(item({}))).toBe('Reply');
    expect(tagOf(item({ cos: cos(1), lane: 'ready' }))).toBe('Ready');
    expect(tagOf(item({ kind: 'hand' }))).toBe('Approve');
    expect(tagOf(item({ kind: 'qa' }))).toBe('QA');
  });

  it('says how long something has waited in a few characters', () => {
    expect(waited(0, 40_000)).toBe('40s');
    expect(waited(0, 4 * 60_000)).toBe('4m');
    expect(waited(0, 2.6 * 3_600_000)).toBe('2.6h');
    expect(waited(0, 8.5 * 86_400_000)).toBe('8.5d');
  });

  it('lists only what the chief of staff flags, keeps its ready words in the tray, and counts what it is reading', () => {
    const open = [item({ id: 'a' }), item({ id: 'b', lane: 'ready' }), item({ id: 'c', lane: 'judging' }), item({ id: 'd', projectId: 'q' })];
    const all = lanes(open, null);
    expect(all.flagged.map((i) => i.id)).toEqual(['a', 'd']);
    expect(all.ready.map((i) => i.id)).toEqual(['b']);
    expect(all.reading).toBe(1);
    expect(lanes(open, 'q').flagged.map((i) => i.id)).toEqual(['d']);
    expect([...perProject(all.flagged)]).toEqual([['p', 1], ['q', 1]]);
  });

  it('credits a decision to the captain or the chief of staff, and counts what it sent by itself', () => {
    const decided = [{ via: 'chief-of-staff' as const, at: 10 }, { via: 'office' as const, at: 20 }, { via: 'chief-of-staff' as const, at: 1 }];
    expect(decided.map(decidedBy)).toEqual(['Chief of staff', 'You', 'Chief of staff']);
    expect(sentByCos(decided, 5)).toBe(1);
  });

  it('steps through the list round from the end to the start and back, and stays put for no step', () => {
    expect(stepped(2, 1, 3)).toBe(0);
    expect(stepped(0, -1, 3)).toBe(2);
    expect(stepped(1, 1, 3)).toBe(2);
    expect(stepped(1, 0, 3)).toBe(1);
    expect(stepped(1, 1, 0)).toBe(1);
  });

  it('says how many turns it is reading, and nothing when none', () => {
    expect(readingLine(0)).toBe('');
    expect(readingLine(1)).toBe('The chief of staff is reading 1 turn…');
    expect(readingLine(3)).toBe('The chief of staff is reading 3 turns…');
  });

  it('says on its tray’s line what is ready and what it sent itself today, and nothing for neither', () => {
    expect(trayLine(0, 0, false)).toBe('');
    expect(trayLine(2, 0, false)).toBe('Chief of staff: 2 ready to send ›');
    expect(trayLine(0, 3, true)).toBe('Chief of staff: sent 3 by itself today ‹');
    expect(trayLine(1, 1, false)).toBe('Chief of staff: 1 ready to send · sent 1 by itself today ›');
  });

  it('lists what the captain decided themselves, in the project picked, the latest few', () => {
    const d = (via: DecisionEvent['via'], projectId: string, answer: string): DecisionEvent =>
      ({ kind: 'captain-decision', at: 1, seq: 1, via, projectId, agent: 'Ada', answer, item: { id: 'x', kind: 'turn', what: 'w' } });
    const decided = [d('office', 'p', 'a'), d('chief-of-staff', 'p', 'b'), d('api', 'q', 'c'), d('office', 'p', 'd')];
    expect(decidedByCaptain(decided, null, 5).map((e) => e.answer)).toEqual(['a', 'c', 'd']);
    expect(decidedByCaptain(decided, 'p', 5).map((e) => e.answer)).toEqual(['a', 'd']);
    expect(decidedByCaptain(decided, null, 1).map((e) => e.answer)).toEqual(['a']);
  });

  it('says when its words go by themselves, to the minute, and nothing while they wait for the captain', () => {
    expect(sendsIn(undefined, 0)).toBe('');
    expect(sendsIn(120_000, 0)).toBe('⏱ sends itself in 2 min');
    expect(sendsIn(30_000, 0)).toBe('⏱ sends itself within a minute');
  });
});
