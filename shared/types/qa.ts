// QA reviews of pull requests, and what the office does about the ones that fail.

import type { FailedCheck } from './github';

export interface QaCheck {
  name: string;
  result: 'pass' | 'fail' | 'skip';
  /** What they did and what they saw. */
  details: string;
}

/** The QA officer's verdict on one pull request, as they report it at the end of their session. */
export interface QaReport {
  verdict: 'pass' | 'fail';
  summary: string;
  /** Each acceptance criterion, review point or scenario checked. */
  checks: QaCheck[];
  /** Test suites, builds and other commands run, with what came out. */
  commands: { command: string; result: string }[];
  /** On a fail: what the developer should fix. */
  fixInstructions?: string;
  /** A caption for each screenshot they took on purpose (mcp__browser__screenshot), in the order they took them. */
  captions: string[];
}

/** A screenshot from a QA review, kept as evidence with the report. */
export interface QaScreenshot {
  caption: string;
  /** The image as the office keeps it, served at /api/qa-shots/<file>. */
  file: string;
  /** The image on the repo's QA evidence branch. Missing if the upload failed. */
  url?: string;
}

export type QaStatus = 'queued' | 'testing' | 'passed' | 'failed' | 'error';

/** What a developer was sent back to fix: QA's findings, or the PR's checks failing on GitHub after QA passed it. */
export type FixFor = { kind: 'qa' } | { kind: 'checks'; checks: FailedCheck[] };

/**
 * What the office did about a failed PR it opened: a developer is on it, the room's operations officer is working out
 * why it's stuck, or it gave up and wants you.
 */
export type QaFollowUp =
  | { kind: 'fixing'; agentId: string; agentName: string; fixes: FixFor }
  | { kind: 'triaging'; officer: string; activity: string }
  | { kind: 'needs-you'; reason: string };

/** What the operations officer can do about a stuck PR. */
export type TriageAction = 'retry-qa' | 'send-back' | 'rerun-checks' | 'close' | 'escalate';

/** What the operations officer did about a stuck PR, and why (on an escalation, their diagnosis). */
export interface Triage {
  officer: string;
  action: TriageAction;
  note: string;
  at: number;
}

/** The latest QA review of a pull request. Kept until the PR is merged or closed. */
export interface QaReview {
  projectId: string;
  repo: string;
  number: number;
  title: string;
  status: QaStatus;
  /** The commit QA checked out and tested. */
  sha?: string;
  /** QA passed this commit, the one before a merge of the base branch that the office checked itself and carried the pass over from. */
  carriedFrom?: string;
  report?: QaReport;
  /** The screenshots that go with the report, in the order they were taken. */
  screenshots?: QaScreenshot[];
  /** The QA report posted on the pull request. */
  commentUrl?: string;
  /** The QA officer's session for this review, while their record is around. */
  agentId?: string;
  error?: string;
  /** An agent of the office opened the PR, so a failed verdict may go back to a developer. Teammates' PRs never do. */
  openedByOffice?: boolean;
  /** Rounds of QA this PR has failed so far, this one included once it's in (missing = none). */
  failedRounds?: number;
  /** The round before this one, so a re-test checks those findings first and focuses on what changed since. */
  lastRound?: { sha?: string; report: QaReport };
  followUp?: QaFollowUp;
  /** Times the operations officer has looked at this PR because it was stuck (missing = never). */
  triages?: number;
  /** What they did the last time. */
  triage?: Triage;
  /** Why it's back with QA, when the operations officer sent it back: for the QA officer, this round only. */
  retryNote?: string;
  /** The captain asked for the PR to merge once QA passes it (mergeGate's requestedMerge says when). */
  mergeRequested?: { at: number };
  requestedAt: number;
  finishedAt?: number;
}
