import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../plugin-api/shared';
import { LANDED_DAYS, landedAnswerOf, landedAnswerText, landedId, landedItems, landedMessage } from './landed';

const NOW = Date.UTC(2026, 9, 22, 12);
let seq = 0;
const merged = (pr: number, more: Partial<Extract<LedgerEvent, { kind: 'merged' }>> = {}): LedgerEvent => ({
  kind: 'merged', repo: 'acme/shop', pr, goal: 'Wishlist', by: 'office', qa: 'passed', failedRounds: 0, triages: 0, lead: 'lead_1', lane: 'show', projectId: 'p', at: NOW - 60_000, seq: ++seq, ...more,
});
const read = (pr: number, why: string): LedgerEvent => ({ kind: 'cos-lane', agent: 'Lt. Vale', goal: 'Wishlist', prs: [{ repo: 'acme/shop', pr, sha: 'abc' }], from: 'show', to: 'show', why, model: 'haiku', version: 'lane-v1', projectId: 'p', at: NOW - 120_000, seq: ++seq });
const decided = (id: string): LedgerEvent => ({ kind: 'captain-decision', agent: 'Lt. Vale', item: { id, kind: 'landed', what: '' }, answer: 'Got it', via: 'office', projectId: 'p', at: NOW, seq: ++seq });
const shown = new Set(['p']);
const nameOf = (id: string) => (id === 'lead_1' ? 'Lt. Vale' : undefined);

describe('what landed in Show for the captain to hear of', () => {
  it('is each lead’s pull request Ops merged in Show, newest first, with why the chief of staff let it', () => {
    const items = landedItems([read(7, 'It only wires parts in.'), merged(7), merged(8, { at: NOW - 30_000 })], shown, NOW, nameOf);
    expect(items.map((i) => i.number)).toEqual([8, 7]);
    expect(items[1]).toEqual({ id: landedId('p', 'acme/shop', 7), projectId: 'p', repo: 'acme/shop', number: 7, goal: 'Wishlist', leadId: 'lead_1', who: 'Lt. Vale', at: NOW - 60_000, why: 'It only wires parts in.' });
  });

  it('isn’t a merge in Ship or Ask, the captain’s own, or anyone’s but a lead’s', () => {
    expect(landedItems([merged(1, { lane: 'ship' }), merged(2, { lane: 'ask' }), merged(3, { by: 'captain' }), merged(4, { lane: undefined, lead: undefined })], shown, NOW, nameOf)).toEqual([]);
  });

  it('leaves once the captain has answered it, after a week, or in a project not shown', () => {
    expect(landedItems([merged(7), decided(landedId('p', 'acme/shop', 7))], shown, NOW, nameOf)).toEqual([]);
    expect(landedItems([merged(7, { at: NOW - LANDED_DAYS * 86_400_000 - 1 })], shown, NOW, nameOf)).toEqual([]);
    expect(landedItems([merged(7)], new Set(), NOW, nameOf)).toEqual([]);
  });

  it('names a lead no longer aboard as the chief of staff’s read did', () => {
    expect(landedItems([read(7, 'Safe.'), merged(7)], shown, NOW, () => undefined)[0].who).toBe('Lt. Vale');
  });
});

describe('the captain’s answer to a landed card', () => {
  const item = landedItems([merged(7)], shown, NOW, nameOf)[0];

  it('is Got it, Redirect with words, or Revert with or without a reason', () => {
    expect(landedAnswerOf({ ack: true })).toEqual({ ack: true });
    expect(landedAnswerOf({ redirect: ' Use the API ' })).toEqual({ redirect: 'Use the API' });
    expect(landedAnswerOf({ revert: '' })).toEqual({ revert: '' });
    expect(() => landedAnswerOf({ redirect: ' ' })).toThrow('Say what the lead should do instead');
    expect(() => landedAnswerOf({})).toThrow('Answer with ack, redirect or revert');
  });

  it('goes in the ledger in a few words', () => {
    expect([landedAnswerText({ ack: true }), landedAnswerText({ redirect: 'Use the API' }), landedAnswerText({ revert: '' }), landedAnswerText({ revert: 'It broke search' })]).toEqual(['Got it', 'Redirect: Use the API', 'Revert', 'Revert: It broke search']);
  });

  it('sends the lead the captain’s words for Redirect and Revert, nothing for Got it', () => {
    expect(landedMessage(item, { ack: true })).toBeUndefined();
    expect(landedMessage(item, { redirect: 'Use the API.' })).toBe('About acme/shop#7, which merged in Show: Use the API.');
    expect(landedMessage(item, { revert: 'It broke search' })).toBe('Please revert acme/shop#7: it merged in Show and I want it undone. It broke search. Make the revert your next slice (revert its merge commit, ship it in Ask), and say what went wrong if you can see it.');
  });
});
