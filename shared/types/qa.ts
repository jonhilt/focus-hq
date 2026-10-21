// QA reviews of pull requests, and what Ops does about the ones that fail.

import type { Effort } from './agents';
import type { FailedCheck } from './github';

export interface QaCheck {
  name: string;
  result: 'pass' | 'fail' | 'skip';
  /** What they did and what they saw. */
  details: string;
}

/** A place in the diff QA thinks most worth a human's eyes, and why: the captain spot-checks rather than reading it all. */
export interface QaSpotCheck {
  file: string;
  line?: number;
  why: string;
  /**
   * Where it is in the pull request's changed files on GitHub (`diff-` and the SHA-256 of its path, then `R` and the
   * line): worked out by Ops as it reads the report. Missing on ones reported before it was kept.
   */
  anchor?: string;
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
  /** The two or three places in the diff most worth a human look. Missing on reports from before they were asked for. */
  spotChecks?: QaSpotCheck[];
  /** Every file the pull request changes, accounted for: what tests exercise it and what QA checked. Missing on reports from before they were asked for. */
  files?: QaFile[];
  /**
   * What QA offers as proof of its findings (docs/qa.md#proof), each with what Ops saw when it checked it. Missing
   * on reports from before proof was asked for, and when the project doesn't ask for it.
   */
  proofs?: QaProof[];
  /**
   * QA failed it, but none of its proofs held when Ops checked them: the verdict is a pass, and QA's findings (its
   * failed checks and fix instructions) are posted as advice.
   */
  advisory?: boolean;
}

/**
 * A proof QA names for a finding. `test`: a test it wrote (or one already there) that fails, with the command that runs
 * just that file. `check`: one of the project's own checks (its type check, lint or build) that fails. `screenshot`: the
 * narrow exception for what only a browser shows, a screenshot of the failure that's on the pull request.
 */
export interface QaProof {
  kind: 'test' | 'check' | 'screenshot';
  /** The finding it proves, in a sentence. */
  finding: string;
  /** The test file, from the repo's root (`test`). */
  file?: string;
  /** The command, run without a shell from the repo's root (`test`, `check`). */
  command?: string;
  /** Which screenshot, counting from 1 in the order QA took them (`screenshot`). */
  screenshot?: number;
  /**
   * What Ops saw: `failed`, it holds (a test failed, a check failed, a screenshot of the failure is on the PR);
   * `passed`, the test or check passed when Ops ran it; `broken`, it couldn't be taken as proof (`note` says why).
   */
  outcome?: 'failed' | 'passed' | 'broken';
  /** Why it's broken, or the first line of what failed. */
  note?: string;
  /** The end of what the command printed. */
  output?: string;
  /** The test file's contents, for the developer to add to their branch and keep. */
  source?: string;
}

/** A file the pull request changes, as QA accounted for it. */
export interface QaFile {
  file: string;
  /** The tests that exercise its changes, or "none". */
  tests: string;
  /** What QA did with it: read every changed line, ran it, why a generated file needed no reading. */
  checked: string;
}

/**
 * What Ops knows of how QA covered a pull request's changed files: the files, those its session opened by its
 * own tool calls (missing when Ops couldn't read them: the demo, a cloud session), and how many it was sent back to.
 */
export interface FileAccount {
  changed: string[];
  opened?: string[];
  sentBack?: number;
}

/** A screenshot from a QA review, kept as evidence with the report. */
export interface QaScreenshot {
  caption: string;
  /** The image as Ops keeps it, served at /api/qa-shots/<file>. */
  file: string;
  /** The image on the repo's QA evidence branch. Missing if the upload failed. */
  url?: string;
}

export type QaStatus = 'queued' | 'testing' | 'passed' | 'failed' | 'error';

/** What a developer was sent back to fix: QA's findings, or the PR's checks failing on GitHub after QA passed it. */
export type FixFor = { kind: 'qa' } | { kind: 'checks'; checks: FailedCheck[] };

/**
 * What Ops did about a failed PR it opened: a developer is on it, the room's operations officer is working out
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
  /**
   * The commit a lead's ship pushed when it asked for this review. QA re-tests from it rather than from GitHub's
   * head, which can lag a push, and a verdict on an earlier commit sends the PR straight back to QA.
   */
  shippedHead?: string;
  /** QA passed this commit, the one before a merge of the base branch that Ops checked itself and carried the pass over from. */
  carriedFrom?: string;
  report?: QaReport;
  /** The screenshots that go with the report, in the order they were taken. */
  screenshots?: QaScreenshot[];
  /** The QA report posted on the pull request. */
  commentUrl?: string;
  /** How QA covered the changed files this round. Missing on reviews from before it was kept. */
  files?: FileAccount;
  /** The QA officer's session for this review, while their record is around. */
  agentId?: string;
  error?: string;
  /** One of Focus's agents opened the PR, so a failed verdict may go back to a developer. Teammates' PRs never do. */
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

/** One step of QA's instructions: a headline in plain words, and the exact text QA gets. */
export interface QaStep {
  title: string;
  text: string;
}

/** What QA runs on one of the project's repos, as the clone Ops keeps of it says. */
export interface QaRepoChecks {
  repo: string;
  /** Ops has a clone of it to look in (it makes one the first time an agent works in the repo). */
  cloned: boolean;
  /** The clone has a package.json at its root. */
  packageJson: boolean;
  /** The clone has a CLAUDE.md at its root, which QA's session loads. */
  claudeMd: boolean;
  /** The commands QA is told to run (the project's merge checks the repo has); none: QA works them out itself. */
  commands: string[];
}

/** What QA does on a project, built from its instructions and settings as they are now: the QA station's Playbook. */
export interface QaPlaybook {
  /** "How to test", in order, proof mode's steps only when it's on. Step 3 names the first repo's checks. */
  steps: QaStep[];
  repos: QaRepoChecks[];
  /** QA's whole instructions, for an example pull request in the project's first repo. */
  prompt: string;
}

/** One line of the captain's talk with the QA officer at the Playbook: who said it, and what. */
export interface QaChatTurn {
  who: 'captain' | 'officer';
  text: string;
}

/**
 * The settings the QA officer may propose a change to at the Playbook: its four switches, how hard it thinks (null: the
 * model's default), the merge checks' scripts and the brief (its whole new text). Its steps stay as they are.
 */
export interface QaSettingsChange {
  autoQa?: boolean;
  autoSendBack?: boolean;
  qaProof?: boolean;
  autoMerge?: boolean;
  qaEffort?: Effort | null;
  mergeChecks?: string[];
  qaBrief?: string;
}

/** The QA officer's answer to the captain: what it says, and maybe a change to its settings, for the captain to apply. */
export interface QaChatReply {
  reply: string;
  change?: QaSettingsChange;
}
