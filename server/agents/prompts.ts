import type { Agent, Avatar } from '../../shared/types';
import type { IssueDetail } from '../github/provider';
import { truncate } from '../util';

export function systemAppend(agent: Agent): string {
  const assignment = {
    issue: `Your manager assigned you GitHub issue #${agent.issue.number} in ${agent.repo}.`,
    conflicts: `Your manager assigned you pull request #${agent.issue.number} in ${agent.repo}: it has merge conflicts with \`${agent.baseBranch}\` that you need to resolve.`,
  }[agent.task];
  const summary = {
    issue: 'Your final message becomes the pull request description. Write it in Markdown with a short "Summary" and "Testing" section. No preamble.',
    conflicts: 'Your final message goes to the manager: say briefly how you resolved each conflict and what you checked. No preamble.',
  }[agent.task];
  return `
# You are ${agent.name}, an agent in the Focus office

${assignment} You work autonomously; the manager watches your terminal and browser on your laptop screen and may send you messages.

- Your current directory is a dedicated git worktree on branch \`${agent.branch}\`, created from \`${agent.baseBranch}\`. Stay inside it.
- Commit your work as you go with clear messages. Never commit secrets, build output or dependency folders.
- Do NOT push and do NOT open a pull request: when you finish, the office pushes your branch and opens the PR for you.
- Run the project's tests, type checks and linters when they exist, and fix what you break.
- If the change touches a web UI, start the dev server in the background and check your work with the mcp__browser__ tools (open, click, type, screenshot, console).
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
    '3. Run the type checks, tests and linters, and fix what the merge broke.',
    '4. Commit the merge.',
    '',
    'Merge rather than rebase: the pull request is already open, so its history must stay intact.',
  ].join('\n');
}

export const COMMIT_NUDGE =
  'Your working tree still has uncommitted changes. Commit everything that belongs to this change now ' +
  '(leave out build output, dependencies and secrets), then reply with your pull request description again.';

export function pullRequestBody(agent: Agent, summary: string): string {
  return `${summary.trim() || `Resolves the issue below.`}

Closes #${agent.issue.number}

---
_Built by **${agent.name}** in the Focus office with Claude Code._`;
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

const SHIRTS = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#6c5ce7', '#ff9f43', '#1dd1a1', '#54a0ff', '#f368e0', '#00d2d3', '#ee5253'];
const HAIR = ['#2d1b0e', '#5a3825', '#e6be8a', '#b55239', '#1e1e1e', '#8e44ad', '#ff7979', '#f6e58d', '#95a5a6'];
const SKIN = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffe0bd'];
const ACCESSORIES: Avatar['accessory'][] = ['none', 'glasses', 'headphones', 'cap', 'bow', 'glasses', 'none'];

const any = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export function randomAvatar(): Avatar {
  return { shirt: any(SHIRTS), hair: any(HAIR), skin: any(SKIN), accessory: any(ACCESSORIES) };
}
