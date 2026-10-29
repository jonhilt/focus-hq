import { describe, expect, it } from 'vitest';
import type { Agent, LedgerEvent } from '../../plugin-api/shared';
import { acked, held, heldForRead, judged, laneOf, lineOf, lostRaises, needingYou, reading, unjudged, unreadShip, waking } from './laneRules';
import { AUTO_SEND_MS, CHIEF_OF_STAFF, type CosRead, JUDGING_MS, type Verdict } from './shared';

const verdict = (route: Verdict['route']): Verdict => ({ route, asks: [{ ask: route === 3 ? 'Spend $40?' : 'Carry on' }], why: 'w', message: 'm' });
const lead = (read?: CosRead, more: Partial<Agent> = {}): Agent => ({
  id: 'a1', name: 'Lt. Vale', projectId: 'p', repo: 'acme/shop', task: 'lead', issue: { number: 0, title: 'Wishlist', url: '' }, desk: 0,
  status: 'done', activity: '', branch: 'b', baseBranch: 'main', costUsd: 0, startedAt: 1, finishedAt: 1000,
  avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#fff', hair: '#000', hairstyle: 'crop', accessory: 'none' },
  lead: { title: 'Wishlist', repos: [], slice: 1, prs: [], ...(read && { marks: { [CHIEF_OF_STAFF]: read } }) },
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
    // a card the captain acknowledged asks nothing more of them
    const set = lead({ at: 1, judged: verdict(2), acked: 5 }, { id: 's' });
    expect(needingYou([card, set], [], new Map(), 6).map((a) => ('agent' in a ? a.agent.id : ''))).toEqual(['c']);
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
    expect(waking(lead(undefined, { lead: { title: 'W', repos: [], slice: 1, prs: [], readTurn: 1000 } }), 2)).toBe('no');
    expect(waking(lead(undefined, { lead: { title: 'W', repos: [], slice: 1, prs: [], closing: { reason: 'done', at: 1 } } }), 2)).toBe('no');
    expect(waking(lead(undefined, { status: 'error', error: 'boom' }), 2)).toBe('no');
  });

  it('waits on a turn it’s still reading: it may yet be a card', () => {
    expect(waking(lead({ at: 1 }), 2)).toBe('once-judged');
  });

  it('goes by its read of a turn the captain has read: carry on or send back wakes, a card doesn’t, one being read waits', () => {
    const read = (r: CosRead) => lead(r, { lead: { title: 'W', repos: [], slice: 1, prs: [], readTurn: 1000, marks: { [CHIEF_OF_STAFF]: r } } });
    expect(waking(read({ at: 1, judged: verdict(1) }), 2)).toBe('now');
    expect(waking(read({ at: 1, judged: verdict(4) }), 2)).toBe('now');
    expect(waking(read({ at: 1, judged: verdict(2) }), 2)).toBe('no');
    expect(waking(read({ at: 1 }), 2)).toBe('once-judged');
    expect(waking(read({ at: 1 }), 1 + JUDGING_MS)).toBe('no');
  });

  it('wakes a lead whose turn the captain acknowledged, whatever it made of it: the captain is owed nothing', () => {
    for (const r of [{ at: 1, acked: 3 }, { at: 1, judged: verdict(2), acked: 3 }, { at: 1, judged: verdict(3), acked: 3 }]) expect(waking(lead(r), 4)).toBe('now');
  });

  it('leaves a lead the captain stopped, whatever it made of their turn; wakes one queued or setting up', () => {
    expect(waking(lead(undefined, { status: 'stopped' }), 2)).toBe('no');
    expect(waking(lead({ at: 1, judged: verdict(1) }, { status: 'stopped' }), 2)).toBe('no');
    expect(waking(lead(undefined, { status: 'queued' }), 2)).toBe('now');
    expect(waking(lead(undefined, { status: 'setting-up' }), 2)).toBe('now');
  });

  it('leaves a question or a close with the captain even when it would carry the turn on', () => {
    const closing = { title: 'W', repos: [], slice: 1, prs: [], closing: { reason: 'done', at: 1 }, marks: { [CHIEF_OF_STAFF]: { at: 1, judged: verdict(1) } } };
    expect(waking(lead(undefined, { lead: closing }), 2)).toBe('no');
  });
});

describe('its read of a turn', () => {
  it('is judged again when it was begun and never judged, while the lead is between turns', () => {
    expect(unjudged(lead(reading(10)))).toBe(true);
    expect(unjudged(lead({ at: 10, judged: verdict(2) }))).toBe(false);
    expect(unjudged(lead({ at: 10, acked: 20 }))).toBe(false);
    expect(unjudged(lead())).toBe(false);
    expect(unjudged(lead(reading(10), { status: 'working' }))).toBe(false);
  });

  it('is judged once, while it’s the turn being read', () => {
    expect(judged(reading(10), verdict(2), 10, false, 20)).toEqual({ at: 10, judged: verdict(2) });
    expect(judged(undefined, verdict(2), 10, false, 20)).toBeUndefined();
    expect(judged({ at: 10, judged: verdict(1) }, verdict(2), 10, false, 20)).toBeUndefined();
    // judged from before this turn ended: an earlier turn's
    expect(judged(reading(10), verdict(2), 9, false, 20)).toBeUndefined();
  });

  it('sends a turn back to the lead by itself, where it’s let, after a while; never a card, and never carries a lead on', () => {
    expect(judged(reading(10), verdict(4), 10, true, 20)).toEqual({ at: 10, judged: verdict(4), sendsAt: 20 + AUTO_SEND_MS });
    expect(judged(reading(10), verdict(1), 10, true, 20)).toEqual({ at: 10, judged: verdict(1) });
    expect(judged(reading(10), verdict(2), 10, true, 20)).toEqual({ at: 10, judged: verdict(2) });
    expect(judged(reading(10), verdict(4), 10, false, 20)).toEqual({ at: 10, judged: verdict(4) });
  });

  it('never counts down its words on a turn the captain acknowledged while it read it', () => {
    expect(judged({ at: 10, acked: 15 }, verdict(4), 10, true, 20)).toEqual({ at: 10, acked: 15, judged: verdict(4) });
  });

  it('keeps what it made of a turn the captain acknowledges, its words going nowhere by themselves', () => {
    expect(acked({ at: 10, judged: verdict(1), sendsAt: 99 }, 10, 50)).toEqual({ at: 10, judged: verdict(1), acked: 50 });
    expect(acked({ at: 10 }, 10, 50)).toEqual({ at: 10, acked: 50 });
    // with no read of the turn, one begins from when it ended
    expect(acked(undefined, 1000, 2000)).toEqual({ at: 1000, acked: 2000 });
  });

  it('holds words that were going by themselves, and has nothing to hold otherwise', () => {
    expect(held({ at: 10, judged: verdict(1), sendsAt: 99 })).toEqual({ at: 10, judged: verdict(1) });
    expect(held({ at: 10, judged: verdict(1) })).toBeUndefined();
    expect(held(undefined)).toBeUndefined();
  });
});

type Pr = { repo: string; number: number; url: string; sha?: string; lane?: 'ship' | 'show' | 'ask'; outcome?: 'merged' | 'closed' };
const pr = (number: number, more: Partial<Pr> = {}): Pr => ({ repo: 'acme/shop', number, url: '', sha: `sha${number}`, lane: 'ship', ...more });
const goalLead = (prs: Pr[]): Pick<Agent, 'lead'> => ({ lead: { title: 'Wishlist', repos: [], slice: 1, prs } });
const laneRead = (prs: { pr: number; sha: string }[], to: 'ship' | 'show' | 'ask' = 'ship'): LedgerEvent => ({
  kind: 'cos-lane', seq: 1, at: 1, projectId: 'p', agent: 'Lt. Vale', prs: prs.map((p) => ({ repo: 'acme/shop', ...p })), from: 'ship', to, why: to === 'ship' ? 'Safe.' : 'It changes a card.', model: 'haiku', version: 'lane-v1',
});

describe('the ships it has still to read', () => {
  it('is a lead’s open pull requests in Ship or Show, until a read covers each at the commit it’s at', () => {
    const prs = [pr(7), pr(8, { lane: 'show' }), pr(9, { lane: 'ask' }), pr(10, { outcome: 'merged' })];
    expect(unreadShip(goalLead(prs), []).map((p) => p.number)).toEqual([7, 8]);
    expect(unreadShip(goalLead(prs), [laneRead([{ pr: 7, sha: 'sha7' }, { pr: 8, sha: 'sha8' }])])).toEqual([]);
  });

  it('is read again once the lead pushes a new commit and recaps it again', () => {
    expect(unreadShip(goalLead([pr(7, { sha: 'newer' })]), [laneRead([{ pr: 7, sha: 'sha7' }])]).map((p) => p.number)).toEqual([7]);
  });

  it('holds a pull request back from merging by itself until then, and only one a read could raise', () => {
    expect(heldForRead(pr(7), [])).toBe('the chief of staff hasn’t read its lane yet');
    expect(heldForRead(pr(7), [laneRead([{ pr: 7, sha: 'sha7' }])])).toBeUndefined();
    expect(heldForRead(pr(9, { lane: 'ask' }), [])).toBeUndefined();
  });

  it('keeps holding one a read raised, until the raise is in its lane (a restart lost it), and says which to take again', () => {
    const ledger = [laneRead([{ pr: 7, sha: 'sha7' }, { pr: 8, sha: 'sha8' }], 'show'), laneRead([{ pr: 8, sha: 'sha8' }], 'ask')];
    expect(heldForRead(pr(7), ledger)).toBe('the chief of staff raised it to Show');
    expect(lostRaises(goalLead([pr(7), pr(8)]), ledger).map((r) => [r.pr.number, r.lane])).toEqual([[7, 'show'], [8, 'ask']]);
    expect(heldForRead(pr(7, { lane: 'show' }), ledger)).toBeUndefined();
    expect(lostRaises(goalLead([pr(7, { lane: 'show' }), pr(8, { lane: 'ask' })]), ledger)).toEqual([]);
  });
});
