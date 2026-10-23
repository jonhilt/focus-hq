import type { Agent } from '../../shared/types';
import type { IssueDetail } from '../github/provider';
import { truncate } from '../util';
import type { BriefSpec } from '../plugins/contract';
import { CREW_RULES, crewPrompt, crewText } from './crewFiles';

/** `brief` is what a plugin's brief says of the work (task `brief`); without one, its plugin was switched off since. */
export function systemAppend(agent: Agent, brief?: Pick<BriefSpec, 'assignment' | 'summary'>): string {
  if (agent.task === 'review') throw new Error('The QA officer gets qaSystemAppend (qa.ts)');
  if (agent.task === 'lead') throw new Error('The project lead gets leadSystemAppend (lead.ts)');
  const at = { repo: agent.repo, number: String(agent.issue.number), baseBranch: agent.baseBranch };
  const { assignment, summary } = agent.task === 'brief' ? brief ?? { assignment: crewText('worker', 'assignment.unknownBrief', at), summary: crewText('worker', 'summary.pullRequest', at) } : {
    assignment: crewText('worker', `assignment.${agent.task}`, at),
    summary: crewText('worker', ({ issue: 'summary.pullRequest', conflicts: 'summary.conflicts', fix: 'summary.fix' } as const)[agent.task], at),
  };
  return crewPrompt('worker', { ...at, name: agent.name, branch: agent.branch, assignment, summary, cloud: !!agent.cloud, ...CREW_RULES }).trim();
}

export function issuePrompt(agent: Agent, issue: IssueDetail): string {
  const parts = [
    `Please resolve GitHub issue #${issue.number} in ${agent.repo}.`,
    '',
    `Title: ${issue.title}`,
    issue.labels.length ? `Labels: ${issue.labels.join(', ')}` : '',
    issue.author ? `Opened by: @${issue.author}` : '',
    '',
    truncate(issue.body.trim() || '(no description)', 20_000),
  ];
  if (issue.comments.length) {
    parts.push('', 'Discussion on the issue:');
    for (const c of issue.comments.slice(-15)) parts.push('', `@${c.author}:`, truncate(c.body.trim(), 4000));
  }
  return parts.filter((p, i, all) => p !== '' || all[i - 1] !== '').join('\n');
}

/** The task for whoever resolves a pull request's merge conflicts: an agent seated for it, or the one who opened the PR. */
export function conflictsPrompt(agent: Agent): string {
  return [
    `Pull request #${agent.pr?.number ?? agent.issue.number} (branch \`${agent.branch}\`) has merge conflicts with \`${agent.baseBranch}\`. Please resolve them.`,
    '',
    `1. \`git fetch origin\`, then \`git merge origin/${agent.baseBranch}\`.`,
    '2. Resolve every conflict so that both sides keep doing what they were meant to do. Read the base branch commits that caused each conflict before choosing.',
    '3. Run the type checks, tests and linters, and fix what the merge broke, before calling it resolved: a merge git makes by itself can still break the build.',
    agent.cloud ? `4. Commit the merge and push it: \`git push origin HEAD:${agent.branch}\`.` : '4. Commit the merge.',
    '',
    'Merge rather than rebase: the pull request is already open, so its history must stay intact.',
  ].join('\n');
}

/** For a cloud agent whose session ended without anything new on its branch: the work may still be in the cloud. */
export function pushNudge(agent: Agent): string {
  return (
    `Nothing new has reached \`${agent.branch}\` on GitHub, and Ops can only see what's pushed there. If you changed ` +
    `anything, commit it (leave out build output, dependencies and secrets) and push it with \`git push origin HEAD:${agent.branch}\` now. ` +
    `If there was nothing to change, say why. Then reply with your ${agent.task === 'issue' ? 'pull request description' : 'summary for the manager'} again.`
  );
}

/**
 * A new cloud session picking up where one Ops couldn't reattach to left off: everything it did is on the
 * branch, but the conversation is gone. `message` is what the manager meant for the old session.
 */
export function carryOnPrompt(agent: Agent, message: string): string {
  const what = agent.task === 'issue' ? `GitHub issue #${agent.issue.number} in ${agent.repo}: ${agent.issue.title} (${agent.issue.url})` : `pull request #${agent.pr?.number ?? agent.issue.number} in ${agent.repo}: ${agent.issue.title}`;
  return [
    `You're taking over ${what}.`,
    '',
    `Whatever was done so far is committed on \`${agent.branch}\`: read the issue and \`git log origin/${agent.baseBranch}..HEAD\` to catch up. Then carry on with this message from your manager:`,
    '',
    message,
  ].join('\n');
}

export const COMMIT_NUDGE =
  'Your working tree still has uncommitted changes. Commit everything that belongs to this change now ' +
  '(leave out build output, dependencies and secrets), then reply with your pull request description again.';

export function pullRequestBody(agent: Pick<Agent, 'name'> & Partial<Pick<Agent, 'task'>> & { issue: Pick<Agent['issue'], 'number'> }, summary: string, attribution: boolean): string {
  // a plugin's brief has no issue of its own: its write-up says `Closes #n` itself when it took one on
  const body = agent.task === 'brief' ? summary.trim() : `${summary.trim() || `Resolves the issue below.`}

Closes #${agent.issue.number}`;
  return attribution ? `${body}\n\n---\n_Built by **${agent.name}** aboard the Focus with Claude Code._` : body;
}
