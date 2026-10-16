import { assign, setup, type StateValue, transition } from 'xstate';
import type { FileAccount, QaReport, QaScreenshot, QaStatus } from '../../shared/types';
import type { Recovery } from './runJournal';

// A QA review's journal, pure: the facts the office records about one pull request's review (data/runs/reviews/<pr>.jsonl),
// what they add up to, and what the office does with them after a restart. Like an agent's run journal, each fact is on
// disk before the office acts on it, and what they add up to is a state machine's (`reviewMachine`): each fact an event,
// the review's phase its state. The reviewer's turns are in their own run journal; this one is the review around them,
// from being asked for to the verdict on GitHub.

export type Verdict = 'pass' | 'fail';

/** One fact about a pull request's review. */
export type ReviewFact =
  /** Asked for (again): it waits for its reviewer. `head` is the commit a lead's ship pushed. */
  | { kind: 'requested'; head?: string }
  /** The office looks at what changed since QA's last verdict, to see whether QA needs to test it again. */
  | { kind: 'prechecking' }
  /** Nothing to test again: the last verdict stands. */
  | { kind: 'precheck-skipped' }
  /** Only the base branch merged in, cleanly, and the checks are green at `sha`: the pass carries over. */
  | { kind: 'precheck-carried'; sha: string; commentUrl?: string }
  /** It's QA's to test again. */
  | { kind: 'precheck-retest' }
  /** A reviewer sat down to it: checking out, installing. */
  | { kind: 'seated'; agent: string }
  /** Found at startup: its reviewer was still setting up (no Claude turn yet), so it's back in the queue to start again. */
  | { kind: 'restarted' }
  /** The reviewer is testing commit `sha`. */
  | { kind: 'testing'; sha: string }
  /** The reviewer's verdict, and the comment that says it: written before it goes onto the pull request, so a restart posts it. */
  | ({ kind: 'reported' } & Reported)
  /** The comment is on the pull request (or couldn't be put there: no `url`). */
  | { kind: 'posted'; url?: string }
  /** Everyone who hears of a verdict has: the ledger, the PR's lead, and whoever fixes a failed one. */
  | { kind: 'announced' }
  /** It ended without a verdict: stopped, failed, or interrupted when it couldn't carry on. */
  | { kind: 'ended'; error: string }
  /** The pull request merged or closed: the review's over for good. */
  | { kind: 'gone'; merged: boolean };

/** A verdict, as the review's journal keeps it until everyone's heard. */
export interface Reported {
  verdict: Verdict;
  /** The QA officer's name. */
  officer: string;
  /** The comment that says it, on the pull request. */
  body: string;
  /** Rounds of QA the PR has failed, this one included. */
  failedRounds: number;
  report: QaReport;
  screenshots: QaScreenshot[];
  files?: FileAccount;
  /** The commit tested. */
  sha?: string;
}

/** A fact as journaled: numbered from 1 in its review's journal, and when (`t`). */
export type ReviewEntry = ReviewFact & { v: 1; seq: number; t: number };

/** What a review's journal adds up to, besides its phase: the machine's context. */
export interface ReviewContext {
  /** Who's reviewing it, once seated. */
  agent?: string;
  /** The commit under test. */
  sha?: string;
  /** The verdict in hand, and the comment that says it (`url`, once it's posted). */
  reported?: Reported & { url?: string };
  /** The last verdict announced: what a skipped precheck goes back to. */
  verdict?: Verdict;
  error?: string;
}

export interface ReviewState extends ReviewContext {
  phase: StateValue;
  seq: number;
}

export const EMPTY_REVIEW: ReviewState = { phase: 'idle', seq: 0 };

type ReviewEvent = { [K in ReviewFact['kind']]: Extract<ReviewFact, { kind: K }> & { type: K } }[ReviewFact['kind']];

/**
 * What a review's journal adds up to, as a state machine. A review is `queued` for its reviewer (after a `precheck`,
 * for one QA gave a verdict on before), `seated` while its reviewer checks it out, `testing`, then `reported`:
 * `posting` its comment, then `announcing` the verdict, until it has `passed` or `failed`. It can end in `error`
 * without a verdict, and is `gone` for good once its pull request merges or closes. Asked for again once it's over,
 * it's queued again.
 */
const START: ReviewContext = {};

export const reviewMachine = setup({
  types: {
    context: START,
    events: {} as ReviewEvent,
  },
  guards: {
    passed: ({ context }) => context.reported?.verdict === 'pass',
    'passed before': ({ context }) => context.verdict === 'pass',
  },
}).createMachine({
  id: 'review',
  context: START,
  initial: 'idle',
  on: {
    gone: '.gone',
  },
  states: {
    idle: { on: { requested: 'queued' } },
    queued: {
      on: {
        prechecking: 'precheck',
        seated: { target: 'seated', actions: assign(({ event }) => ({ agent: event.agent, error: undefined })) },
        ended: { target: 'error', actions: assign(({ event }) => ({ error: event.error })) },
      },
    },
    precheck: {
      on: {
        'precheck-skipped': [{ guard: 'passed before', target: 'passed' }, { target: 'failed' }],
        'precheck-carried': { target: 'passed', actions: assign(({ event }) => ({ sha: event.sha, verdict: 'pass' as const })) },
        'precheck-retest': 'queued',
      },
    },
    seated: {
      on: {
        restarted: 'queued',
        testing: { target: 'testing', actions: assign(({ event }) => ({ sha: event.sha })) },
        ended: { target: 'error', actions: assign(({ event }) => ({ error: event.error })) },
      },
    },
    testing: {
      on: {
        reported: { target: 'reported', actions: assign(({ event: { type: _, kind: __, ...reported } }) => ({ reported })) },
        ended: { target: 'error', actions: assign(({ event }) => ({ error: event.error })) },
      },
    },
    reported: {
      initial: 'posting',
      states: {
        posting: { on: { posted: { target: 'announcing', actions: assign(({ context, event }) => ({ reported: context.reported && { ...context.reported, url: event.url } })) } } },
        announcing: {
          on: {
            announced: [
              { guard: 'passed', target: '#review.passed', actions: assign({ verdict: 'pass' as const }) },
              { target: '#review.failed', actions: assign({ verdict: 'fail' as const }) },
            ],
          },
        },
      },
    },
    passed: { on: { requested: 'queued' } },
    failed: { on: { requested: 'queued' } },
    error: { on: { requested: 'queued' } },
    gone: { type: 'final' },
  },
});

/** The review after one more fact. */
export function evolveReview(state: ReviewState, entry: ReviewFact & { seq?: number }): ReviewState {
  const { phase, seq, ...context } = state;
  const [next] = transition(reviewMachine, reviewMachine.resolveState({ value: phase, context }), { ...entry, type: entry.kind } as ReviewEvent);
  return { ...next.context, phase: next.value, seq: entry.seq ?? seq + 1 };
}

/** The review its journal tells, from the start. */
export function foldReview(entries: readonly (ReviewFact & { seq?: number })[]): ReviewState {
  return entries.reduce(evolveReview, EMPTY_REVIEW);
}

/** What the office does at startup with a review its journal says was under way. */
export type ReviewRecovery =
  /** Nothing was under way. */
  | { kind: 'none' }
  /** It was waiting for a reviewer: it waits for one again. */
  | { kind: 'queue' }
  /** The office was looking at what changed since the last verdict: QA tests it instead. */
  | { kind: 'retest' }
  /** Its reviewer was setting up, before any Claude turn: back in the queue, to start again. */
  | { kind: 'restart' }
  /** Its reviewer's run picks itself back up (their turn resumes, or waits out a hold): the review carries on with it. */
  | { kind: 'carry-on' }
  /** It can't carry on by itself: it ends without a verdict, and the captain sends it to QA again. */
  | { kind: 'interrupted'; error: string }
  /** The verdict's in hand: the office posts it, then tells everyone who hears of it. */
  | { kind: 'post' }
  /** The verdict's posted: the office tells everyone who hears of it. */
  | { kind: 'announce' };

export const REVIEW_INTERRUPTED = 'Interrupted when Focus shut down. Send it to QA again.';

/** What its reviewer's run does after a restart that keeps the review going with it. */
const CARRIES_ON: ReadonlySet<Recovery['kind']> = new Set(['resume', 'hold-again', 'requeue']);

/**
 * What to do at startup with a review, from its journal, what the board last saved of it (`saved`, for a review from
 * before it had a journal), and what its reviewer's run does after the restart (`reviewer`, from their run journal).
 */
export function reviewRecovery(review: ReviewState, saved: QaStatus, reviewer: Recovery['kind'] | undefined): ReviewRecovery {
  const at = (phase: string) => review.phase === phase;
  if (typeof review.phase === 'object' && 'reported' in review.phase) return { kind: review.phase.reported === 'announcing' ? 'announce' : 'post' };
  if (at('queued')) return { kind: 'queue' };
  if (at('precheck')) return { kind: 'retest' };
  if (at('seated')) return { kind: 'restart' };
  if (at('testing')) return reviewer && CARRIES_ON.has(reviewer) ? { kind: 'carry-on' } : { kind: 'interrupted', error: REVIEW_INTERRUPTED };
  // one from before reviews had journals, under way when Focus shut down
  if (at('idle') && (saved === 'queued' || saved === 'testing')) return { kind: 'interrupted', error: REVIEW_INTERRUPTED };
  return { kind: 'none' };
}
