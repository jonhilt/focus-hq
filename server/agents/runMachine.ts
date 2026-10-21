import { setup, type StateValue, transition } from 'xstate';
import { ATTACH_TRIES, CLOUD_UNAVAILABLE } from './cloud';
import type { RunOutcome } from './types';

// What follows an agent's turn, as a state machine (XState, `runMachine`): the state the turn ends in (where it ran),
// the event its end is (read from its outcome, `turnEvent`), and the target it goes to. A state hands an event it has no
// transition for (or none whose guard passes) up to its parent; `turn`, at the top, takes every event. `step` takes one
// transition, purely: the manager does what the target says (`runSession`).

/** Where the turn ran: on this machine, in a cloud session, or attaching to a cloud session the captain started. */
export type TurnState = 'local' | 'cloud' | 'attaching';

/** What the run's guards read. */
export interface RunContext {
  /** QA's review, a goal's lead (with a goal to lead), or anyone else's work. */
  role: 'review' | 'lead' | 'work';
  /** The turn went back into a conversation (resumed a session). */
  resumed: boolean;
  /** They have a session id already: a cloud agent's means it worked there. */
  hasSession: boolean;
  /** Attaching to a cloud session the captain started: how often it was still busy. */
  tries: number;
  /** Claude Code has refused to attach to a cloud session from Focus before. */
  attachRefused: boolean;
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
  /** Claude Code won't run a cloud session from Focus. */
  | { type: 'refused'; error: string }
  /** Before Claude Code got going: its cloud session was busy with a turn, … */
  | { type: 'busy'; error: string }
  /** … or waiting on a question, … */
  | { type: 'asking'; error: string }
  /** … or it no longer has the conversation the turn went back into, … */
  | { type: 'gone'; error: string }
  /** … or something else stopped it. */
  | { type: 'unstarted'; error: string }
  /** It failed part way through. */
  | { type: 'failed'; error: string };

/** What follows the turn: where the run goes next. */
export type Target =
  /** The cloud session the captain started is still answering its first message: try again shortly. */
  | 'attach-again'
  /** Claude Code won't attach from Focus at all: carry on here, from the hand-over. */
  | 'attach-refused'
  /** Attaching failed some other way: wait for the captain to start the cloud session again. */
  | 'attach-failed'
  /** Signed in with the key behind Ops' back: the agent fails, saying where to look. */
  | 'sign-in-mismatch'
  /** Carry on with your API key, now or once your plan's limit resets. */
  | 'limited'
  | 'stopped'
  /** No cloud session (it never started), and attaching is refused too: carry on here. */
  | 'cloud-carry-on-here'
  /** No cloud session (it never started): the captain starts one from a terminal, or keeps them here. */
  | 'cloud-await'
  /** No cloud session any more, after working there: carry on here from what they pushed. */
  | 'cloud-to-local'
  /** Claude Code no longer has a lead's conversation: a new one, told where the goal stands. */
  | 'fresh-session'
  /** A cloud session that couldn't be got back into: a new one picks up from the branch. */
  | 'new-cloud-session'
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
 * The run's machine (XState): a turn runs `local`ly or in the `cloud` (`attaching`, to a session the captain started,
 * within it), all within `turn`. An event a state has no transition for (or none whose guard passes) goes up to its
 * parent, and `turn` has a way out of every event. Its transitions are pure: `step` takes one, and nothing runs.
 */
export const runMachine = setup({
  types: {
    context: {} as RunContext,
    events: {} as TurnEvent,
    input: {} as RunContext,
  },
  guards: {
    'tries left': ({ context }) => context.tries < ATTACH_TRIES,
    'worked there': ({ context }) => context.hasSession,
    'attach refused': ({ context }) => context.attachRefused,
    resumed: ({ context }) => context.resumed,
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
        refused: failed(),
        busy: failed(),
        asking: failed(),
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
        cloud: {
          initial: 'running',
          on: {
            refused: [
              { guard: 'worked there', target: '#run.cloud-to-local' },
              { guard: 'attach refused', target: '#run.cloud-carry-on-here' },
              { target: '#run.cloud-await' },
            ],
            gone: { guard: 'resumed', target: '#run.new-cloud-session' },
            unstarted: { guard: 'resumed', target: '#run.new-cloud-session' },
          },
          states: {
            running: {},
            attaching: {
              on: {
                busy: [{ guard: 'tries left', target: '#run.attach-again' }, { target: '#run.attach-failed' }],
                refused: '#run.attach-refused',
                asking: '#run.attach-failed',
                gone: '#run.attach-failed',
                unstarted: '#run.attach-failed',
              },
            },
          },
        },
      },
    },
    'attach-again': final,
    'attach-refused': final,
    'attach-failed': final,
    'sign-in-mismatch': final,
    limited: final,
    stopped: final,
    'cloud-carry-on-here': final,
    'cloud-await': final,
    'cloud-to-local': final,
    'fresh-session': final,
    'new-cloud-session': final,
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
  if (outcome.error === CLOUD_UNAVAILABLE) return { type: 'refused', error };
  if (outcome.started) return { type: 'failed', error };
  // it never got going: why not
  return { type: UNSTARTED.find(([, said]) => said.test(error))?.[0] ?? 'unstarted', error };
}

/** What Claude Code says when a session doesn't get going, by the event it is. */
const UNSTARTED: ['busy' | 'asking' | 'gone', RegExp][] = [
  ['busy', /\bis busy\b/i],
  ['asking', /waiting on a question/i],
  ['gone', /no conversation found/i],
];

/** Where each state the turn ran in is, in the machine. */
const AT: Record<TurnState, StateValue> = { local: { turn: 'local' }, cloud: { turn: { cloud: 'running' } }, attaching: { turn: { cloud: 'attaching' } } };

/** One step of the machine: where a turn that ended in `state` with `event` goes, its context deciding the guards. */
export function step(state: TurnState, event: TurnEvent, context: RunContext): Target {
  const [next] = transition(runMachine, runMachine.resolveState({ value: AT[state], context }), event);
  // every event has a way out of `turn`, to a target: a machine that stayed put is one that changed without its tests
  return typeof next.value === 'string' ? next.value : 'fail';
}
