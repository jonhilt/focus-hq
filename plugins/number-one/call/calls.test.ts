import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallState, CallStatus } from '../shared';
import { type CallOffice, Calls, callsMissing, stepOf } from './calls';
import { Jev, type JevAnswers } from './jev';
import { Live, type LiveClientEvent, type LiveEvent, type SidebandListener } from './live';
import { SETTLE_MS } from './machine';
import { type Agent, type MessageReply, type Project, type Snapshot } from '../../../plugin-api/server';

// A call end to end through the office's side: stand-ins for OpenAI's session (what the office sends over its
// sideband, and events played into it), for Jev (answers in turn) and for the office (a project with a goal queued).

const shop = { id: 'p1', name: 'Shop', repos: ['acme/shop'], goalQueue: [{ id: 'q1', text: 'Voice mode', at: 0 }] } as Project;
const snapshot = { info: { github: { ok: true, login: 'captain' } }, projects: [shop], agents: [], boards: [], reviews: [] } as unknown as Snapshot;
const choice = (choice: string) => ({ choice, confidence: 0.95 });

function setUp(answers: JevAnswers[], messageReply: MessageReply = { sent: true }, ship: Snapshot = snapshot) {
  const sent: LiveClientEvent[] = [];
  const events: CallStatus[] = [];
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
  const goals: [string, string][] = [];
  const messages: [string, string][] = [];
  const office: CallOffice = {
    snapshot: () => Promise.resolve(ship),
    ledger: () => [],
    startQueued: (projectId, queueId, station) => {
      started.push([projectId, queueId, station]);
      return { name: 'Lt. Data', lead: { station } } as Agent;
    },
    startGoal: (projectId, text) => {
      goals.push([projectId, text]);
      return { queued: { id: 'q2', text, at: 0 } };
    },
    message: (agentId, text) => {
      messages.push([agentId, text]);
      return messageReply;
    },
  };
  const calls = new Calls((status) => void events.push(status), office, { openai: 'sk', typesafe: 'ts' }, false, Layer.mergeAll(live, jev));
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
  return { calls, sent, events, started, goals, messages, say, call, replies, emit: (e: LiveEvent) => listener!.event(e) };
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
    expect(t.events.at(-1)).toMatchObject({ call: { id: 'live_1', step: 'listening' } });
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

  it('talks a project through: briefs the voice model quietly, then makes the conversation a goal on a yes', async () => {
    const t = setUp([{ action: choice('talk'), topic: choice('project:p1') }, { action: choice('capture_goal') }, {}, { action: choice('other'), approve: { noul: 0.97 } }]);
    await t.calls.start('v=0 offer');
    await t.say("Let's talk about the shop", 'd1');
    const briefed = t.sent.filter((e) => e.type === 'session.thinking.append');
    expect(briefed.length).toBeGreaterThan(0);
    expect(briefed[0]).toMatchObject({ delegation_id: null, content: expect.stringContaining('Topic: Shop as a whole.') as string });
    expect(t.call().topic).toBe('Shop');
    t.emit({ type: 'session.output_transcript.delta', delta: 'QA keeps failing on flaky tests.' });
    expect(t.call().lines.map((l) => l.who)).toEqual(['captain', 'office', 'ship']);
    await t.say('Make that a goal', 'd2');
    expect(t.call()).toMatchObject({ step: 'dictating', capture: 'What should the new goal in Shop be?' });
    await t.say('Fix the flaky tests', 'd3');
    expect(t.call()).toMatchObject({ step: 'confirming', pending: 'Start a new goal in Shop: "Fix the flaky tests"? It takes the notes from this call with it.' });
    await t.say('Yes', 'd4');
    // the notes start where the topic did, after the captain asked for it
    expect(t.goals).toEqual([['p1', expect.stringMatching(/^Fix the flaky tests\n\nFrom a call with the captain about Shop:\nShip: QA keeps failing on flaky tests\./) as string]]);
    expect(t.replies().at(-1)).toMatchObject({ delegation_id: 'd4', content: 'Queued "Fix the flaky tests" in Shop: every team station has a goal.' });
  });

  it("says when a word for a lead waits on the captain's say about the API key", async () => {
    const goal = { ...snapshot, agents: [{ id: 'lead_1', name: 'Lt. Data', projectId: 'p1', task: 'lead', lead: { station: 0, title: 'Wishlist', prs: [] } }] } as unknown as Snapshot;
    const t = setUp([{ action: choice('tell_lead'), topic: choice('goal:lead_1') }, {}, { approve: { noul: 0.95 } }], { costly: {} as never }, goal);
    await t.calls.start('v=0 offer');
    await t.say('Tell Data something', 'd1');
    await t.say('Ship it', 'd2');
    await t.say('Yes', 'd3');
    expect(t.messages).toEqual([['lead_1', expect.stringMatching(/^Ship it\n\n\(Said on a call with the captain\./) as string]]);
    expect(t.replies().at(-1)).toMatchObject({ content: "Not sent yet: picking Lt. Data's conversation back up on the API key needs your say, on the screens." });
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
    const calls = new Calls(() => undefined, { snapshot: () => Promise.resolve(snapshot), ledger: () => [], startQueued: () => ({}) as Agent, startGoal: () => ({ queued: { id: 'q', text: '', at: 0 } }), message: () => ({ sent: true }) }, { openai: 'sk' }, false);
    expect(calls.status()).toEqual({ missing: 'Calls need TYPESAFE_API_KEY set where the office starts (see plugins/number-one/calls.md)', call: null });
    await expect(calls.start('v=0 offer')).rejects.toThrow('TYPESAFE_API_KEY');
  });
});

describe('callsMissing', () => {
  it('names each missing key, and needs none in the demo', () => {
    expect(callsMissing({}, false)).toBe('Calls need OPENAI_API_KEY and TYPESAFE_API_KEY set where the office starts (see plugins/number-one/calls.md)');
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
