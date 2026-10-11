import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, CallState, Project, ServerEvent, Snapshot } from '../../shared/types';
import type { Hub } from '../hub';
import { type CallOffice, Calls, callsMissing, stepOf } from './calls';
import { Jev, type JevAnswers } from './jev';
import { Live, type LiveClientEvent, type LiveEvent, type SidebandListener } from './live';
import { SETTLE_MS } from './machine';

// A call end to end through the office's side: stand-ins for OpenAI's session (what the office sends over its
// sideband, and events played into it), for Jev (answers in turn) and for the office (a project with a goal queued).

const shop = { id: 'p1', name: 'Shop', repos: ['acme/shop'], goalQueue: [{ id: 'q1', text: 'Voice mode', at: 0 }] } as Project;
const snapshot = { info: { github: { ok: true, login: 'captain' } }, projects: [shop], agents: [], boards: [], reviews: [] } as unknown as Snapshot;
const choice = (choice: string) => ({ choice, confidence: 0.95 });

function setUp(answers: JevAnswers[]) {
  const sent: LiveClientEvent[] = [];
  const events: ServerEvent[] = [];
  let listener: SidebandListener | undefined;
  const live = Layer.succeed(Live, Live.of({
    create: () => Effect.succeed({ id: 'live_1', sdp: 'v=0 answer' }),
    attach: (_id, l) =>
      Effect.sync(() => {
        listener = l;
        return { send: (e: LiveClientEvent) => void sent.push(e), close: () => l.closed() };
      }),
  }));
  const jev = Layer.succeed(Jev, Jev.of({ ask: () => Effect.sync(() => answers.shift() ?? {}) }));
  const started: [string, string, number][] = [];
  const office: CallOffice = {
    snapshot: () => Promise.resolve(snapshot),
    startQueued: (projectId, queueId, station) => {
      started.push([projectId, queueId, station]);
      return { name: 'Lt. Data', lead: { station } } as Agent;
    },
  };
  const hub = { send: (e: ServerEvent) => void events.push(e) } as unknown as Hub;
  const calls = new Calls(hub, office, { openai: 'sk', typesafe: 'ts' }, false, Layer.mergeAll(live, jev));
  /** The captain says something, and the voice model hands it over. */
  const say = async (text: string, delegation: string) => {
    for (const e of [
      { type: 'session.input_transcript.delta', delta: text },
      { type: 'session.delegation.created', delegation: { id: delegation, target: 'client' } },
    ] satisfies LiveEvent[]) listener!.event(e);
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 50);
  };
  const call = () => calls.status().call as CallState;
  const replies = () => sent.filter((e) => e.type === 'session.commentary.append');
  return { calls, sent, events, started, say, call, replies, emit: (e: LiveEvent) => listener!.event(e) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Calls', () => {
  it('answers a status question with the board, to the hand-over it came in on', async () => {
    const t = setUp([{ action: choice('status') }]);
    expect(await t.calls.start('v=0 offer')).toEqual({ id: 'live_1', sdp: 'v=0 answer' });
    await t.say("What's going on?", 'd1');
    expect(t.replies()).toEqual([{ type: 'session.commentary.append', delegation_id: 'd1', content: expect.stringContaining('Shop has no goals under way') as string }]);
    expect(t.call().lines.map((l) => l.who)).toEqual(['captain', 'office']);
    expect(t.events.at(-1)).toMatchObject({ type: 'call', call: { id: 'live_1', step: 'listening' } });
  });

  it('starts the next queued goal on a yes, after asking', async () => {
    const t = setUp([{ action: choice('start_next_goal') }, { action: choice('other'), approve: { noul: 0.97 } }]);
    await t.calls.start('v=0 offer');
    await t.say('Start the next goal', 'd1');
    expect(t.call()).toMatchObject({ step: 'confirming', pending: 'Start "Voice mode" in Shop, at station 1?' });
    expect(t.sent.some((e) => e.type === 'session.instructions.append')).toBe(true);
    expect(t.started).toEqual([]);
    await t.say('Make it so', 'd2');
    expect(t.started).toEqual([['p1', 'q1', 0]]);
    expect(t.replies().at(-1)).toEqual({ type: 'session.commentary.append', delegation_id: 'd2', content: 'Started: Lt. Data has "Voice mode" at station 1.' });
    expect(t.call().step).toBe('listening');
  });

  it('captions the ship, notes OpenAI’s errors, and ends when the session does', async () => {
    const t = setUp([]);
    await t.calls.start('v=0 offer');
    t.emit({ type: 'session.started' });
    t.emit({ type: 'session.output_transcript.delta', delta: 'Good evening, Captain.' });
    t.emit({ type: 'error', error: { message: 'Rate limited' } });
    t.emit({ type: 'session.closed', reason: 'expired' });
    expect(t.call()).toMatchObject({ step: 'ended', error: 'The call ended: expired' });
    expect(t.call().lines.map((l) => `${l.who}: ${l.text}`)).toEqual(['ship: Good evening, Captain.', 'office: OpenAI: Rate limited']);
  });

  it('hangs up: closes the session, and a new call hangs up the last', async () => {
    const t = setUp([]);
    await t.calls.start('v=0 offer');
    t.calls.hangUp('someone-else');
    expect(t.call().step).toBe('listening');
    t.calls.hangUp('live_1');
    expect(t.sent).toContainEqual({ type: 'session.close' });
    expect(t.call()).toMatchObject({ step: 'ended' });
    expect(t.call().error).toBeUndefined();
  });

  it("won't take a call without both keys", async () => {
    const calls = new Calls({ send: () => undefined } as unknown as Hub, { snapshot: () => Promise.resolve(snapshot), startQueued: () => ({}) as Agent }, { openai: 'sk' }, false);
    expect(calls.status()).toEqual({ missing: 'Calls need TYPESAFE_API_KEY set where the office starts (see docs/calls.md)', call: null });
    await expect(calls.start('v=0 offer')).rejects.toThrow('TYPESAFE_API_KEY');
  });
});

describe('callsMissing', () => {
  it('names each missing key, and needs none in the demo', () => {
    expect(callsMissing({}, false)).toBe('Calls need OPENAI_API_KEY and TYPESAFE_API_KEY set where the office starts (see docs/calls.md)');
    expect(callsMissing({ openai: 'a', typesafe: 'b' }, false)).toBeUndefined();
    expect(callsMissing({}, true)).toBeUndefined();
  });
});

describe('stepOf', () => {
  it("shows the machine's state as the step, routing whichever part of it", () => {
    expect(stepOf('confirming')).toBe('confirming');
    expect(stepOf({ routing: 'asking' })).toBe('routing');
    expect(stepOf('ended')).toBe('ended');
    expect(stepOf('something new')).toBe('listening');
  });
});
