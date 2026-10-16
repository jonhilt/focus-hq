import { attachAgain, carryOnInNewSession, CLOUD_UNAVAILABLE, fallBackToLocal } from './cloud';
import { sessionGone } from './lead';
import type { RunOutcome } from './types';

/** What decides what follows an agent's turn: how it ended, and where the agent stands. */
export interface TurnEnd<A extends { tries: number } = { tries: number }> {
  outcome: RunOutcome;
  /** QA's review, a goal's lead (with a goal to lead), or anyone else's work. */
  role: 'review' | 'lead' | 'work';
  /** They work in a cloud session. */
  cloud: boolean;
  /** They have a session id already: a cloud agent's means it worked there. */
  hasSession: boolean;
  /** The turn went back into a conversation (resumed a session). */
  resumed: boolean;
  /** Attaching to a cloud session the captain started: how often it was still busy. */
  attaching?: A;
  /** Claude Code has refused to attach to a cloud session from Focus before. */
  attachRefused: boolean;
  /** The manager wrote while the turn was wrapping up. */
  carryOn: boolean;
  /** Claude Code signed the turn in with a key that costs, when the office meant your plan's login. */
  mismatch?: string;
}

/** What follows a turn. */
export type AfterTurn<A = { tries: number }> =
  /** The cloud session the captain started is still answering its first message: try again shortly. */
  | { kind: 'attach-again'; attaching: A }
  /** Claude Code won't attach from Focus at all: carry on here, from the hand-over. */
  | { kind: 'attach-refused'; attaching: A }
  /** Attaching failed some other way: wait for the captain to start the cloud session again. */
  | { kind: 'attach-failed'; attaching: A }
  /** Signed in with the key behind the office's back: the turn was stopped, and the agent fails with why. */
  | { kind: 'sign-in-mismatch'; observed: string }
  /** Your plan's usage limit stopped them: carry on with your API key, now or once it resets. */
  | { kind: 'limited' }
  /** Stopped by the captain (or sent home). */
  | { kind: 'stopped' }
  /** Claude Code won't start a cloud session from Focus, and they haven't started: carry on here (it won't attach either). */
  | { kind: 'cloud-carry-on-here' }
  /** … and they haven't started: the captain starts their cloud session from a terminal, or keeps them here. */
  | { kind: 'cloud-await' }
  /** … and they'd worked there: carry on here from what they pushed. */
  | { kind: 'cloud-to-local' }
  /** Claude Code no longer has a lead's conversation: a new one, told where the goal stands. */
  | { kind: 'fresh-session' }
  /** A cloud session that couldn't be got back into: a new one picks up from the branch. */
  | { kind: 'new-cloud-session' }
  /** The manager wrote as the turn ended: another turn in the same conversation. */
  | { kind: 'carry-on' }
  | { kind: 'fail'; error: string }
  /** QA's review is over: their report. */
  | { kind: 'finish-review' }
  /** The lead's turn is over: it's the captain's turn. */
  | { kind: 'lead-done' }
  /** A developer's work is done: onto GitHub. */
  | { kind: 'deliver' };

/** What follows a turn, in the order the cases are told apart. Pure: the manager does what it says (`runSession`). */
export function afterTurn<A extends { tries: number }>(end: TurnEnd<A>): AfterTurn<A> {
  const { outcome } = end;
  const { attaching } = end;
  if (attaching) {
    if (attachAgain(outcome, attaching.tries)) return { kind: 'attach-again', attaching };
    if (!outcome.ok && !outcome.aborted && !outcome.started) {
      return { kind: outcome.error === CLOUD_UNAVAILABLE ? 'attach-refused' : 'attach-failed', attaching };
    }
  }
  if (end.mismatch) return { kind: 'sign-in-mismatch', observed: end.mismatch };
  if (outcome.limited) return { kind: 'limited' };
  if (outcome.aborted) return { kind: 'stopped' };
  if (fallBackToLocal(end, outcome)) {
    if (end.hasSession) return { kind: 'cloud-to-local' };
    return { kind: end.attachRefused ? 'cloud-carry-on-here' : 'cloud-await' };
  }
  if (end.role === 'lead' && sessionGone(outcome, end.resumed)) return { kind: 'fresh-session' };
  if (end.cloud && carryOnInNewSession(outcome, end.resumed)) return { kind: 'new-cloud-session' };
  if (end.carryOn) return { kind: 'carry-on' };
  if (!outcome.ok) return { kind: 'fail', error: outcome.error ?? 'The agent stopped with an error' };
  if (end.role === 'review') return { kind: 'finish-review' };
  if (end.role === 'lead') return { kind: 'lead-done' };
  return { kind: 'deliver' };
}
