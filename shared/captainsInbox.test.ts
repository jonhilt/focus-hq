import { describe, expect, it } from 'vitest';
import { answerText, decideOf, decideRefusal, hailKey, inboxItem, landed, recentDecisions } from './captainsInbox';
import type { LedgerEvent } from './ledger';
import type { Attention } from './tricorder';
import type { Agent, PullRequest } from './types';

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
    for (const bad of [null, {}, { text: '  ' }, { close: 'yes' }, { allow: 'true' }]) expect(() => decideOf(bad)).toThrow(/allow, option, text or close/);
  });

  it('only answers an item with what fits it', () => {
    expect(decideRefusal('hand', { allow: true })).toBeNull();
    expect(decideRefusal('hand', { text: 'ok' })).toMatch(/approved or declined/);
    expect(decideRefusal('turn', { allow: true })).toMatch(/Only a raised hand/);
    expect(decideRefusal('question', { option: 'a' })).toBeNull();
    expect(decideRefusal('question', { text: 'Neither' })).toBeNull();
    expect(decideRefusal('turn', { option: 'a' })).toMatch(/Only a question/);
    expect(decideRefusal('wrap-up', { close: true })).toBeNull();
    expect(decideRefusal('wrap-up', { text: 'One more thing' })).toBeNull();
    expect(decideRefusal('turn', { close: true })).toMatch(/ready to close/);
    expect(decideRefusal('qa', { text: 'merge' })).toMatch(/on the board/);
  });

  it('says what was decided in a few words', () => {
    expect(answerText({ allow: true })).toBe('Approved');
    expect(answerText({ option: 'b', note: 'cheaper' })).toBe('Picked B: cheaper');
    expect(answerText({ close: true })).toBe('Closed the goal');
    expect(answerText({ text: 'Go on' })).toBe('Go on');
  });

  it('counts an answer as given unless the office came back to ask about cost, or warn before closing', () => {
    expect(landed({ sent: true })).toBe(true);
    expect(landed(undefined)).toBe(true);
    expect(landed({ costly: { usd: 3 } })).toBe(false);
    expect(landed({ warn: ['unmerged PR'] })).toBe(false);
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
    expect(inboxItem({ kind: 'question', agent: lead }, new Map())).toEqual({
      id: 'question:a1:q1', kind: 'question', projectId: 'p', agentId: 'a1', who: 'Ada', goal: 'Saved items', what: 'Pick: Which layout?', since: 50,
      options: [{ id: 'a', label: 'Cards', detail: 'Friendlier' }, { id: 'b', label: 'List' }],
    });
  });

  it('marks a turn the captain has read, and dates a hand from when it went up', () => {
    const read = agent({ lead: { title: 'Saved items', readTurn: 50 } as never });
    expect(inboxItem({ kind: 'turn', agent: read }, new Map())).toMatchObject({ read: true, since: 50, goal: 'Saved items' });
    const hand = agent({ task: 'issue', permission: { id: 'r1', at: 70, summary: 'npm publish' } as never });
    expect(inboxItem({ kind: 'hand', agent: hand }, new Map())).toMatchObject({ since: 70, goal: 'Wishlist', what: 'Approve: npm publish' });
  });

  it('names a pull request’s by the PR, with no agent', () => {
    expect(inboxItem({ kind: 'conflicts', projectId: 'p', pr }, new Map())).toEqual({ id: 'conflicts:p:acme/shop#12', kind: 'conflicts', projectId: 'p', who: 'acme/shop#12', goal: 'Save for later', what: 'Resolve conflicts with its base branch' });
  });
});

