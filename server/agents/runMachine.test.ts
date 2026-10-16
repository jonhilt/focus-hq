import { describe, expect, it } from 'vitest';
import { ATTACH_TRIES, CLOUD_UNAVAILABLE } from './cloud';
import { type RunContext, runMachine, step, type Target, turnEvent, type TurnEvent, type TurnState } from './runMachine';
import type { RunOutcome } from './types';

const ctx = (over: Partial<RunContext> = {}): RunContext => ({ role: 'work', resumed: false, hasSession: true, tries: 0, attachRefused: false, carryOn: false, ...over });
const ok: RunOutcome = { ok: true, summary: 'Done', started: true };
const failed = (error: string, more: Partial<RunOutcome> = {}): RunOutcome => ({ ok: false, summary: '', error, ...more });
const busy = failed('Error: cloud session session_01 is busy with a turn; wait for it to finish, or watch it at https://claude.ai/code/session_01, then send the message again.');
const asking = failed('Error: cloud session session_01 is waiting on a question; answer it where it was asked (https://claude.ai/code/session_01) before sending it another message.');
const gone = failed('No conversation found with session ID: s1');
const refused = failed(CLOUD_UNAVAILABLE);

const after = (state: TurnState, outcome: RunOutcome, over: Partial<RunContext> = {}, mismatch?: string): Target =>
  step(state, turnEvent(outcome, mismatch), ctx(over));

describe('turnEvent', () => {
  it('reads what the turn’s end was from its outcome, a sign-in mismatch first', () => {
    expect(turnEvent(ok)).toEqual({ type: 'done' });
    expect(turnEvent({ ...ok, ok: false, aborted: true }, 'ANTHROPIC_API_KEY')).toEqual({ type: 'mismatch', observed: 'ANTHROPIC_API_KEY' });
    expect(turnEvent(failed('limit', { limited: true }))).toEqual({ type: 'limited' });
    expect(turnEvent(failed('Stopped by the captain', { aborted: true }))).toEqual({ type: 'stopped' });
    expect(turnEvent(refused)).toEqual({ type: 'refused', error: CLOUD_UNAVAILABLE });
    expect(turnEvent(failed('npm exploded', { started: true }))).toEqual({ type: 'failed', error: 'npm exploded' });
    expect(turnEvent({ ok: false, summary: '', started: true })).toEqual({ type: 'failed', error: 'The agent stopped with an error' });
  });

  it('tells apart why a session never got going', () => {
    expect(turnEvent(busy).type).toBe('busy');
    expect(turnEvent(asking).type).toBe('asking');
    expect(turnEvent(gone).type).toBe('gone');
    expect(turnEvent(failed('cloud session session_01 is archived')).type).toBe('unstarted');
    // once it got going, it's a failure whatever it says
    expect(turnEvent({ ...busy, started: true }).type).toBe('failed');
  });
});

describe('the run machine', () => {
  it.each<[string, TurnState, RunOutcome, Partial<RunContext>, Target]>([
    // a turn's end, whatever state it ran in
    ['a developer’s finished work is delivered', 'local', ok, {}, 'deliver'],
    ['QA’s finished review is reported', 'local', ok, { role: 'review' }, 'finish-review'],
    ['a lead’s finished turn is the captain’s turn', 'local', ok, { role: 'lead' }, 'lead-done'],
    ['messages waiting carry the conversation on', 'local', ok, { carryOn: true }, 'carry-on'],
    ['… even after a failure: the message may be the fix', 'local', failed('x', { started: true }), { carryOn: true }, 'carry-on'],
    ['a failure fails them', 'local', failed('x', { started: true }), {}, 'fail'],
    ['the captain’s stop stops', 'cloud', failed('Stopped', { aborted: true }), { resumed: true }, 'stopped'],
    ['the plan’s limit hands over to the key', 'local', failed('limit', { limited: true }), {}, 'limited'],
    // on this machine
    ['a lead whose conversation Claude Code no longer has starts a new one', 'local', gone, { role: 'lead', resumed: true }, 'fresh-session'],
    ['… but not one that wasn’t going back into one', 'local', gone, { role: 'lead' }, 'fail'],
    ['… nor a developer', 'local', gone, { resumed: true }, 'fail'],
    // in the cloud
    ['a cloud session that can’t be got back into starts a new one', 'cloud', failed('cloud session session_01 is archived'), { resumed: true }, 'new-cloud-session'],
    ['… or no longer has the conversation', 'cloud', gone, { resumed: true }, 'new-cloud-session'],
    ['… not a fresh one that failed', 'cloud', failed('Session creation failed'), {}, 'fail'],
    ['… and never beside one still working', 'cloud', busy, { resumed: true }, 'fail'],
    ['… or waiting on a question', 'cloud', asking, { resumed: true }, 'fail'],
    ['… nor one that failed once going', 'cloud', failed('boom', { started: true }), { resumed: true }, 'fail'],
    ['a cloud refusal after working there carries on here', 'cloud', refused, {}, 'cloud-to-local'],
    ['a cloud refusal before starting waits for a terminal', 'cloud', refused, { hasSession: false }, 'cloud-await'],
    ['… or carries on here when attaching is refused too', 'cloud', refused, { hasSession: false, attachRefused: true }, 'cloud-carry-on-here'],
    ['a cloud refusal resuming isn’t a new session: it would be refused too', 'cloud', refused, { resumed: true, hasSession: false }, 'cloud-await'],
    // attaching to the session the captain started
    ['a busy session being attached to is tried again', 'attaching', busy, {}, 'attach-again'],
    ['… until the tries run out', 'attaching', busy, { tries: ATTACH_TRIES }, 'attach-failed'],
    ['… with the last try still a try', 'attaching', busy, { tries: ATTACH_TRIES - 1 }, 'attach-again'],
    ['attaching refused for good carries on here', 'attaching', refused, {}, 'attach-refused'],
    ['attaching failing otherwise waits for the captain', 'attaching', failed('session_01 not found'), {}, 'attach-failed'],
    ['… waiting on a question too', 'attaching', asking, {}, 'attach-failed'],
    ['an attached session that worked goes on as any cloud turn', 'attaching', ok, { tries: 1 }, 'deliver'],
    ['… and one that failed once going fails', 'attaching', failed('boom', { started: true }), {}, 'fail'],
    ['… and a stop while attaching stops', 'attaching', failed('Stopped', { aborted: true }), {}, 'stopped'],
  ])('%s', (_, state, outcome, over, target) => {
    expect(after(state, outcome, over)).toBe(target);
  });

  it('fails a turn signed in with the key behind the office’s back, before it counts as stopped', () => {
    expect(after('local', failed('Stopped', { aborted: true }), {}, 'apiKeyHelper')).toBe('sign-in-mismatch');
  });

  it('takes every event, from every state, to a final state, whatever its guards say', () => {
    const events: TurnEvent[] = [
      { type: 'done' }, { type: 'mismatch', observed: 'apiKeyHelper' }, { type: 'limited' }, { type: 'stopped' },
      ...(['refused', 'busy', 'asking', 'gone', 'unstarted', 'failed'] as const).map((type) => ({ type, error: 'x' })),
    ];
    const finals = Object.entries(runMachine.root.states).filter(([, node]) => node.type === 'final').map(([name]) => name);
    for (const state of ['local', 'cloud', 'attaching'] as const) {
      for (const event of events) {
        for (const over of [{}, { role: 'lead' as const, resumed: true, carryOn: true, attachRefused: true, hasSession: false, tries: ATTACH_TRIES }]) {
          expect(finals).toContain(step(state, event, ctx(over)));
        }
      }
    }
  });
});
