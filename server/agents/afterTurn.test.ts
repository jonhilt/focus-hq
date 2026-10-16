import { describe, expect, it } from 'vitest';
import { afterTurn, type TurnEnd } from './afterTurn';
import { CLOUD_UNAVAILABLE } from './cloud';

const ok = { ok: true, summary: 'Done' };
const end = (over: Partial<TurnEnd> = {}): TurnEnd => ({ outcome: ok, role: 'work', cloud: false, hasSession: true, resumed: false, attachRefused: false, carryOn: false, ...over });
const failed = (error: string, more = {}) => ({ ok: false, summary: '', error, ...more });

describe('afterTurn', () => {
  it.each<[string, Partial<TurnEnd>, string]>([
    ['a developer’s finished work is delivered', {}, 'deliver'],
    ['QA’s finished review is reported', { role: 'review' }, 'finish-review'],
    ['a lead’s finished turn is the captain’s turn', { role: 'lead' }, 'lead-done'],
    ['a message as the turn ended carries on', { carryOn: true }, 'carry-on'],
    ['the captain’s stop stops', { outcome: { ...failed('Stopped by the captain'), aborted: true } }, 'stopped'],
    ['the plan’s limit hands over to the key', { outcome: { ...failed('limit'), limited: true } }, 'limited'],
    ['a sign-in with the key behind the office’s back fails them, before stopped', { outcome: { ...failed('x'), aborted: true }, mismatch: 'ANTHROPIC_API_KEY' }, 'sign-in-mismatch'],
    ['a lead whose conversation is gone starts a new one', { role: 'lead', resumed: true, outcome: failed('No conversation found with session ID: s1') }, 'fresh-session'],
    ['a cloud session that can’t be got back into starts a new one', { cloud: true, resumed: true, outcome: failed('session not found') }, 'new-cloud-session'],
    ['a cloud refusal after working there carries on here', { cloud: true, outcome: failed(CLOUD_UNAVAILABLE) }, 'cloud-to-local'],
    ['a cloud refusal before starting waits for a terminal', { cloud: true, hasSession: false, outcome: failed(CLOUD_UNAVAILABLE) }, 'cloud-await'],
    ['… or carries on here when attaching is refused too', { cloud: true, hasSession: false, attachRefused: true, outcome: failed(CLOUD_UNAVAILABLE) }, 'cloud-carry-on-here'],
    ['a busy cloud session being attached to is tried again', { cloud: true, attaching: { tries: 0 }, outcome: failed('session is busy') }, 'attach-again'],
    ['attaching refused for good carries on here', { cloud: true, attaching: { tries: 0 }, outcome: failed(CLOUD_UNAVAILABLE) }, 'attach-refused'],
    ['attaching failing otherwise waits for the captain', { cloud: true, attaching: { tries: 0 }, outcome: failed('boom') }, 'attach-failed'],
    ['an attached session that worked goes on as usual', { cloud: true, attaching: { tries: 1 }, outcome: ok }, 'deliver'],
  ])('%s', (_, over, kind) => {
    expect(afterTurn(end(over)).kind).toBe(kind);
  });

  it('fails with the turn’s error, or says it had none', () => {
    expect(afterTurn(end({ outcome: failed('npm exploded') }))).toEqual({ kind: 'fail', error: 'npm exploded' });
    expect(afterTurn(end({ outcome: { ok: false, summary: '' } }))).toEqual({ kind: 'fail', error: 'The agent stopped with an error' });
  });

  it('carries on before failing: the manager’s message may be the fix', () => {
    expect(afterTurn(end({ outcome: failed('x'), carryOn: true })).kind).toBe('carry-on');
  });
});
