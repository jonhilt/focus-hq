import { describe, expect, it } from 'vitest';
import { INTERRUPTED_ERROR } from '../runJournal';
import { closingAtTurnStart, setAsideLine } from './turnStartRules';

describe('closingAtTurnStart', () => {
  const lead = { name: 'Lt. Rhee', closing: { reason: 'It works end to end', at: 5 } };
  const handedBack = { target: 'lead-done' as const, outcome: { ok: true } };

  it('has nothing to set aside when the lead proposed nothing', () => {
    expect(closingAtTurnStart({ name: 'Lt. Rhee' }, handedBack)).toEqual({ kind: 'keep' });
  });

  it('sets the proposal aside as a turn after the one that made it starts, whoever woke them', () => {
    expect(closingAtTurnStart(lead, handedBack)).toEqual({ kind: 'set-aside', line: '✻ Close the goal? — set aside: Rhee carried on' });
    // carried on by someone writing as it ended, held for the plan's limit, stopped: each a turn after it
    for (const target of ['carry-on', 'limited', 'stopped'] as const) expect(closingAtTurnStart(lead, { target, outcome: { ok: true } }).kind).toBe('set-aside');
    // nothing in the journal before it
    expect(closingAtTurnStart(lead).kind).toBe('set-aside');
  });

  it('keeps the proposal of a turn a restart cut off, as that turn is picked back up', () => {
    expect(closingAtTurnStart(lead, { outcome: { ok: false, error: INTERRUPTED_ERROR } })).toEqual({ kind: 'keep' });
    // a compaction's turn, which Ops decides nothing after, wasn't cut off: a turn after the proposal
    expect(closingAtTurnStart(lead, { outcome: { ok: true } }).kind).toBe('set-aside');
  });
});

describe('setAsideLine', () => {
  it('names the card and the lead by surname', () => {
    expect(setAsideLine('Waiting for your reply', 'Commander Okafor')).toBe('✻ Waiting for your reply — set aside: Okafor carried on');
    expect(setAsideLine('Close the goal?', 'Rhee')).toBe('✻ Close the goal? — set aside: Rhee carried on');
  });
});
