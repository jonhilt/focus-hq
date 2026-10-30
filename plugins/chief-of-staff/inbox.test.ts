import { describe, expect, it } from 'vitest';
import type { Agent, Attention, LedgerEvent, PullRequest } from '../../plugin-api/shared';
import { answerText, decideOf, hailKey, inboxItem, recentDecisions } from './inbox';
import { CHIEF_OF_STAFF } from './shared';

const agent = (a: Partial<Agent> = {}): Agent => ({
  id: 'a1', name: 'Ada', projectId: 'p', repo: 'acme/shop', task: 'lead', issue: { number: 0, title: 'Wishlist', url: '' },
  status: 'done', finishedAt: 50, startedAt: 1, ...a,
}) as Agent;
const pr = { repo: 'acme/shop', number: 12, title: 'Save for later' } as PullRequest;
const question = { id: 'q1', question: 'Which layout?', options: [{ id: 'a', label: 'Cards', detail: 'Friendlier' }, { id: 'b', label: 'List' }], at: 1 };

const HOUR = 3_600_000;
const decision = (at: number, answer: string, seq: number): LedgerEvent =>
  ({ kind: 'captain-decision', agent: 'Lt. Vale', item: { id: 'turn:a:1', kind: 'turn', what: 'Waiting for your reply' }, answer, via: 'office', at, projectId: 'p', seq });

describe('deciding an inbox item', () => {
  it('reads a decision from the API’s body, or says what it needs', () => {
    expect(decideOf({ allow: false })).toEqual({ allow: false });
    expect(decideOf({ option: 'b', note: '  quick  ' })).toEqual({ option: 'b', note: 'quick' });
    expect(decideOf({ option: 'b', note: ' ' })).toEqual({ option: 'b' });
    expect(decideOf({ text: ' Go on ' })).toEqual({ text: 'Go on' });
    expect(decideOf({ close: true })).toEqual({ close: true });
    expect(decideOf({ send: true })).toEqual({ send: true });
    expect(decideOf({ ack: true })).toEqual({ ack: true });
    expect(decideOf({ answer: { ask: 1, text: ' Emails first. ' } })).toEqual({ answer: { ask: 1, text: 'Emails first.' } });
    expect(decideOf({ move: 1 })).toEqual({ move: 1 });
    for (const bad of [null, {}, { text: '  ' }, { close: 'yes' }, { allow: 'true' }, { ack: 'yes' }, { answer: { ask: '1', text: 'x' } }, { answer: { ask: 0, text: ' ' } }, { move: '1' }, { move: 0.5 }]) expect(() => decideOf(bad)).toThrow(/allow, option, text, close, send, ack, answer or move/);
  });

  it('says what was decided in a few words', () => {
    expect(answerText({ allow: true })).toBe('Approved');
    expect(answerText({ option: 'b', note: 'cheaper' })).toBe('Picked B: cheaper');
    expect(answerText({ close: true })).toBe('Closed the goal');
    expect(answerText({ text: 'Go on' })).toBe('Go on');
    expect(answerText({ send: true })).toBe('Sent the chief of staff’s words');
    expect(answerText({ ack: true })).toBe('Acknowledged');
    expect(answerText({ answer: { ask: 0, text: 'Emails first.' } })).toBe('Emails first.');
  });
});

describe('what the captain decided lately', () => {
  it('is the last two days’ decisions, newest first', () => {
    const now = 100 * HOUR;
    const ledger = [decision(now - 50 * HOUR, 'old', 1), decision(now - 47 * HOUR, 'kept', 2), { ...decision(now - HOUR, 'x', 3), kind: 'goal-closed' } as unknown as LedgerEvent, decision(now - 1, 'newest', 4)];
    expect(recentDecisions(ledger, now).map((d) => d.answer)).toEqual(['newest', 'kept']);
  });
});

describe('an inbox item', () => {
  it('keeps an id per kind that stays the same while it waits', () => {
    const asking = agent({ lead: { questions: [question] } as never });
    const items: [Attention, string][] = [
      [{ kind: 'hand', agent: agent({ permission: { id: 'r1' } as never }) }, 'hand:a1:r1'],
      [{ kind: 'question', agent: asking }, 'question:a1:q1'],
      [{ kind: 'error', agent: agent() }, 'error:a1:50'],
      [{ kind: 'wrap-up', agent: agent({ lead: { closing: { at: 60 } } as never }) }, 'wrap-up:a1:60'],
      [{ kind: 'turn', agent: agent() }, 'turn:a1:50'],
      [{ kind: 'qa', projectId: 'p', pr }, 'qa:p:acme/shop#12'],
      [{ kind: 'conflicts', projectId: 'p', pr }, 'conflicts:p:acme/shop#12'],
    ];
    for (const [a, id] of items) expect(hailKey(a)).toBe(id);
  });

  it('says who, the goal, what’s needed and since when, with a question’s options', () => {
    const lead = agent({ lead: { title: 'Saved items', questions: [question] } as never });
    expect(inboxItem({ kind: 'question', agent: lead }, new Map(), 0)).toEqual({
      id: 'question:a1:q1', kind: 'question', projectId: 'p', agentId: 'a1', who: 'Ada', goal: 'Saved items', what: 'Pick: Which layout?', since: 50, lane: 'needs-you',
      options: [{ id: 'a', label: 'Cards', detail: 'Friendlier' }, { id: 'b', label: 'List' }],
      mentions: [{ kind: 'question', id: 'q1' }],
    });
  });

  it('carries what it mentions, by reference: the lead’s open pull requests, the slice’s exhibits and their open question', () => {
    const lead = agent({ lead: { title: 'Saved items', slice: 2, prs: [{ repo: 'acme/shop', number: 9, url: '' }], artifacts: [{ id: 'mockup', title: 'Mockup', at: 40, slice: 2 }] } as never });
    expect(inboxItem({ kind: 'turn', agent: lead }, new Map(), 0).mentions).toEqual([
      { kind: 'pr', id: 'acme/shop#9', repo: 'acme/shop', number: 9 },
      { kind: 'artifact', id: 'mockup' },
    ]);
    expect(inboxItem({ kind: 'error', agent: lead }, new Map(), 0)).not.toHaveProperty('mentions');
  });

  it('carries what the lead said last and showed this turn, given their terminal', () => {
    const lead = agent({ lead: { title: 'Saved items', artifacts: [{ id: 'flow', title: 'How a save travels', at: 40, image: true }] } as never });
    const lines = [{ kind: 'manager', text: '▶ Captain: go', t: 10 }, { kind: 'text', text: 'Slice 1 is up. Shall I start slice 2?', t: 45 }] as never;
    expect(inboxItem({ kind: 'turn', agent: lead }, new Map(), 0, lines)).toMatchObject({
      said: 'Slice 1 is up. Shall I start slice 2?',
      shown: [{ title: 'How a save travels', html: '/api/artifacts/a1/flow.html?v=40', image: '/api/artifacts/a1/flow.jpg?v=40' }],
    });
    expect(inboxItem({ kind: 'turn', agent: lead }, new Map(), 0)).not.toHaveProperty('said');
  });

  it('marks a turn the captain has read, and dates a hand from when it went up', () => {
    const read = agent({ lead: { title: 'Saved items', readTurn: 50 } as never });
    expect(inboxItem({ kind: 'turn', agent: read }, new Map(), 0)).toMatchObject({ read: true, since: 50, goal: 'Saved items' });
    const hand = agent({ task: 'issue', permission: { id: 'r1', at: 70, summary: 'npm publish' } as never });
    expect(inboxItem({ kind: 'hand', agent: hand }, new Map(), 0)).toMatchObject({ since: 70, goal: 'Wishlist', what: 'Approve: npm publish' });
  });

  it('names a pull request’s by the PR, with no agent', () => {
    expect(inboxItem({ kind: 'conflicts', projectId: 'p', pr }, new Map(), 0)).toEqual({ id: 'conflicts:p:acme/shop#12', kind: 'conflicts', projectId: 'p', who: 'acme/shop#12', goal: 'Save for later', what: 'Resolve conflicts with its base branch', lane: 'needs-you', mentions: [{ kind: 'pr', id: 'acme/shop#12', repo: 'acme/shop', number: 12 }] });
  });
});

describe('a lead’s turn and the chief of staff', () => {
  const judged = (route: 1 | 2 | 3 | 4) => ({ at: 1000, judged: { route, ask: route === 3 ? 'Spend $40 on paid runs?' : 'Carry on to the settings page', why: 'w', message: 'Go on to the settings page.' } });
  const lead = (id: string, cos?: object, more: Partial<Agent> = {}) => agent({ id, finishedAt: 1000, lead: { title: id, ...(cos && { marks: { [CHIEF_OF_STAFF]: cos } }) } as never, ...more });

  it('holds a turn back while it’s being read, for a minute, then lets it hail unjudged', () => {
    const reading = lead('a', { at: 1000 });
    expect(inboxItem({ kind: 'turn', agent: reading }, new Map(), 1000 + 59_999)).toMatchObject({ lane: 'judging', what: 'Waiting for your reply' });
    expect(inboxItem({ kind: 'turn', agent: reading }, new Map(), 1000 + 60_000)).toMatchObject({ lane: 'needs-you', what: 'Waiting for your reply' });
  });

  it('files a card or an interrupt under needs you, headed by its line, and carry-on or back-to-lead as ready to send', () => {
    expect(inboxItem({ kind: 'turn', agent: lead('a', judged(3)) }, new Map(), 2000)).toMatchObject({ lane: 'needs-you', what: 'Spend $40 on paid runs?', cos: { route: 3 } });
    expect(inboxItem({ kind: 'turn', agent: lead('a', judged(2)) }, new Map(), 2000).lane).toBe('needs-you');
    expect(inboxItem({ kind: 'turn', agent: lead('a', judged(1)) }, new Map(), 2000)).toMatchObject({ lane: 'ready', what: 'Carry on to the settings page', cos: { message: 'Go on to the settings page.' } });
    expect(inboxItem({ kind: 'turn', agent: lead('a', judged(4)) }, new Map(), 2000).lane).toBe('ready');
  });

  it('heads a turn of several asks by its first, saying how many more, with the answers held so far', () => {
    const asks = [{ ask: 'Next slice: shared link or emails?', replies: [{ label: 'Emails', text: 'Emails first.' }] }, { ask: 'Keep the old endpoint?' }, { ask: 'Rename the setting?' }];
    const item = inboxItem({ kind: 'turn', agent: lead('a', { at: 1000, judged: { route: 2, asks, why: 'w', message: 'm' }, answers: [{ ask: 1, text: 'Keep it.' }] }) }, new Map(), 2000);
    expect(item).toMatchObject({ lane: 'needs-you', what: 'Next slice: shared link or emails? (+2 more)', answers: [{ ask: 1, text: 'Keep it.' }] });
    // as the API served a turn before there were several: its headline, and no replies sent whole, since each answers one ask
    expect(item.cos).toMatchObject({ asks, ask: 'Next slice: shared link or emails? (+2 more)' });
    expect(item.cos).not.toHaveProperty('replies');
  });

  it('serves a turn of one ask as it always did: its headline and its replies, from a verdict kept before there were several', () => {
    const replies = [{ label: 'Close it', text: 'Close it.' }];
    const item = inboxItem({ kind: 'turn', agent: lead('a', { at: 1000, judged: { route: 2, ask: 'Close the goal?', why: 'w', message: 'm', replies } }) }, new Map(), 2000);
    expect(item.cos).toEqual({ route: 2, asks: [{ ask: 'Close the goal?', replies }], ask: 'Close the goal?', replies, why: 'w', message: 'm' });
    expect(item).not.toHaveProperty('answers');
  });

  it('reads only a lead’s turn: a hand they raise needs the captain whatever it judged', () => {
    const hand = lead('a', judged(1), { permission: { id: 'r1', at: 1500, summary: 'npm publish' } as never });
    expect(inboxItem({ kind: 'hand', agent: hand }, new Map(), 2000)).toMatchObject({ lane: 'needs-you', what: 'Approve: npm publish' });
  });
});
