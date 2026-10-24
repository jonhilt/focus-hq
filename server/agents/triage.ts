import type { FailedCheck, Planner, QaReview, Settings, TriageAction } from '../../shared/types';
import type { IssueDetail, PullRequestDetail } from '../github/provider';
import { fieldsOf, isOneOf } from '../../shared/records';
import { PUBLIC_WORDS_RULE } from '../../shared/wording';
import { truncate } from '../util';
import { qaFindings } from './qa';
import { crewPrompt } from './crewFiles';

// The operations officer's look at a stuck pull request: their instructions, the decision's schema and parsing. Pure,
// so they're unit tested (triage.test.ts). When triage happens and what Ops does with the decision is in
// shared/triage.ts; manager.ts does it.

export interface TriageRequest {
  projectId: string;
  projectName: string;
  officer: Planner;
  repo: string;
  pr: PullRequestDetail;
  /** A read-only checkout of the PR's head. */
  cwd: string;
  /** Why the PR is stuck, as Ops sees it ("it failed QA 3 times"). */
  reason: string;
  review: Pick<QaReview, 'sha' | 'report' | 'lastRound' | 'failedRounds' | 'triage'>;
  /** The PR's failing checks on GitHub. */
  checks: FailedCheck[];
  diff: string;
  issues: IssueDetail[];
  settings: Settings;
  signal: AbortSignal;
}

export interface TriageDecision {
  action: TriageAction;
  /** What to do differently, for whoever acts on it; on an escalation, the one-line diagnosis for the manager. */
  note: string;
}

/** Looks at one stuck PR and decides one thing to do. The live one is a read-only Claude Code session; the demo one is scripted. */
export interface Triager {
  triage(req: TriageRequest, activity: (text: string) => void): Promise<TriageDecision & { costUsd?: number }>;
}

const ACTIONS: TriageAction[] = ['retry-qa', 'send-back', 'rerun-checks', 'close', 'escalate'];

export const TRIAGE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'note'],
  properties: {
    action: { type: 'string', enum: ACTIONS, description: 'The one thing to do about the stuck pull request.' },
    note: {
      type: 'string',
      description: 'retry-qa: what QA should look at. send-back: what the developer should do differently. rerun-checks: why the check looks flaky. close: what is wrong with the approach, for the next developer. escalate: a one-line diagnosis for the manager.',
    },
  },
};

export function parseTriage(out: unknown): TriageDecision | null {
  const { action, note } = fieldsOf(out);
  if (!isOneOf(ACTIONS, action) || typeof note !== 'string' || !note.trim()) return null;
  return { action, note: note.trim() };
}

export function triageSystemPrompt(req: Pick<TriageRequest, 'officer' | 'projectName' | 'pr'>): string {
  return crewPrompt('triage', { name: req.officer.name, project: req.projectName, number: String(req.pr.number), publicWordsRule: PUBLIC_WORDS_RULE }).trim();
}

export function triagePrompt(req: Pick<TriageRequest, 'repo' | 'pr' | 'reason' | 'review' | 'checks' | 'diff' | 'issues'>): string {
  const { pr, review } = req;
  const parts = [
    `Pull request #${pr.number} in ${req.repo} is stuck: ${req.reason}.`,
    `Title: ${pr.title}`,
    `Branch: ${pr.branch} into ${pr.baseBranch}, head ${pr.headSha.slice(0, 7)}`,
    `Failed QA rounds so far: ${review.failedRounds ?? 0}`,
    '',
    'PR description:',
    truncate(pr.body.trim() || '(empty)', 6000),
  ];
  for (const issue of req.issues) parts.push('', `Issue #${issue.number}: ${issue.title}`, truncate(issue.body.trim() || '(no description)', 8000));
  if (review.report) parts.push('', `QA's latest report (${review.report.verdict}${review.sha ? `, commit ${review.sha.slice(0, 7)}` : ''}):`, ...qaFindings(review.report));
  if (review.lastRound) parts.push('', `The round before (${review.lastRound.report.verdict}${review.lastRound.sha ? `, commit ${review.lastRound.sha.slice(0, 7)}` : ''}):`, ...qaFindings(review.lastRound.report));
  parts.push('', "GitHub's failing checks:", ...(req.checks.length ? req.checks.map((c) => `- ${c.name}${c.url ? ` (${c.url})` : ''}`) : ['(none)']));
  if (review.triage) parts.push('', `You looked at it once before and chose ${review.triage.action}: ${review.triage.note}`, "That didn't unstick it.");
  parts.push('', 'The diff:', '```diff', truncate(req.diff, 40_000), '```');
  return parts.join('\n');
}
