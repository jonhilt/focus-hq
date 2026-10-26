import type { AgentStatus } from '../../shared/types';
import type { ReviewFact, ReviewState } from './reviewJournal';
import type { Recovery } from './runJournalRules';

// What Ops does with a QA review its journal tells (reviewJournal.ts folds it): after a restart, when its reviewer's
// session is over without a verdict, and when the captain picks the reviewer's conversation back up. Pure, so it's
// unit tested (reviewJournalRules.test.ts); manager/reviews.ts does what it says.

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
