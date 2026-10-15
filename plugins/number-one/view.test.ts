import { describe, expect, it } from 'vitest';
import type { NumberOneChat } from './shared';
import { numberOneView, replyNews } from './view';

const chat = (patch: Partial<NumberOneChat>): NumberOneChat => ({ status: 'waiting', activity: '', messages: [], updatedAt: 0, costUsd: 0, ...patch });
const reply = { from: 'number-one' as const, text: 'It starts in the router.', at: 1 };

describe('numberOneView', () => {
  it('thinks aloud with what they are doing', () => {
    expect(numberOneView(chat({ status: 'thinking', activity: 'Reading src/cart.ts' }))).toMatchObject({ status: 'working', icon: '💭', line: 'Reading src/cart.ts', thinking: true });
  });

  it('is ready for you before anything has been said, and waits on you after a reply', () => {
    expect(numberOneView(chat({}))).toMatchObject({ status: 'waiting', line: 'Ready when you are' });
    expect(numberOneView(null)).toMatchObject({ status: 'waiting', line: 'Ready when you are' });
    expect(numberOneView(chat({ messages: [reply] }))).toMatchObject({ status: 'waiting', icon: '🖖', line: 'Your turn' });
  });

  it('shows a failed turn as an error', () => {
    expect(numberOneView(chat({ status: 'failed', error: 'boom', messages: [reply] }))).toMatchObject({ status: 'error', line: 'Lost the thread – say again?' });
  });
});

describe('replyNews', () => {
  it('says so when a reply lands, or the thread is lost', () => {
    expect(replyNews('thinking', chat({ status: 'waiting', messages: [reply] }))).toEqual({ level: 'info', text: '🖖 Cmdr. Adair has an answer for you' });
    expect(replyNews('thinking', chat({ status: 'failed', error: 'boom' }))).toEqual({ level: 'error', text: 'Cmdr. Adair lost the thread: boom' });
  });

  it('says nothing while they think, or when nothing was waiting on them', () => {
    expect(replyNews('thinking', chat({ status: 'thinking' }))).toBeNull();
    expect(replyNews('waiting', chat({ status: 'waiting' }))).toBeNull();
    expect(replyNews(undefined, chat({ status: 'failed' }))).toBeNull();
    expect(replyNews('thinking', null)).toBeNull();
  });
});
