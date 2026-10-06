import type { Brief, GoalIssue, GoalStep, PullRequest, QaReview } from './types';

/** How a goal's step stands: no PR yet, a PR open, or its PR merged or closed unmerged. */
export type StepState = 'building' | 'open' | 'merged' | 'closed';

export function stepState(step: Pick<GoalStep, 'pr' | 'outcome'>): StepState {
  return step.outcome ?? (step.pr ? 'open' : 'building');
}

export const STEP_STATE_LABELS: Record<StepState, string> = {
  building: 'being built',
  open: 'PR open',
  merged: 'merged',
  closed: 'PR closed unmerged',
};

/** `#N` within `from`'s repo, `owner/name#N` from anywhere else (GitHub links both). */
export const issueRef = (issue: Pick<GoalIssue, 'repo' | 'number'>, from?: string) => (issue.repo === from ? `#${issue.number}` : `${issue.repo}#${issue.number}`);

/** The open PR building a step: the one it already had, else one that closes its issue or sits on a branch the office cut for it. */
export function stepPullRequest(step: Pick<GoalStep, 'repo' | 'number' | 'pr'>, prs: PullRequest[]): PullRequest | undefined {
  const theirs = prs.filter((p) => p.repo === step.repo);
  if (step.pr) return theirs.find((p) => p.number === step.pr!.number);
  return theirs.find((p) => p.closes.includes(step.number) || p.branch.startsWith(`focus/${step.number}-`));
}

/**
 * The step with what the board shows of it: its PR once one turns up, and QA's latest verdict on that PR (kept, since
 * the review goes when the PR does). The same object when nothing changed, so the caller can tell.
 */
export function trackStep(step: GoalStep, prs: PullRequest[], reviewOf: (pr: number) => Pick<QaReview, 'report'> | undefined): GoalStep {
  if (step.outcome) return step;
  const found = step.pr ?? stepPullRequest(step, prs);
  if (!found) return step;
  const pr = { number: found.number, url: found.url };
  const report = reviewOf(pr.number)?.report;
  const qa = report && { verdict: report.verdict, summary: report.summary };
  const sameQa = !qa || (qa.verdict === step.qa?.verdict && qa.summary === step.qa?.summary);
  if (step.pr && sameQa) return step;
  return { ...step, pr, ...(qa && { qa }) };
}

/** Whether to ask GitHub what became of a step's PR: it had one, and it's gone from the board's open PRs. */
export const stepPrGone = (step: Pick<GoalStep, 'repo' | 'pr' | 'outcome'>, prs: PullRequest[]): boolean =>
  !!step.pr && !step.outcome && !prs.some((p) => p.repo === step.repo && p.number === step.pr!.number);

/** One line per step, for the officer and the lounge: what it was and how it went. */
export function stepLine(step: GoalStep, index: number): string {
  const state = stepState(step);
  const pr = step.pr ? `PR #${step.pr.number} ${state === 'open' ? 'open' : state}` : 'no PR yet';
  const qa = step.qa ? `; QA ${step.qa.verdict === 'pass' ? 'passed' : 'failed'} it: ${step.qa.summary}` : '';
  return `Step ${index + 1}: ${step.repo}#${step.number} “${step.title}”, ${pr}${qa}`;
}

/** The goal's epic: where we're going and why, with no plan. Steps link to it as they're filed. */
export function goalEpicBody(brief: Brief, idea: string): string {
  const list = (items: string[], check = false) => items.map((i) => `- ${check ? '[ ] ' : ''}${i}`).join('\n');
  const who = brief.who ? ` It's for ${brief.who.replace(/^./, (c) => c.toLowerCase()).replace(/\.$/, '')}.` : '';
  return [
    '## Goal',
    '',
    brief.summary || idea,
    ...(brief.why || who ? ['', '## Why', '', `${brief.why}${who}`.trim()] : []),
    ...(brief.acceptance.length ? ['', '## Done when', '', list(brief.acceptance, true)] : []),
    ...(brief.openQuestions.length ? ['', '## Unknowns', '', list(brief.openQuestions)] : []),
    '',
    '---',
    'Worked toward one step at a time from a briefing in the observation lounge. Each step is filed once the one before it has taught us what comes next, so there is no plan here on purpose.',
  ].join('\n');
}

/** A step's issue body as filed: which goal it serves, then the officer's write-up. */
export const stepBody = (body: string, epic: GoalIssue, repo: string, position: number) =>
  `Step ${position} toward ${issueRef(epic, repo)}: ${epic.title}\n\n${body.trim()}`;
