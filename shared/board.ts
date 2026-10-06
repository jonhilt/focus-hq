import { issueKey, waitingFor } from './dependencies';
import type { Agent, Board, Issue, Project, PullRequest } from './types';

export interface Columns {
  /** `waitsFor`: the open issues it depends on, empty when it can start. */
  todo: (Issue & { waitsFor: number[] })[];
  doing: Agent[];
  prs: (PullRequest & { agent?: Agent })[];
  /** Open PRs hidden by the project's "only my PRs" filter. */
  hiddenPrs: number;
}

/** Splits a project's issues, agents and PRs into the three Kanban columns. */
export function columns(project: Project, board: Board | undefined, agents: Agent[], login: string | undefined): Columns {
  const prs = board?.prs ?? [];
  const claimed = (issue: Issue) =>
    agents.some((a) => a.repo === issue.repo && a.issue.number === issue.number) ||
    prs.some((p) => p.repo === issue.repo && p.branch.startsWith(`focus/${issue.number}-`));
  const by = (p: PullRequest) => (a: Agent) =>
    a.task === 'lead' ? !!a.lead?.prs.some((x) => x.repo === p.repo && x.number === p.number) : a.task !== 'review' && a.repo === p.repo && a.pr?.number === p.number;
  const all = prs.map((p) => ({ ...p, agent: agents.find(by(p)) }));
  // agents' PRs are opened with your gh account, so author === login covers them too; the agent check catches stale data
  const shown = project.onlyMyPrs && login ? all.filter((p) => p.agent || p.author === login) : all;
  const waiting = waitingFor(board?.issues ?? []);
  return {
    todo: (board?.issues ?? [])
      .filter((i) => project.repos.includes(i.repo) && !claimed(i))
      .map((i) => ({ ...i, waitsFor: waiting.get(issueKey(i.repo, i.number)) ?? [] })),
    // the QA officer and the lead work at their own stations, not on the board's issues
    doing: agents.filter((a) => a.status !== 'done' && a.task !== 'review' && a.task !== 'lead').sort((a, b) => a.startedAt - b.startedAt),
    prs: shown,
    hiddenPrs: all.length - shown.length,
  };
}

/**
 * GitHub computes mergeability lazily and answers UNKNOWN until it's done, so a freshly fetched PR keeps
 * the last definite answer from `previous` while its head commit and base branch haven't moved.
 */
export function carryMergeable(previous: PullRequest[], fresh: PullRequest[]): PullRequest[] {
  return fresh.map((pr) => {
    if (pr.mergeable !== 'UNKNOWN') return pr;
    const before = previous.find((p) => p.repo === pr.repo && p.number === pr.number);
    if (!before || before.mergeable === 'UNKNOWN' || before.headSha !== pr.headSha || before.baseBranch !== pr.baseBranch) return pr;
    return { ...pr, mergeable: before.mergeable };
  });
}
