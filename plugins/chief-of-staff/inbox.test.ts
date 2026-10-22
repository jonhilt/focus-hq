import { describe, expect, it } from 'vitest';
import type { Agent, Attention, LedgerEvent, PullRequest } from '../../plugin-api/shared';
import { answerText, decideOf, decideRefusal, hailKey, inboxItem, recentDecisions, turnNews, turnStage, waiting } from './inbox';
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
    for (const bad of [null, {}, { text: '  ' }, { close: 'yes' }, { allow: 'true' }, { ack: 'yes' }]) expect(() => decideOf(bad)).toThrow(/allow, option, text, close, send or ack/);
  });

  it('only answers an item with what fits it', () => {
    expect(decideRefusal({ kind: 'hand' }, { allow: true })).toBeNull();
    expect(decideRefusal({ kind: 'hand' }, { text: 'ok' })).toMatch(/approved or declined/);
    expect(decideRefusal({ kind: 'turn' }, { allow: true })).toMatch(/Only a raised hand/);
    expect(decideRefusal({ kind: 'question' }, { option: 'a' })).toBeNull();
    expect(decideRefusal({ kind: 'question' }, { text: 'Neither' })).toBeNull();
    expect(decideRefusal({ kind: 'turn' }, { option: 'a' })).toMatch(/Only a question/);
    expect(decideRefusal({ kind: 'wrap-up' }, { close: true })).toBeNull();
    expect(decideRefusal({ kind: 'wrap-up' }, { text: 'One more thing' })).toBeNull();
    expect(decideRefusal({ kind: 'turn' }, { close: true })).toMatch(/ready to close/);
    expect(decideRefusal({ kind: 'qa' }, { text: 'merge' })).toMatch(/on the board/);
    // the chief of staff's words are sent only for a turn it has words ready for: carry on, or back to the lead
    const cos = (route: 1 | 2 | 3 | 4) => ({ route, ask: 'a', why: 'w', message: 'm' });
    expect(decideRefusal({ kind: 'turn', cos: cos(1) }, { send: true })).toBeNull();
    expect(decideRefusal({ kind: 'turn', cos: cos(4) }, { send: true })).toBeNull();
    expect(decideRefusal({ kind: 'turn', cos: cos(2) }, { send: true })).toMatch(/words ready/);
    expect(decideRefusal({ kind: 'turn' }, { send: true })).toMatch(/words ready/);
    expect(decideRefusal({ kind: 'turn', cos: cos(1) }, { text: 'No, stop' })).toBeNull();
    // any lead's turn is acknowledged, judged or not; nothing else is
    expect(decideRefusal({ kind: 'turn' }, { ack: true })).toBeNull();
    expect(decideRefusal({ kind: 'turn', cos: cos(2) }, { ack: true })).toBeNull();
    for (const kind of ['hand', 'question', 'wrap-up', 'error', 'qa'] as const) expect(decideRefusal({ kind }, { ack: true })).toMatch(/Only a lead’s turn is acknowledged/);
  });

  it('says what was decided in a few words', () => {
    expect(answerText({ allow: true })).toBe('Approved');
    expect(answerText({ option: 'b', note: 'cheaper' })).toBe('Picked B: cheaper');
    expect(answerText({ close: true })).toBe('Closed the goal');
    expect(answerText({ text: 'Go on' })).toBe('Go on');
    expect(answerText({ send: true })).toBe('Sent the chief of staff’s words');
    expect(answerText({ ack: true })).toBe('Acknowledged');
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
    });
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
    expect(inboxItem({ kind: 'conflicts', projectId: 'p', pr }, new Map(), 0)).toEqual({ id: 'conflicts:p:acme/shop#12', kind: 'conflicts', projectId: 'p', who: 'acme/shop#12', goal: 'Save for later', what: 'Resolve conflicts with its base branch', lane: 'needs-you' });
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

  it('reads only a lead’s turn: a hand they raise needs the captain whatever it judged', () => {
    const hand = lead('a', judged(1), { permission: { id: 'r1', at: 1500, summary: 'npm publish' } as never });
    expect(inboxItem({ kind: 'hand', agent: hand }, new Map(), 2000)).toMatchObject({ lane: 'needs-you', what: 'Approve: npm publish' });
  });

  it('lists what needs the captain first, then turns they’ve read, then what’s ready or being read', () => {
    const leads = [lead('ready', judged(1)), lead('reading', { at: 1000 }), lead('card', judged(2)), lead('read', undefined), lead('plain')];
    leads[3] = lead('read', undefined, { lead: { title: 'read', readTurn: 1000 } as never });
    const order = waiting(leads, [], new Map(), leads, 2000).map((a) => ('agent' in a ? a.agent.id : ''));
    expect(order).toEqual(['card', 'plain', 'read', 'ready', 'reading']);
  });

  it('leaves out a turn the captain acknowledged, read or not, in any lane, until the lead’s next turn', () => {
    const set = (id: string, read: object) => lead(id, { ...read, acked: 1500 }, { lead: { title: id, readTurn: 1000, marks: { [CHIEF_OF_STAFF]: { ...read, acked: 1500 } } } as never });
    const leads = [lead('card', judged(2)), set('card-set', judged(2)), set('ready-set', judged(1)), set('reading-set', { at: 1000 }), lead('unread-set', { at: 1, acked: 1500 })];
    expect(waiting(leads, [], new Map(), leads, 2000).map((a) => ('agent' in a ? a.agent.id : ''))).toEqual(['card']);
  });
});

describe('the toast as a lead’s turn comes to the captain', () => {
  const at = (status: Agent['status'], cos?: object) => agent({ name: 'Lt. Vale', status, lead: { title: 'g', ...(cos && { marks: { [CHIEF_OF_STAFF]: cos } }) } as never });
  const judged = (route: 1 | 2 | 3 | 4) => ({ at: 1, judged: { route, ask: 'Spend $40?', why: 'w', message: 'm' } });

  it('says a turn no chief of staff reads is waiting, as it ends', () => {
    expect(turnNews('working', at('done'))).toEqual({ level: 'info', text: '🖖 Lt. Vale is waiting for you' });
    expect(turnNews(undefined, at('done'))).toBeNull();
    expect(turnNews('waiting', at('done'))).toBeNull();
  });

  it('says nothing while it’s read, then a card or an interrupt by its line, and nothing for what it would send', () => {
    expect(turnNews('working', at('done', { at: 1 }))).toBeNull();
    expect(turnNews('reading', at('done', judged(3)))).toEqual({ level: 'error', text: '🚨 Lt. Vale: Spend $40?' });
    expect(turnNews('reading', at('done', judged(2)))).toEqual({ level: 'info', text: '🗂 Lt. Vale: Spend $40?' });
    expect(turnNews('reading', at('done', judged(1)))).toBeNull();
    expect(turnNews('reading', at('done', judged(4)))).toBeNull();
    expect(turnStage(at('working', judged(3)))).toBe('working');
  });
});

