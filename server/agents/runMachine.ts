import { setup, transition } from 'xstate';
import type { RunOutcome } from './types';

// What follows an agent's turn, as a state machine (XState, `runMachine`): the event its end is (read from its outcome,
// `turnEvent`), and the target it goes to. A state hands an event it has no transition for (or none whose guard passes)
// up to its parent; `turn`, at the top, takes every event. `step` takes one transition, purely: the manager does what
// the target says (`runSession`).

/** What the run's guards read. */
export interface RunContext {
  /** QA's review, a goal's lead (with a goal to lead), or anyone else's work. */
  role: 'review' | 'lead' | 'work';
  /** The turn went back into a conversation (resumed a session). */
  resumed: boolean;
  /** The manager wrote while the turn was wrapping up: messages are waiting. */
  carryOn: boolean;
}

/** What a turn's end was. */
export type TurnEvent =
  | { type: 'done' }
  /** Claude Code signed the turn in with a key that costs, when Ops meant your plan's login. */
  | { type: 'mismatch'; observed: string }
  /** Your plan's usage limit stopped it. */
  | { type: 'limited' }
  /** The captain stopped it (or sent them home). */
  | { type: 'stopped' }
  /** Before Claude Code got going: it no longer has the conversation the turn went back into, … */
  | { type: 'gone'; error: string }
  /** … or something else stopped it. */
  | { type: 'unstarted'; error: string }
  /** It failed part way through. */
  | { type: 'failed'; error: string };

/** What follows the turn: where the run goes next. */
export type Target =
  /** Signed in with the key behind Ops' back: the agent fails, saying where to look. */
  | 'sign-in-mismatch'
  /** Carry on with your API key, now or once your plan's limit resets. */
  | 'limited'
  | 'stopped'
  /** Claude Code no longer has a lead's conversation: a new one, told where the goal stands. */
  | 'fresh-session'
  /** Messages are waiting: another turn in the same conversation. */
  | 'carry-on'
  | 'fail'
  /** QA's review is over: their report. */
  | 'finish-review'
  /** The lead's turn is over: it's the captain's turn. */
  | 'lead-done'
  /** A developer's work is done: onto GitHub. */
  | 'deliver';

/** Whatever the turn's end, once the state it ran in has had its say: messages waiting carry it on, or it failed. */
const failed = (): [{ guard: 'messages waiting'; target: '#run.carry-on' }, { target: '#run.fail' }] => [{ guard: 'messages waiting', target: '#run.carry-on' }, { target: '#run.fail' }];

/** Each target is a final state: where the run goes next. */
const final = { type: 'final' } as const;

/**
 * The run's machine (XState): a turn runs `local`ly, within `turn`. An event a state has no transition for (or none whose guard passes) goes up to its
 * parent, and `turn` has a way out of every event. Its transitions are pure: `step` takes one, and nothing runs.
 */
export const runMachine = setup({
  types: {
    context: {} as RunContext,
    events: {} as TurnEvent,
    input: {} as RunContext,
  },
  guards: {
    'a lead, resumed': ({ context }) => context.role === 'lead' && context.resumed,
    'messages waiting': ({ context }) => context.carryOn,
    QA: ({ context }) => context.role === 'review',
    'a lead': ({ context }) => context.role === 'lead',
  },
}).createMachine({
  id: 'run',
  context: ({ input }) => input,
  initial: 'turn',
  states: {
    turn: {
      initial: 'local',
      on: {
        mismatch: '#run.sign-in-mismatch',
        limited: '#run.limited',
        stopped: '#run.stopped',
        gone: failed(),
        unstarted: failed(),
        failed: failed(),
        done: [
          { guard: 'messages waiting', target: '#run.carry-on' },
          { guard: 'QA', target: '#run.finish-review' },
          { guard: 'a lead', target: '#run.lead-done' },
          { target: '#run.deliver' },
        ],
      },
      states: {
        local: {
          on: {
            gone: { guard: 'a lead, resumed', target: '#run.fresh-session' },
          },
        },
      },
    },
    'sign-in-mismatch': final,
    limited: final,
    stopped: final,
    'fresh-session': final,
    'carry-on': final,
    fail: final,
    'finish-review': final,
    'lead-done': final,
    deliver: final,
  },
});

/** A turn's end as the run's event: the one place its outcome is read. */
export function turnEvent(outcome: RunOutcome, mismatch?: string): TurnEvent {
  if (mismatch) return { type: 'mismatch', observed: mismatch };
  if (outcome.limited) return { type: 'limited' };
  if (outcome.aborted) return { type: 'stopped' };
  if (outcome.ok) return { type: 'done' };
  const error = outcome.error ?? 'The agent stopped with an error';
  if (outcome.started) return { type: 'failed', error };
  // it never got going: why not
  return { type: UNSTARTED.find(([, said]) => said.test(error))?.[0] ?? 'unstarted', error };
}

/** What Claude Code says when a session doesn't get going, by the event it is. */
const UNSTARTED: ['gone', RegExp][] = [['gone', /no conversation found/i]];

/** One step of the machine: where a turn that ended with `event` goes, its context deciding the guards. */
export function step(event: TurnEvent, context: RunContext): Target {
  const [next] = transition(runMachine, runMachine.resolveState({ value: { turn: 'local' }, context }), event);
  // every event has a way out of `turn`, to a target: a machine that stayed put is one that changed without its tests
  return typeof next.value === 'string' ? next.value : 'fail';
}
