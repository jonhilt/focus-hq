import { describe, expect, it } from 'vitest';
import { createActor, fromPromise, SimulatedClock, type StateValueFrom, waitFor } from 'xstate';
import { callMachine, EXPIRY_MS, type Reply, type RouteInput, SETTLE_MS } from './machine';
import type { Routing, StartGoal } from './route';

const start: StartGoal = { projectId: 'p1', projectName: 'Shop', queueId: 'q1', title: 'Voice mode', station: 1 };

/** A call's machine with stand-ins: `routes` answers each routing in turn; what it says and starts is recorded. */
function call(routes: (Routing | Error | Promise<Routing>)[], started: () => Promise<string> = () => Promise.resolve('Started.')) {
  const clock = new SimulatedClock();
  const routed: RouteInput[] = [];
  const replies: Reply[] = [];
  const instructions: string[] = [];
  const starts: StartGoal[] = [];
  const actor = createActor(
    callMachine.provide({
      actors: {
        route: fromPromise<Routing, RouteInput>(({ input }) => {
          routed.push(input);
          const next = routes.shift() ?? new Error('No routing left');
          return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        }),
        start: fromPromise<string, StartGoal>(({ input }) => {
          starts.push(input);
          return started();
        }),
      },
      actions: {
        reply: (_, reply: Reply) => void replies.push(reply),
        instruct: (_, text: string) => void instructions.push(text),
      },
    }),
    { clock },
  ).start();
  /** The captain says something and the voice model hands it over; the machine settles, then routes it. */
  const say = (text: string, delegation: string) => {
    actor.send({ type: 'heard', text });
    actor.send({ type: 'delegated', id: delegation });
    clock.increment(SETTLE_MS);
  };
  const settled = (state: StateValueFrom<typeof callMachine>) => waitFor(actor, (s) => s.matches(state));
  return { actor, clock, say, settled, routed, replies, instructions, starts };
}

describe('callMachine', () => {
  it('routes what the captain said once they hand it over, and says the answer to that delegation', async () => {
    const c = call([{ kind: 'say', text: 'All quiet.' }]);
    c.actor.send({ type: 'heard', text: "What's the" });
    c.say(' crew  doing?', 'd1');
    await c.settled('listening');
    expect(c.routed).toEqual([{ heard: "What's the crew doing?", pending: null }]);
    expect(c.replies).toEqual([{ delegation: 'd1', text: 'All quiet.' }]);
  });

  it('waits a moment after the hand-over for the end of what was said', async () => {
    const c = call([{ kind: 'say', text: 'Okay.' }]);
    c.actor.send({ type: 'heard', text: 'Start the' });
    c.actor.send({ type: 'delegated', id: 'd1' });
    c.actor.send({ type: 'heard', text: ' next goal' });
    expect(c.routed).toEqual([]);
    c.clock.increment(SETTLE_MS);
    await c.settled('listening');
    expect(c.routed[0].heard).toBe('Start the next goal');
  });

  it('asks before starting a goal, and starts it on the yes', async () => {
    const c = call([{ kind: 'confirm', start, ask: 'Start "Voice mode"?' }, { kind: 'go' }], () => Promise.resolve('Started: Lt. Data has it.'));
    c.say('Start the next goal', 'd1');
    await c.settled('confirming');
    expect(c.replies).toEqual([{ delegation: 'd1', text: 'Ask the captain: Start "Voice mode"?' }]);
    expect(c.instructions[0]).toContain('waiting for the captain\'s yes or no to starting "Voice mode"');
    expect(c.starts).toEqual([]);

    c.say('Make it so', 'd2');
    await c.settled('listening');
    expect(c.routed[1]).toEqual({ heard: 'Make it so', pending: start });
    expect(c.starts).toEqual([start]);
    expect(c.replies.at(-1)).toEqual({ delegation: 'd2', text: 'Started: Lt. Data has it.' });
    expect(c.actor.getSnapshot().context.pending).toBeNull();
  });

  it('starts nothing when the answer isn’t a yes', async () => {
    const c = call([{ kind: 'confirm', start, ask: 'Start it?' }, { kind: 'say', text: 'Okay, left it queued.' }]);
    c.say('Start the next goal', 'd1');
    await c.settled('confirming');
    c.say('Actually, no', 'd2');
    await c.settled('listening');
    expect(c.starts).toEqual([]);
    expect(c.actor.getSnapshot().context.pending).toBeNull();
  });

  it('drops the start when no answer comes in time', async () => {
    const c = call([{ kind: 'confirm', start, ask: 'Start it?' }]);
    c.say('Start the next goal', 'd1');
    await c.settled('confirming');
    c.clock.increment(EXPIRY_MS);
    expect(c.actor.getSnapshot().matches('listening')).toBe(true);
    expect(c.actor.getSnapshot().context.pending).toBeNull();
    expect(c.instructions.at(-1)).toContain('"Voice mode" stays queued');
    expect(c.starts).toEqual([]);
  });

  it('routes a hand-over that came in while it was busy, once it’s free', async () => {
    let answer!: (r: Routing) => void;
    const c = call([new Promise<Routing>((resolve) => (answer = resolve)), { kind: 'say', text: 'Second.' }]);
    c.say('One', 'd1');
    await c.settled({ routing: 'asking' });
    c.actor.send({ type: 'heard', text: 'Two' });
    c.actor.send({ type: 'delegated', id: 'd2' });
    answer({ kind: 'say', text: 'First.' });
    await c.settled({ routing: 'settling' });
    c.clock.increment(SETTLE_MS);
    await c.settled('listening');
    expect(c.replies).toEqual([
      { delegation: 'd1', text: 'First.' },
      { delegation: 'd2', text: 'Second.' },
    ]);
    expect(c.routed.map((r) => r.heard)).toEqual(['One', 'Two']);
  });

  it('says so when routing or starting fails, and carries on listening', async () => {
    const c = call([new Error('Jev is busy'), { kind: 'confirm', start, ask: 'Start it?' }, { kind: 'go' }], () => Promise.reject(new Error('That goal is no longer in line')));
    c.say('Status', 'd1');
    await c.settled('listening');
    expect(c.replies[0]).toEqual({ delegation: 'd1', text: "Sorry, I couldn't work that out: Jev is busy" });
    c.say('Start the next goal', 'd2');
    await c.settled('confirming');
    c.say('Yes', 'd3');
    await waitFor(c.actor, () => c.replies.length === 3);
    expect(c.replies[2]).toEqual({ delegation: 'd3', text: "It didn't start: That goal is no longer in line" });
    expect(c.actor.getSnapshot().matches('listening')).toBe(true);
  });

  it('ends on hanging up, whatever it was doing', async () => {
    const c = call([{ kind: 'confirm', start, ask: 'Start it?' }]);
    c.say('Start the next goal', 'd1');
    await c.settled('confirming');
    c.actor.send({ type: 'hang-up' });
    expect(c.actor.getSnapshot().status).toBe('done');
    c.clock.increment(EXPIRY_MS);
    expect(c.starts).toEqual([]);
  });
});
