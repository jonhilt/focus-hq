import { describe, expect, it } from 'vitest';
import { type RunContext, runMachine, step, type Target, turnEvent, type TurnEvent } from './runMachine';
import type { RunOutcome } from './types';

const ctx = (over: Partial<RunContext> = {}): RunContext => ({ role: 'work', resumed: false, carryOn: false, ...over });
const ok: RunOutcome = { ok: true, summary: 'Done', started: true };
const failed = (error: string, more: Partial<RunOutcome> = {}): RunOutcome => ({ ok: false, summary: '', error, ...more });
const gone = failed('No conversation found with session ID: s1');

const after = (outcome: RunOutcome, over: Partial<RunContext> = {}, mismatch?: string): Target =>
  step(turnEvent(outcome, mismatch), ctx(over));

describe('turnEvent', () => {
  it('reads what the turn’s end was from its outcome, a sign-in mismatch first', () => {
    expect(turnEvent(ok)).toEqual({ type: 'done' });
    expect(turnEvent({ ...ok, ok: false, aborted: true }, 'ANTHROPIC_API_KEY')).toEqual({ type: 'mismatch', observed: 'ANTHROPIC_API_KEY' });
    expect(turnEvent(failed('limit', { limited: true }))).toEqual({ type: 'limited' });
    expect(turnEvent(failed('Stopped by the captain', { aborted: true }))).toEqual({ type: 'stopped' });
    expect(turnEvent(failed('npm exploded', { started: true }))).toEqual({ type: 'failed', error: 'npm exploded' });
    expect(turnEvent({ ok: false, summary: '', started: true })).toEqual({ type: 'failed', error: 'The agent stopped with an error' });
  });

  it('tells apart why a session never got going', () => {
    expect(turnEvent(gone).type).toBe('gone');
    expect(turnEvent(failed('Session creation failed')).type).toBe('unstarted');
    // once it got going, it's a failure whatever it says
    expect(turnEvent({ ...gone, started: true }).type).toBe('failed');
  });
});

describe('the run machine', () => {
  it.each<[string, RunOutcome, Partial<RunContext>, Target]>([
    ['a developer’s finished work is delivered', ok, {}, 'deliver'],
    ['QA’s finished review is reported', ok, { role: 'review' }, 'finish-review'],
    ['a lead’s finished turn is the captain’s turn', ok, { role: 'lead' }, 'lead-done'],
    ['messages waiting carry the conversation on', ok, { carryOn: true }, 'carry-on'],
    ['… even after a failure: the message may be the fix', failed('x', { started: true }), { carryOn: true }, 'carry-on'],
    ['a failure fails them', failed('x', { started: true }), {}, 'fail'],
    ['the captain’s stop stops', failed('Stopped', { aborted: true }), { resumed: true }, 'stopped'],
    ['the plan’s limit hands over to the key', failed('limit', { limited: true }), {}, 'limited'],
    ['a lead whose conversation Claude Code no longer has starts a new one', gone, { role: 'lead', resumed: true }, 'fresh-session'],
    ['… but not one that wasn’t going back into one', gone, { role: 'lead' }, 'fail'],
    ['… nor a developer', gone, { resumed: true }, 'fail'],
  ])('%s', (_, outcome, over, target) => {
    expect(after(outcome, over)).toBe(target);
  });

  it('fails a turn signed in with the key behind Ops’ back, before it counts as stopped', () => {
    expect(after(failed('Stopped', { aborted: true }), {}, 'apiKeyHelper')).toBe('sign-in-mismatch');
  });

  it('takes every event to a final state, whatever its guards say', () => {
    const events: TurnEvent[] = [
      { type: 'done' }, { type: 'mismatch', observed: 'apiKeyHelper' }, { type: 'limited' }, { type: 'stopped' },
      ...(['gone', 'unstarted', 'failed'] as const).map((type) => ({ type, error: 'x' })),
    ];
    const finals = Object.entries(runMachine.root.states).filter(([, node]) => node.type === 'final').map(([name]) => name);
    for (const event of events) {
      for (const over of [{}, { role: 'lead' as const, resumed: true, carryOn: true }]) {
        expect(finals).toContain(step(event, ctx(over)));
      }
    }
  });
});
