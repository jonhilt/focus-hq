import { assign, setup, type StateValue, transition } from 'xstate';
import type { CrewStamp } from '../../shared/ledger';
import type { AgentStatus, FileAccount, QaFollowUp, QaReport, QaReview, QaScreenshot, Triage } from '../../shared/types';
import type { Recovery } from './runJournal';

// A QA review's journal, pure: the facts Ops records about one pull request's review (data/runs/reviews/<pr>.jsonl),
// what they add up to, and what Ops does with them after a restart. Like an agent's run journal, each fact is on
// disk before Ops acts on it, and what they add up to is a state machine's (`reviewMachine`): each fact an event,
// the review's phase its state. The reviewer's turns are in their own run journal; this one is the review around them,
// from being asked for to the verdict on GitHub.

export type Verdict = 'pass' | 'fail';

/** One fact about a pull request's review. */
export type ReviewFact =
  /**
   * Asked for (again): it waits for its reviewer. `head` is the commit a lead's ship pushed; `retryNote` why the
   * operations officer sent it back to QA. What the last round left (failed rounds, the report, a merge asked for) carries over.
   */
  | { kind: 'requested'; projectId: string; repo: string; number: number; title: string; head?: string; openedByOffice?: boolean; retryNote?: string }
  /** A lead shipped `sha` while QA was at the PR: QA goes on to it once they finish. */
  | { kind: 'head-shipped'; sha: string }
  /** The captain asked for the PR to merge once QA passes it, or took that back. */
  | { kind: 'merge-requested'; on: boolean }
  /** Ops looks at what changed since QA's last verdict, to see whether QA needs to test it again. */
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
  /** Its reviewer went home (their goal closed): back in the queue, for the room's QA officer. */
  | { kind: 'unseated' }
  /** The reviewer is testing commit `sha` (the pull request called `title` now). */
  | { kind: 'testing'; sha: string; title?: string }
  /** The reviewer's verdict, and the comment that says it: written before it goes onto the pull request, so a restart posts it. */
  | ({ kind: 'reported' } & Reported)
  /** The comment is on the pull request (or couldn't be put there: no `url`): the verdict's QA's from here. */
  | { kind: 'posted'; url?: string }
  /** Everyone who hears of a verdict has: the ledger, the PR's lead, and whoever fixes a failed one. */
  | { kind: 'announced' }
  /**
   * It ended without a verdict: stopped, failed, or interrupted when it couldn't carry on. `noVerdict`: its reviewer's
   * session was over without one (no report, or Ops couldn't finish it), so it's the captain's (`leftWithoutVerdict`).
   */
  | { kind: 'ended'; error: string; noVerdict?: boolean }
  /** What Ops is doing about a failed PR: a developer fixing it, or you wanted (none: nothing now). */
  | { kind: 'follow-up'; followUp?: Exclude<QaFollowUp, { kind: 'triaging' }> }
  /** The PR's stuck: the room's operations officer comes over to look. */
  | { kind: 'triaging'; officer: string }
  /** What the operations officer is doing now, as they look. */
  | { kind: 'triage-activity'; text: string }
  /** What the operations officer decided. */
  | { kind: 'triaged'; triage: Triage }
  /** A review the board kept before reviews had journals, taken in as it was. */
  | { kind: 'imported'; review: QaReview }
  /** The pull request merged or closed (or its room went): the review's over for good. */
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
  /** What QA worked to: its crew file's digest, model and effort, and Focus's commit. Verdicts journaled before it have none. */
  crew?: CrewStamp;
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
  /** The review as the board shows it (`reviewView`), built from the facts alone. */
  view?: QaReview;
  /** The board's review before it was asked for again: what a precheck that finds nothing to test puts back. */
  previous?: QaReview;
}

export interface ReviewState extends ReviewContext {
  phase: StateValue;
  seq: number;
}

export const EMPTY_REVIEW: ReviewState = { phase: 'idle', seq: 0 };

type ReviewEvent = { [K in ReviewFact['kind']]: Extract<ReviewFact, { kind: K }> & { type: K; t?: number } }[ReviewFact['kind']];
type Event<K extends ReviewFact['kind']> = Extract<ReviewEvent, { type: K }>;

/** The board's review, changed (none to change once it's gone). */
const onView = (context: ReviewContext, f: (view: QaReview) => QaReview): Partial<ReviewContext> => (context.view ? { view: f(context.view) } : {});

/** A review asked for (again), carrying over what its last round left. */
function requested(e: Event<'requested'>, last: QaReview | undefined): QaReview {
  return {
    projectId: e.projectId,
    repo: e.repo,
    number: e.number,
    title: e.title,
    status: 'queued',
    requestedAt: e.t ?? 0,
    ...(e.openedByOffice !== undefined && { openedByOffice: e.openedByOffice }),
    ...(e.head && { shippedHead: e.head }),
    ...(e.retryNote && { retryNote: e.retryNote }),
    failedRounds: last?.failedRounds,
    lastRound: last?.report ? { sha: last.sha, report: last.report } : last?.lastRound,
    triages: last?.triages,
    triage: last?.triage,
    mergeRequested: last?.mergeRequested,
  };
}

/** The board's review once it's ended without a verdict. */
function endedView(view: QaReview, e: Event<'ended'>): QaReview {
  return { ...view, status: 'error', error: e.error, finishedAt: e.t ?? 0, ...(e.noVerdict && { noVerdict: true }) };
}

/** The board's review once the verdict's posted. */
function verdictView(view: QaReview, r: Reported & { url?: string }, t: number): QaReview {
  return { ...view, status: r.verdict === 'pass' ? 'passed' : 'failed', report: r.report, screenshots: r.screenshots, commentUrl: r.url, files: r.files, failedRounds: r.failedRounds, finishedAt: t, error: undefined };
}

/**
 * What a review's journal adds up to, as a state machine. A review is `queued` for its reviewer (after a `precheck`,
 * for one QA gave a verdict on before), `seated` while its reviewer checks it out, `testing`, then `reported`:
 * `posting` its comment, then `announcing` the verdict, until it has `passed` or `failed`. It can end in `error`
 * without a verdict, and is `gone` once its pull request merges or closes. Asked for again once it's over (or its
 * pull request is reopened), it's queued again. Its context keeps the review as the board shows it (`view`): every change the board shows is a
 * fact, so the board's review is rebuilt from the journal like everything else.
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
    'was queued': ({ event }) => event.type === 'imported' && event.review.status === 'queued',
    'was testing': ({ event }) => event.type === 'imported' && event.review.status === 'testing',
    'had passed': ({ event }) => event.type === 'imported' && event.review.status === 'passed',
    'had failed': ({ event }) => event.type === 'imported' && event.review.status === 'failed',
  },
}).createMachine({
  id: 'review',
  context: START,
  initial: 'idle',
  on: {
    gone: { target: '.gone', actions: assign({ view: undefined, previous: undefined }) },
    'head-shipped': { actions: assign(({ context, event: e }) => onView(context, (v) => ({ ...v, shippedHead: e.sha }))) },
    'merge-requested': { actions: assign(({ context, event: e }) => onView(context, (v) => ({ ...v, mergeRequested: e.on ? { at: e.t ?? 0 } : undefined }))) },
    'follow-up': { actions: assign(({ context, event: e }) => onView(context, (v) => ({ ...v, followUp: e.followUp }))) },
    triaging: { actions: assign(({ context, event: e }) => onView(context, (v) => ({ ...v, triages: (v.triages ?? 0) + 1, followUp: { kind: 'triaging', officer: e.officer, activity: 'Coming over to look' } }))) },
    'triage-activity': { actions: assign(({ context, event: e }) => onView(context, (v) => (v.followUp?.kind === 'triaging' ? { ...v, followUp: { ...v.followUp, activity: e.text } } : v))) },
    triaged: { actions: assign(({ context, event: e }) => onView(context, (v) => ({ ...v, triage: e.triage }))) },
    // a review the board kept before journals: in the phase its status says, its verdict the last one
    imported: [
      { guard: 'was queued', target: '.queued', actions: assign(({ event }) => importedContext(event)) },
      { guard: 'was testing', target: '.testing', actions: assign(({ event }) => importedContext(event)) },
      { guard: 'had passed', target: '.passed', actions: assign(({ event }) => ({ ...importedContext(event), verdict: 'pass' as const })) },
      { guard: 'had failed', target: '.failed', actions: assign(({ event }) => ({ ...importedContext(event), verdict: 'fail' as const })) },
      { target: '.error', actions: assign(({ event }) => importedContext(event)) },
    ],
  },
  states: {
    idle: { on: { requested: { target: 'queued', actions: assign(({ context, event }) => ({ view: requested(event, context.view), previous: context.view })) } } },
    queued: {
      on: {
        prechecking: 'precheck',
        seated: { target: 'seated', actions: [assign(({ event }) => ({ agent: event.agent, error: undefined })), assign(({ context, event: e }) => onView(context, (v) => ({ ...v, agentId: e.agent })))] },
        ended: { target: 'error', actions: [assign(({ event }) => ({ error: event.error })), assign(({ context, event: e }) => onView(context, (v) => endedView(v, e)))] },
      },
    },
    precheck: {
      on: {
        // the last verdict stands, with what the captain asked since
        'precheck-skipped': [
          { guard: 'passed before', target: 'passed', actions: assign(({ context }) => ({ view: context.previous && { ...context.previous, mergeRequested: context.view?.mergeRequested } })) },
          { target: 'failed', actions: assign(({ context }) => ({ view: context.previous && { ...context.previous, mergeRequested: context.view?.mergeRequested } })) },
        ],
        'precheck-carried': {
          target: 'passed',
          actions: assign(({ context, event }) => ({
            sha: event.sha,
            verdict: 'pass' as const,
            view: context.previous && { ...context.previous, status: 'passed' as const, sha: event.sha, carriedFrom: context.previous.sha, commentUrl: event.commentUrl ?? context.previous.commentUrl, mergeRequested: context.view?.mergeRequested, requestedAt: context.view?.requestedAt ?? 0, finishedAt: event.t ?? 0 },
          })),
        },
        'precheck-retest': 'queued',
      },
    },
    seated: {
      on: {
        restarted: { target: 'queued', actions: assign(({ context }) => onView(context, (v) => ({ ...v, status: 'queued', agentId: undefined }))) },
        unseated: { target: 'queued', actions: assign(({ context }) => onView(context, (v) => ({ ...v, status: 'queued', agentId: undefined }))) },
        testing: { target: 'testing', actions: [assign(({ event }) => ({ sha: event.sha })), assign(({ context, event: e }) => onView(context, (v) => ({ ...v, status: 'testing', sha: e.sha, title: e.title ?? v.title, error: undefined })))] },
        ended: { target: 'error', actions: [assign(({ event }) => ({ error: event.error })), assign(({ context, event: e }) => onView(context, (v) => endedView(v, e)))] },
      },
    },
    testing: {
      on: {
        unseated: { target: 'queued', actions: assign(({ context }) => onView(context, (v) => ({ ...v, status: 'queued', agentId: undefined }))) },
        reported: { target: 'reported', actions: assign(({ event: { type: _, kind: __, t: ___, ...reported } }) => ({ reported })) },
        ended: { target: 'error', actions: [assign(({ event }) => ({ error: event.error })), assign(({ context, event: e }) => onView(context, (v) => endedView(v, e)))] },
      },
    },
    reported: {
      initial: 'posting',
      states: {
        posting: {
          on: {
            posted: {
              target: 'announcing',
              actions: assign(({ context, event }) => {
                const reported = context.reported && { ...context.reported, url: event.url };
                return { reported, view: context.view && reported ? verdictView(context.view, reported, event.t ?? 0) : context.view };
              }),
            },
          },
        },
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
    passed: { on: { requested: { target: 'queued', actions: assign(({ context, event }) => ({ view: requested(event, context.view), previous: context.view })) } } },
    failed: { on: { requested: { target: 'queued', actions: assign(({ context, event }) => ({ view: requested(event, context.view), previous: context.view })) } } },
    error: { on: { requested: { target: 'queued', actions: assign(({ context, event }) => ({ view: requested(event, context.view), previous: context.view })) } } },
    // a pull request reopened can be sent to QA again, from nothing
    gone: { on: { requested: { target: 'queued', actions: assign(({ event }) => ({ view: requested(event, undefined), previous: undefined })) } } },
  },
});

/** The context a review taken in from the board starts from. */
function importedContext(event: ReviewEvent): Partial<ReviewContext> {
  if (event.type !== 'imported') return {};
  const { review } = event;
  return { view: review, previous: undefined, agent: review.agentId, sha: review.sha, error: review.error, reported: undefined };
}

/** The review as the board shows it: none before it's asked for, or once its pull request's gone. */
export function reviewView(state: ReviewState): QaReview | undefined {
  return state.view;
}

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

/**
 * The facts that put a review back under test by `agent`, whose conversation the captain's message picked back up: after
 * their turn failed ("Hit a problem – send a message to retry"), or while the review waited for them again. Without
 * them, the verdict that turn reaches lands on a review that isn't under test, the machine drops it, and it's never
 * posted (jonhilt/focus#523). The commit is the one they checked out. None when it's under test already, its verdict's
 * in hand or given, nothing was ever checked out, or its pull request's gone.
 */
export function resumedFacts(review: ReviewState, agent: string): ReviewFact[] {
  const { sha, view } = review;
  if (!sha || !view) return [];
  const testing: ReviewFact = { kind: 'testing', sha };
  if (review.phase === 'seated') return [testing];
  if (review.phase === 'queued') return [{ kind: 'seated', agent }, testing];
  if (review.phase !== 'error') return [];
  const { projectId, repo, number, title, openedByOffice } = view;
  return [{ kind: 'requested', projectId, repo, number, title, ...(openedByOffice !== undefined && { openedByOffice }) }, { kind: 'seated', agent }, testing];
}

/** A reviewer as `leftWithoutVerdict` reads them. */
export interface Reviewer {
  id: string;
  status: AgentStatus;
  /** On hold for your plan's usage limit: their turn carries on once it resets. */
  held?: unknown;
  /** Their pull request merged or closed: the review's gone with it. */
  prGone?: string;
}

/**
 * Whether a review is left under test without a verdict by `reviewer`, whose session is over: `over` once Ops has
 * done all it does with their last turn (finishing their report included), or once they're done or failed. Then it
 * ends without a verdict and goes to the captain. Not while they're at work or held for your plan's limit, nor once
 * the captain stopped them (that ends it already), its pull request's gone, or Focus is shutting down (`reviewRecovery`
 * picks it up). Seen on jonhilt/ops#35: the reviewer said they were done, and the PR said QA testing for good.
 */
export function leftWithoutVerdict(review: ReviewState, reviewer: Reviewer, { closing, over }: { closing: boolean; over: boolean }): boolean {
  if (review.phase !== 'testing' || review.agent !== reviewer.id || closing || reviewer.prGone || reviewer.held) return false;
  if (reviewer.status === 'stopped') return false;
  return over || reviewer.status === 'done' || reviewer.status === 'error';
}

/** What Ops does at startup with a review its journal says was under way. */
export type ReviewRecovery =
  /** Nothing was under way. */
  | { kind: 'none' }
  /** It was waiting for a reviewer: it waits for one again. */
  | { kind: 'queue' }
  /** Ops was looking at what changed since the last verdict: QA tests it instead. */
  | { kind: 'retest' }
  /** Its reviewer was setting up, before any Claude turn: back in the queue, to start again. */
  | { kind: 'restart' }
  /** Its reviewer's run picks itself back up (their turn resumes, or waits out a hold): the review carries on with it. */
  | { kind: 'carry-on' }
  /** It can't carry on by itself: it ends without a verdict, and the captain sends it to QA again. */
  | { kind: 'interrupted'; error: string }
  /** The verdict's in hand: Ops posts it, then tells everyone who hears of it. */
  | { kind: 'post' }
  /** The verdict's posted: Ops tells everyone who hears of it. */
  | { kind: 'announce' };

export const REVIEW_INTERRUPTED = 'Interrupted when Focus shut down. Send it to QA again.';

/** What its reviewer's run does after a restart that keeps the review going with it. */
const CARRIES_ON: ReadonlySet<Recovery['kind']> = new Set(['resume', 'hold-again', 'requeue']);

/** What to do at startup with a review, from its journal, and what its reviewer's run does after the restart (`reviewer`, from their run journal). */
export function reviewRecovery(review: ReviewState, reviewer: Recovery['kind'] | undefined): ReviewRecovery {
  const at = (phase: string) => review.phase === phase;
  if (typeof review.phase === 'object' && 'reported' in review.phase) return { kind: review.phase.reported === 'announcing' ? 'announce' : 'post' };
  if (at('queued')) return { kind: 'queue' };
  if (at('precheck')) return { kind: 'retest' };
  if (at('seated')) return { kind: 'restart' };
  if (at('testing')) return reviewer && CARRIES_ON.has(reviewer) ? { kind: 'carry-on' } : { kind: 'interrupted', error: REVIEW_INTERRUPTED };
  return { kind: 'none' };
}
