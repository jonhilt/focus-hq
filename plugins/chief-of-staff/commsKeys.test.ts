import { describe, expect, it } from 'vitest';
import { commsKey } from './commsKeys';

describe('commsKey', () => {
  it('moves through the queue with J and K, or the arrows', () => {
    expect(commsKey({ key: 'j' }, false)).toEqual({ move: 1 });
    expect(commsKey({ key: 'K' }, false)).toEqual({ move: -1 });
    expect(commsKey({ key: 'ArrowDown' }, false)).toEqual({ move: 1 });
  });

  it('presses the answers it names, and picks options by number', () => {
    expect(commsKey({ key: 'Enter' }, false)).toEqual({ press: 'send' });
    expect(commsKey({ key: 'h' }, false)).toEqual({ press: 'hold' });
    expect(commsKey({ key: 'o' }, false)).toEqual({ press: 'ack' });
    expect(commsKey({ key: 'b' }, false)).toEqual({ press: 'beam' });
    expect(commsKey({ key: 'm' }, false)).toEqual({ press: 'merge' });
    expect(commsKey({ key: 'a' }, false)).toEqual({ press: 'allow' });
    expect(commsKey({ key: 'd' }, false)).toEqual({ press: 'decline' });
    expect(commsKey({ key: '3' }, false)).toEqual({ press: 'pick-3' });
    expect(commsKey({ key: 'r' }, false)).toEqual({ reply: true });
    expect(commsKey({ key: 'g' }, false)).toEqual({ goal: true });
  });

  it('leaves the captain’s writing, other shortcuts and other keys alone', () => {
    expect(commsKey({ key: 'Enter' }, true)).toBeNull();
    expect(commsKey({ key: '1', altKey: true }, false)).toBeNull();
    expect(commsKey({ key: 'r', metaKey: true }, false)).toBeNull();
    expect(commsKey({ key: '0' }, false)).toBeNull();
    expect(commsKey({ key: 'x' }, false)).toBeNull();
  });
});
