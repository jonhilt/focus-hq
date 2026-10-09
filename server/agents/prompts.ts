import type { Agent } from '../../shared/types';
import type { IssueDetail } from '../github/provider';
import { truncate } from '../util';

export function systemAppend(agent: Agent): string {
  if (agent.task === 'review') throw new Error('The QA officer gets qaSystemAppend (qa.ts)');
  if (agent.task === 'lead') throw new Error('The project lead gets leadSystemAppend (lead.ts)');
  const assignment = {
    issue: `Your manager assigned you GitHub issue #${agent.issue.number} in ${agent.repo}.`,
    conflicts: `Your manager assigned you pull request #${agent.issue.number} in ${agent.repo}: it has merge conflicts with \`${agent.baseBranch}\` that you need to resolve.`,
    fix: `Your manager assigned you pull request #${agent.issue.number} in ${agent.repo}: it failed QA and you need to fix what QA found.`,
  }[agent.task];
  const summary = {
    issue: 'Your final message becomes the pull request description. Write it in Markdown with a short "Summary" and "Testing" section. No preamble.',
    conflicts: 'Your final message goes to the manager: say briefly how you resolved each conflict and what you checked. No preamble.',
    fix: 'Your final message goes to the manager: say briefly what you fixed and how you checked it. No preamble.',
  }[agent.task];
  const where = agent.cloud
    ? [
        `- You work in a Claude Code cloud session, in a clone of ${agent.repo}. Work on branch \`${agent.branch}\` (created from \`${agent.baseBranch}\`): if you're on any other branch, run \`git fetch origin ${agent.branch}\` and \`git checkout ${agent.branch}\` first. This overrides any other branch you were told to develop on.`,
        '- Commit your work as you go with clear messages. Never commit secrets, build output or dependency folders.',
        `- Push your commits with \`git push origin HEAD:${agent.branch}\`, and always before your final message: your work only reaches the office through that branch. Never push to any other branch, and do NOT open a pull request: the office opens it from your branch.`,
        '- Run the project\'s tests, type checks and linters when they exist, and fix what you break.',
        '- If the change touches a web UI, start the dev server in the background and check your work in a headless browser (e.g. a Playwright script). Save screenshots of what you check as PNG files and look at each one with the Read tool: that\'s how the manager sees them on your laptop screen.',
      ]
    : [
        `- Your current directory is a dedicated git worktree on branch \`${agent.branch}\`, created from \`${agent.baseBranch}\`. Stay inside it.`,
        '- Commit your work as you go with clear messages. Never commit secrets, build output or dependency folders.',
        '- Do NOT push and do NOT open a pull request: when you finish, the office pushes your branch and opens the PR for you.',
        '- Run the project\'s tests, type checks and linters when they exist, and fix what you break.',
        '- If the change touches a web UI, start the dev server in the background and check your work with the mcp__browser__ tools (open, click, type, screenshot, console).',
      ];
  return `
# You are ${agent.name}, an agent in the Focus office

${assignment} You work autonomously; the manager watches your terminal and browser on your laptop screen and may send you messages.

${where.join('\n')}
- Nobody can answer questions while you work. Make sensible decisions and mention them in your summary.
- ${summary}
`.trim();
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
    `Nothing new has reached \`${agent.branch}\` on GitHub, and the office can only see what's pushed there. If you changed ` +
    `anything, commit it (leave out build output, dependencies and secrets) and push it with \`git push origin HEAD:${agent.branch}\` now. ` +
    `If there was nothing to change, say why. Then reply with your ${agent.task === 'issue' ? 'pull request description' : 'summary for the manager'} again.`
  );
}

/**
 * A new cloud session picking up where one the office couldn't reattach to left off: everything it did is on the
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

export function pullRequestBody(agent: Pick<Agent, 'name'> & { issue: Pick<Agent['issue'], 'number'> }, summary: string, attribution: boolean): string {
  const body = `${summary.trim() || `Resolves the issue below.`}

Closes #${agent.issue.number}`;
  return attribution ? `${body}\n\n---\n_Built by **${agent.name}** in the Focus office with Claude Code._` : body;
}

const NAMES = [
  'Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Guido', 'Katherine', 'Tim', 'Hedy',
  'Bjarne', 'Frances', 'Donald', 'Sophie', 'Anders', 'Yukihiro', 'Brendan', 'Jean', 'Edsger', 'Annie', 'Rasmus', 'Evelyn',
  'Niklaus', 'Lynn', 'Larry', 'Mary', 'Vint', 'Joan', 'Ward',
];

export function pickName(taken: Set<string>): string {
  const free = NAMES.filter((n) => !taken.has(n));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  return `${NAMES[Math.floor(Math.random() * NAMES.length)]} ${taken.size + 1}`;
}
