import { describe, expect, it } from 'vitest';
import type { CallState, NumberOneChat } from './shared';
import { callOver, callStrip, chatPanel, numberOneView, replyNews, stepLabel } from './view';

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

const call = (patch: Partial<CallState>): CallState => ({ id: 'c1', step: 'listening', lines: [], ...patch });
const line = { who: 'ship' as const, text: 'Aye, captain.', at: 1 };

describe('callStrip', () => {
  it('offers a call once the office can take one, and says why not until then', () => {
    expect(callStrip({ call: null })).toMatchObject({ kind: 'idle', canDial: true, ended: null });
    expect(callStrip({ missing: 'Set an OpenAI key first', call: null })).toMatchObject({ kind: 'idle', canDial: false, dialTitle: 'Set an OpenAI key first' });
    expect(callStrip(undefined)).toMatchObject({ kind: 'idle', canDial: false });
  });

  it('keeps the last call’s captions, with why it ended when it ended badly', () => {
    expect(callStrip({ call: call({ step: 'ended', lines: [line] }) })).toMatchObject({ kind: 'idle', ended: { note: 'The last call:', error: false, lines: [line] } });
    expect(callStrip({ call: call({ step: 'ended', lines: [line], error: 'The line dropped' }) })).toMatchObject({ ended: { note: 'The line dropped', error: true } });
    expect(callStrip({ call: call({ step: 'ended' }) })).toMatchObject({ kind: 'idle', ended: null });
  });

  it('shows a call under way: how it’s going, what it talks through and what waits on the captain', () => {
    expect(callStrip({ call: call({ step: 'confirming', topic: 'the cart', pending: 'Start “Fix the cart”?', capture: 'Go on, I’m listening', lines: [line] }) })).toEqual({
      kind: 'live', id: 'c1', step: 'confirming', label: '📞 Waiting for your yes', lines: [line],
      topic: 'Talking through: the cart', pending: 'Start “Fix the cart”? Say yes, or make it so.', capture: 'Go on, I’m listening',
    });
    expect(callStrip({ call: call({}) })).toMatchObject({ kind: 'live', topic: null, pending: null, capture: null });
  });
});

describe('callOver', () => {
  it('lets go of this browser’s call once the office has none, has another, or ended it', () => {
    expect(callOver('c1', call({}))).toBe(false);
    expect(callOver('c1', null)).toBe(true);
    expect(callOver('c1', undefined)).toBe(true);
    expect(callOver('c2', call({}))).toBe(true);
    expect(callOver('c1', call({ step: 'ended' }))).toBe(true);
  });
});

describe('stepLabel', () => {
  it('checks the captain’s answer while it routes one', () => {
    expect(stepLabel({ step: 'routing', pending: 'Start it?' })).toBe('Checking your answer…');
    expect(stepLabel({ step: 'routing' })).toBe('Working it out…');
  });
});

describe('chatPanel', () => {
  it('says what the chat is for before anything has been said, with nothing to forget', () => {
    expect(chatPanel(null, false)).toMatchObject({ thinking: false, typing: null, failed: null, canStartAfresh: false, cost: '' });
    expect(chatPanel(chat({}), false).intro).toMatch(/^Ask how something works/);
  });

  it('shows Number One typing what they do while they think, and lets the captain start afresh mid-thought', () => {
    expect(chatPanel(chat({ status: 'thinking', activity: 'Reading src/cart.ts' }), false)).toMatchObject({ thinking: true, intro: null, typing: 'Reading src/cart.ts', canStartAfresh: true });
  });

  it('says what went wrong with a failed turn, and what the chat has cost', () => {
    expect(chatPanel(chat({ status: 'failed', error: 'Rate limited', messages: [reply], costUsd: 0.4 }), false)).toMatchObject({
      intro: null, typing: null, failed: 'Rate limited. Say something to carry on.', canStartAfresh: true, cost: '$0.40 so far',
    });
    expect(chatPanel(chat({ status: 'failed' }), false).failed).toBe('Something went wrong. Say something to carry on.');
  });

  it('hints at the mic in voice mode, and at Enter otherwise', () => {
    expect(chatPanel(null, true).placeholder).toMatch(/^Press Mic or Ctrl\+M/);
    expect(chatPanel(null, false).placeholder).toBe('Ask Cmdr. Adair anything… (Enter to send, Shift+Enter for a new line)');
  });
});
