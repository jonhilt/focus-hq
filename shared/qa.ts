import type { PullRequest, QaReview } from './types';

// QA decisions shared by the server and the board. Pure, so they're unit tested (shared/qa.test.ts).

export type QaBadgeState = 'none' | 'queued' | 'testing' | 'passed' | 'failed' | 'fixing' | 'triaging' | 'needs-you' | 'stale' | 'error';

export interface QaBadge {
  state: QaBadgeState;
  label: string;
}

/**
 * What a PR card shows about QA. A verdict on an older commit than the PR's head is stale. A fail says who it went back
 * to, that the room's operations officer is looking into why it's stuck, or that the office gave up on it.
 */
export function qaBadge(review: QaReview | undefined, pr: Pick<PullRequest, 'headSha'>): QaBadge {
  if (!review) return { state: 'none', label: 'not tested' };
  switch (review.status) {
    case 'queued':
      return { state: 'queued', label: 'QA queued' };
    case 'testing':
      return { state: 'testing', label: 'QA testing' };
    case 'error':
      return { state: 'error', label: 'QA couldn’t finish' };
    case 'passed':
    case 'failed': {
      if (review.sha && pr.headSha && !sameCommit(review.sha, pr.headSha)) return { state: 'stale', label: `QA ${review.status} an older commit` };
      if (review.status === 'passed') return { state: 'passed', label: 'QA passed' };
      switch (review.followUp?.kind) {
        case 'fixing':
          return { state: 'fixing', label: `QA failed: back with ${review.followUp.agentName}` };
        case 'triaging':
          return { state: 'triaging', label: `${review.followUp.officer} is looking` };
        case 'needs-you':
          return { state: 'needs-you', label: 'QA failed: needs you' };
        case undefined:
          return { state: 'failed', label: 'QA failed' };
      }
    }
  }
}

/** Short and long SHAs of the same commit match. */
export function sameCommit(a: string, b: string): boolean {
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
}

/** Whether QA should pick up a PR the office just opened or pushed to: on unless the project switched it off. */
export function autoQaFor(project: { autoQa?: boolean }): boolean {
  return project.autoQa !== false;
}

/** Whether a failed PR the office opened goes back to a developer: on unless the project switched it off. */
export function autoSendBackFor(project: { autoSendBack?: boolean }): boolean {
  return project.autoSendBack !== false;
}

/** Key for a pull request across a project's repos. */
export const prKey = (repo: string, number: number) => `${repo}#${number}`;
