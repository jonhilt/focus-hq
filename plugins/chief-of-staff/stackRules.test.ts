import { describe, expect, it } from 'vitest';
import { type Card, cardKey, frontOf, isOpen, MAX_CARDS, pressed } from './stackRules';

const pr: Card = { kind: 'pr', id: 'acme/shop#9', repo: 'acme/shop', number: 9 };
const ex: Card = { kind: 'artifact', id: 'mockup' };
const talk: Card = { kind: 'talk' };
const keys = (stack: readonly Card[]) => stack.map(cardKey);

describe('the stack of cards beside the sheet', () => {
  it('opens a card at the front, the older ones staying behind it, and the same thing opened again is the one card brought forward', () => {
    let stack = pressed([], { kind: 'open', card: pr });
    stack = pressed(stack, { kind: 'open', card: ex });
    expect(keys(stack)).toEqual(['pr:acme/shop#9', 'artifact:mockup']);
    expect(frontOf(stack)).toEqual(ex);
    stack = pressed(stack, { kind: 'open', card: { ...pr } });
    expect(keys(stack)).toEqual(['artifact:mockup', 'pr:acme/shop#9']);
  });

  it('closes a lit mention’s card wherever it is in the stack, and opens an unlit one at the front', () => {
    const stack = [pr, ex, talk];
    expect(isOpen(stack, pr)).toBe(true);
    expect(keys(pressed(stack, { kind: 'toggle', card: pr }))).toEqual(['artifact:mockup', 'talk']);
    const q: Card = { kind: 'question', id: 'q1' };
    expect(isOpen(stack, q)).toBe(false);
    expect(frontOf(pressed(stack, { kind: 'toggle', card: q }))).toEqual(q);
  });

  it('closes the front card on Esc, landing on the one read before, and any card on its ×', () => {
    const stack = [pr, ex, talk];
    expect(frontOf(pressed(stack, { kind: 'close-front' }))).toEqual(ex);
    expect(keys(pressed(stack, { kind: 'close', card: ex }))).toEqual(['pr:acme/shop#9', 'talk']);
    expect(pressed([], { kind: 'close-front' })).toEqual([]);
  });

  it('brings a spine forward, and moves between the cards with ] and [, each undoing the other', () => {
    const stack = [pr, ex, talk];
    expect(keys(pressed(stack, { kind: 'forward', card: pr }))).toEqual(['artifact:mockup', 'talk', 'pr:acme/shop#9']);
    // a card that isn't open isn't opened by bringing it forward
    expect(pressed(stack, { kind: 'forward', card: { kind: 'exhibits' } })).toEqual(stack);
    const next = pressed(stack, { kind: 'cycle', by: 1 });
    expect(frontOf(next)).toEqual(pr);
    expect(pressed(next, { kind: 'cycle', by: -1 })).toEqual(stack);
    expect(pressed([pr], { kind: 'cycle', by: 1 })).toEqual([pr]);
  });

  it('keeps at most a few open, letting the oldest go, and puts them all away with another conn', () => {
    let stack: Card[] = [];
    for (let i = 0; i <= MAX_CARDS; i++) stack = pressed(stack, { kind: 'open', card: { kind: 'artifact', id: `x${i}` } });
    expect(stack).toHaveLength(MAX_CARDS);
    expect(isOpen(stack, { kind: 'artifact', id: 'x0' })).toBe(false);
    expect(pressed(stack, { kind: 'clear' })).toEqual([]);
  });
});
