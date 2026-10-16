import { ATTACH_TRIES, CLOUD_UNAVAILABLE } from './cloud';
import type { RunOutcome } from './types';

// What follows an agent's turn, as a state machine: the state the turn ends in (where it ran), the event its end is
// (read from its outcome, `turnEvent`), and the run's transitions (`RUN_MACHINE`). A state hands an event it has no
// transition for (or none whose guard passes) up to its parent, as a statechart does; `turn`, at the top, takes every
// event. Pure data and a small interpreter (`step`): the manager does what the target says (`runSession`).

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
  /** Claude Code signed the turn in with a key that costs, when the office meant your plan's login. */
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
  /** Signed in with the key behind the office's back: the agent fails, saying where to look. */
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

/** A condition on the run, named so the machine reads (and draws) as it decides. */
export interface Guard {
  name: string;
  test: (c: RunContext) => boolean;
}

const guard = (name: string, test: Guard['test']): Guard => ({ name, test });
const triesLeft = guard('tries left', (c) => c.tries < ATTACH_TRIES);
const workedThere = guard('worked there', (c) => c.hasSession);
const attachRefused = guard('attach refused', (c) => c.attachRefused);
const resumed = guard('resumed', (c) => c.resumed);
const leadResumed = guard('a lead, resumed', (c) => c.role === 'lead' && c.resumed);
const messages = guard('messages waiting', (c) => c.carryOn);
const review = guard('QA', (c) => c.role === 'review');
const lead = guard('a lead', (c) => c.role === 'lead');

/** A transition taken when its guard passes. */
export interface Guarded {
  to: Target;
  when: Guard;
}

/** A state's transitions for an event, tried in order: the last, unguarded, always taken. */
export type Transitions = Target | readonly [...Guarded[], Target];

type EventType = TurnEvent['type'];

export interface StateNode {
  /** Where an event goes that this state has no transition for, or none whose guard passed. */
  parent: TurnState | 'turn';
  on: Partial<Record<EventType, Transitions | readonly Guarded[]>>;
}

/** Whatever the turn's end, once the state it ran in has had its say: every event has a way out. */
const FAILED: Transitions = [{ to: 'carry-on', when: messages }, 'fail'];

export const RUN_MACHINE: { states: Record<TurnState, StateNode>; turn: { on: Record<EventType, Transitions> } } = {
  states: {
    attaching: {
      parent: 'cloud',
      on: {
        busy: [{ to: 'attach-again', when: triesLeft }, 'attach-failed'],
        refused: 'attach-refused',
        asking: 'attach-failed',
        gone: 'attach-failed',
        unstarted: 'attach-failed',
      },
    },
    cloud: {
      parent: 'turn',
      on: {
        refused: [{ to: 'cloud-to-local', when: workedThere }, { to: 'cloud-carry-on-here', when: attachRefused }, 'cloud-await'],
        gone: [{ to: 'new-cloud-session', when: resumed }],
        unstarted: [{ to: 'new-cloud-session', when: resumed }],
      },
    },
    local: {
      parent: 'turn',
      on: {
        gone: [{ to: 'fresh-session', when: leadResumed }],
      },
    },
  },
  turn: {
    on: {
      mismatch: 'sign-in-mismatch',
      limited: 'limited',
      stopped: 'stopped',
      refused: FAILED,
      busy: FAILED,
      asking: FAILED,
      gone: FAILED,
      unstarted: FAILED,
      failed: FAILED,
      done: [{ to: 'carry-on', when: messages }, { to: 'finish-review', when: review }, { to: 'lead-done', when: lead }, 'deliver'],
    },
  },
};

/** The first of `transitions` whose guard passes, if any does. */
function take(transitions: Transitions | readonly Guarded[] | undefined, c: RunContext): Target | undefined {
  if (typeof transitions === 'string') return transitions;
  return transitions?.map((t) => (typeof t === 'string' ? t : t.when.test(c) ? t.to : undefined)).find((to) => to !== undefined);
}

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
const UNSTARTED: [EventType & ('busy' | 'asking' | 'gone'), RegExp][] = [
  ['busy', /\bis busy\b/i],
  ['asking', /waiting on a question/i],
  ['gone', /no conversation found/i],
];

/** One step of the machine: where a turn that ended in `state` with `event` goes, from its state up to `turn`. */
export function step(state: TurnState, event: TurnEvent, c: RunContext): Target {
  let node: StateNode | undefined = RUN_MACHINE.states[state];
  while (node) {
    const to = take(node.on[event.type], c);
    if (to) return to;
    node = node.parent === 'turn' ? undefined : RUN_MACHINE.states[node.parent];
  }
  return take(RUN_MACHINE.turn.on[event.type], c) ?? 'fail';
}
