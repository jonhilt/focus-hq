import { describe, expect, it } from 'vitest';
import type { InboxItem } from '../../../shared/captainsInbox';
import { decidedBy, lanes, perProject, sentByCos, tagOf, waited } from './commsList';

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
});
