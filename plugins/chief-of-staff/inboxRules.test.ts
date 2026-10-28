import { describe, expect, it } from 'vitest';
import type { Agent } from '../../plugin-api/shared';
import { acknowledged, decideRefusal, turnNews, turnStage, turnToast, waiting } from './inboxRules';
import { CHIEF_OF_STAFF } from './shared';

const agent = (a: Partial<Agent> = {}): Agent => ({
  id: 'a1', name: 'Ada', projectId: 'p', repo: 'acme/shop', task: 'lead', issue: { number: 0, title: 'Wishlist', url: '' },
  status: 'done', finishedAt: 50, startedAt: 1, ...a,
}) as Agent;

describe('deciding an inbox item', () => {
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
});

describe('what waits on the captain', () => {
  it('knows a turn the captain acknowledged, until the lead’s next', () => {
    expect(acknowledged({ lead: { marks: { [CHIEF_OF_STAFF]: { at: 1, acked: 2 } } } as never })).toBe(true);
    expect(acknowledged({ lead: { marks: { [CHIEF_OF_STAFF]: { at: 1 } } } as never })).toBe(false);
    expect(acknowledged({})).toBe(false);
  });

  const judged = (route: 1 | 2 | 3 | 4) => ({ at: 1000, judged: { route, ask: route === 3 ? 'Spend $40 on paid runs?' : 'Carry on to the settings page', why: 'w', message: 'Go on to the settings page.' } });
  const lead = (id: string, cos?: object, more: Partial<Agent> = {}) => agent({ id, finishedAt: 1000, lead: { title: id, ...(cos && { marks: { [CHIEF_OF_STAFF]: cos } }) } as never, ...more });

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

  it('on watch, toasts the goal at the conn and a hail, and keeps another goal’s card to its berth', () => {
    const hail = { at: 1, judged: { route: 3, check: 'irreversible', ask: 'Read production?', why: 'w', message: 'm' } };
    expect(turnToast('reading', at('done', judged(2)), 'a1')).toEqual({ level: 'info', text: '🗂 Lt. Vale: Spend $40?' });
    expect(turnToast('reading', at('done', judged(2)), 'other')).toBeNull();
    expect(turnToast('working', at('done'), 'other')).toBeNull();
    expect(turnToast('reading', at('done', hail), 'other')).toEqual({ level: 'error', text: '🚨 Lt. Vale: Read production?' });
    expect(turnToast('reading', at('done', judged(2)), undefined)).toEqual({ level: 'info', text: '🗂 Lt. Vale: Spend $40?' });
  });
});
