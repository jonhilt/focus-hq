import { describe, expect, it } from 'vitest';
import type { Agent } from '../../plugin-api/shared';
import { held, judged, laneOf, lineOf, needingYou, reading, waking } from './lanes';
import { AUTO_SEND_MS, CHIEF_OF_STAFF, type CosRead, JUDGING_MS, type Verdict } from './shared';

const verdict = (route: Verdict['route']): Verdict => ({ route, ask: route === 3 ? 'Spend $40?' : 'Carry on', why: 'w', message: 'm' });
const lead = (read?: CosRead, more: Partial<Agent> = {}): Agent => ({
  id: 'a1', name: 'Lt. Vale', projectId: 'p', repo: 'acme/shop', task: 'lead', issue: { number: 0, title: 'Wishlist', url: '' }, desk: 0,
  status: 'done', activity: '', branch: 'b', baseBranch: 'main', costUsd: 0, startedAt: 1, finishedAt: 1000,
  avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#fff', hair: '#000', hairstyle: 'crop', accessory: 'none' },
  lead: { station: 0, title: 'Wishlist', repos: [], slice: 1, prs: [], ...(read && { marks: { [CHIEF_OF_STAFF]: read } }) },
  ...more,
});
const turn = (read?: CosRead, more?: Partial<Agent>) => ({ kind: 'turn' as const, agent: lead(read, more) });

describe('where a hail goes', () => {
  it('holds a lead’s turn back while it’s read, for a minute, then lets it hail unjudged', () => {
    expect(laneOf(turn({ at: 1000 }), 1000 + JUDGING_MS - 1)).toBe('judging');
    expect(laneOf(turn({ at: 1000 }), 1000 + JUDGING_MS)).toBe('needs-you');
    expect(laneOf(turn(), 0)).toBe('needs-you');
  });

  it('files words for the lead as ready, and a card or an interrupt under needs you, headed by its line', () => {
    expect(laneOf(turn({ at: 1, judged: verdict(1) }), 2)).toBe('ready');
    expect(laneOf(turn({ at: 1, judged: verdict(4) }), 2)).toBe('ready');
    expect(laneOf(turn({ at: 1, judged: verdict(2) }), 2)).toBe('needs-you');
    expect(lineOf(turn({ at: 1, judged: verdict(3) }), new Map())).toEqual({ icon: '🚨', what: 'Spend $40?' });
    expect(lineOf(turn(), new Map())).toEqual({ icon: '💬', what: 'Waiting for your reply' });
  });

  it('counts on the badge only what needs the captain', () => {
    const ready = lead({ at: 1, judged: verdict(1) }, { id: 'r' });
    const card = lead({ at: 1, judged: verdict(2) }, { id: 'c' });
    expect(needingYou([ready, card], [], new Map(), 2).map((a) => ('agent' in a ? a.agent.id : ''))).toEqual(['c']);
  });
});

describe('waking a lead for Ops’ news', () => {
  it('wakes a lead at work, or whose turn it would carry on or send back', () => {
    expect(waking(lead(undefined, { status: 'working' }), 0)).toBe('now');
    expect(waking(lead(undefined, { status: 'waiting', permission: { id: 'r', tool: 'Bash', summary: 'npm i', at: 0 } }), 0)).toBe('now');
    expect(waking(lead({ at: 1, judged: verdict(1) }), 2)).toBe('now');
    expect(waking(lead({ at: 1, judged: verdict(4) }), 2)).toBe('now');
  });

  it('leaves a lead the captain owes an answer: a card, an interrupt, a turn unjudged or read, a question, a close, an error', () => {
    expect(waking(lead({ at: 1, judged: verdict(2) }), 2)).toBe('no');
    expect(waking(lead({ at: 1, judged: verdict(3) }), 2)).toBe('no');
    expect(waking(lead(), 2)).toBe('no');
    expect(waking(lead({ at: 1 }), 1 + JUDGING_MS)).toBe('no');
    expect(waking(lead(undefined, { lead: { station: 0, title: 'W', repos: [], slice: 1, prs: [], readTurn: 1000 } }), 2)).toBe('no');
    expect(waking(lead(undefined, { lead: { station: 0, title: 'W', repos: [], slice: 1, prs: [], closing: { reason: 'done', at: 1 } } }), 2)).toBe('no');
    expect(waking(lead(undefined, { status: 'error', error: 'boom' }), 2)).toBe('no');
  });

  it('waits on a turn it’s still reading: it may yet be a card', () => {
    expect(waking(lead({ at: 1 }), 2)).toBe('once-judged');
  });

  it('goes by its read of a turn the captain has read: carry on or send back wakes, a card doesn’t, one being read waits', () => {
    const read = (r: CosRead) => lead(r, { lead: { station: 0, title: 'W', repos: [], slice: 1, prs: [], readTurn: 1000, marks: { [CHIEF_OF_STAFF]: r } } });
    expect(waking(read({ at: 1, judged: verdict(1) }), 2)).toBe('now');
    expect(waking(read({ at: 1, judged: verdict(4) }), 2)).toBe('now');
    expect(waking(read({ at: 1, judged: verdict(2) }), 2)).toBe('no');
    expect(waking(read({ at: 1 }), 2)).toBe('once-judged');
    expect(waking(read({ at: 1 }), 1 + JUDGING_MS)).toBe('no');
  });

  it('leaves a lead the captain stopped, whatever it made of their turn; wakes one queued or setting up', () => {
    expect(waking(lead(undefined, { status: 'stopped' }), 2)).toBe('no');
    expect(waking(lead({ at: 1, judged: verdict(1) }, { status: 'stopped' }), 2)).toBe('no');
    expect(waking(lead(undefined, { status: 'queued' }), 2)).toBe('now');
    expect(waking(lead(undefined, { status: 'setting-up' }), 2)).toBe('now');
  });

  it('leaves a question or a close with the captain even when it would carry the turn on', () => {
    const closing = { station: 0, title: 'W', repos: [], slice: 1, prs: [], closing: { reason: 'done', at: 1 }, marks: { [CHIEF_OF_STAFF]: { at: 1, judged: verdict(1) } } };
    expect(waking(lead(undefined, { lead: closing }), 2)).toBe('no');
  });
});

describe('its read of a turn', () => {
  it('is judged once, while it’s the turn being read', () => {
    expect(judged(reading(10), verdict(2), 10, false, 20)).toEqual({ at: 10, judged: verdict(2) });
    expect(judged(undefined, verdict(2), 10, false, 20)).toBeUndefined();
    expect(judged({ at: 10, judged: verdict(1) }, verdict(2), 10, false, 20)).toBeUndefined();
    // judged from before this turn ended: an earlier turn's
    expect(judged(reading(10), verdict(2), 9, false, 20)).toBeUndefined();
  });

  it('sends its words for the lead by itself, where it’s let, after a while; never a card', () => {
    expect(judged(reading(10), verdict(1), 10, true, 20)).toEqual({ at: 10, judged: verdict(1), sendsAt: 20 + AUTO_SEND_MS });
    expect(judged(reading(10), verdict(2), 10, true, 20)).toEqual({ at: 10, judged: verdict(2) });
    expect(judged(reading(10), verdict(4), 10, false, 20)).toEqual({ at: 10, judged: verdict(4) });
  });

  it('holds words that were going by themselves, and has nothing to hold otherwise', () => {
    expect(held({ at: 10, judged: verdict(1), sendsAt: 99 })).toEqual({ at: 10, judged: verdict(1) });
    expect(held({ at: 10, judged: verdict(1) })).toBeUndefined();
    expect(held(undefined)).toBeUndefined();
  });
});
