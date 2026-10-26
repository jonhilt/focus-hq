import { sameCommit } from './qa';
import type { PullRequest, QaReview } from './types';

// When QA looks at a pull request, and what a project's QA settings say: whether QA picks a PR up, sends a failed one
// back, blocks only with proof or records its browser. Pure, so it's unit tested (shared/qaRules.test.ts); the server
// sends PRs to QA and the client shows the settings.

/**
 * Whether a PR goes back to QA because its head moved past QA's verdict without Ops pushing it (CI committing
 * to the branch, the captain pushing by hand): only Ops' own PRs, with auto-QA on, and not while someone
 * Ops sent is fixing it or the operations officer is looking, since they hand it back to QA themselves.
 */
export function verdictBehindHead(review: QaReview | undefined, pr: Pick<PullRequest, 'headSha'>, ctx: { ours: boolean; autoQa: boolean }): boolean {
  if (!review?.sha || !pr.headSha || !ctx.ours || !ctx.autoQa) return false;
  if (review.status !== 'passed' && review.status !== 'failed') return false;
  if (review.followUp?.kind === 'fixing' || review.followUp?.kind === 'triaging') return false;
  return !sameCommit(review.sha, pr.headSha);
}

/** Whether QA should pick up a PR Ops just opened or pushed to: on unless the project switched it off. */
export function autoQaFor(project: { autoQa?: boolean }): boolean {
  return project.autoQa !== false;
}

/** Whether QA blocks this project's pull requests only with proof (missing = on). */
export function qaProofFor(project: { qaProof?: boolean }): boolean {
  return project.qaProof !== false;
}

/** Whether QA records its browser session for this project's pull requests (missing = off). */
export function qaVideoFor(project: { qaVideo?: boolean }): boolean {
  return project.qaVideo === true;
}

/** Whether a failed PR Ops opened goes back to a developer: on unless the project switched it off. */
export function autoSendBackFor(project: { autoSendBack?: boolean }): boolean {
  return project.autoSendBack !== false;
}
