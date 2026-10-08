import { issueKey, waitingFor } from './dependencies';
import type { Agent, Board, Issue, Project, PullRequest } from './types';

export interface Columns {
  /** `waitsFor`: the open issues it depends on, empty when it can start. */
  todo: (Issue & { waitsFor: number[] })[];
  /** The goals under way: each one's lead, by team station. In progress for as long as the goal is, at it right now or not. */
  goals: Agent[];
  doing: Agent[];
  /** `agent`: whose PR it is (a slice's lead before anyone seated on it); `resolver`: who's resolving its conflicts right now. */
  prs: (PullRequest & { agent?: Agent; resolver?: Agent })[];
  /** Open PRs hidden by the project's "only my PRs" filter. */
  hiddenPrs: number;
}

/** Splits a project's issues, agents and PRs into the three Kanban columns. */
export function columns(project: Project, board: Board | undefined, agents: Agent[], login: string | undefined): Columns {
  const prs = board?.prs ?? [];
  const claimed = (issue: Issue) =>
    agents.some((a) => a.repo === issue.repo && a.issue.number === issue.number) ||
    prs.some((p) => p.repo === issue.repo && p.branch.startsWith(`focus/${issue.number}-`));
  const leadOf = (p: PullRequest) => agents.find((a) => a.task === 'lead' && !!a.lead?.prs.some((x) => x.repo === p.repo && x.number === p.number));
  const on = (p: PullRequest) => (a: Agent) => a.task !== 'review' && a.task !== 'lead' && a.repo === p.repo && a.pr?.number === p.number;
  const all = prs.map((p) => ({ ...p, agent: leadOf(p) ?? agents.find(on(p)), resolver: agents.find((a) => a.task === 'conflicts' && on(p)(a) && !FINISHED.includes(a.status)) }));
  // agents' PRs are opened with your gh account, so author === login covers them too; the agent check catches stale data
  const shown = project.onlyMyPrs && login ? all.filter((p) => p.agent || p.author === login) : all;
  const waiting = waitingFor(board?.issues ?? []);
  return {
    todo: (board?.issues ?? [])
      .filter((i) => project.repos.includes(i.repo) && !claimed(i))
      .map((i) => ({ ...i, waitsFor: waiting.get(issueKey(i.repo, i.number)) ?? [] })),
    goals: agents.filter((a) => a.task === 'lead' && a.lead).sort((a, b) => (a.lead?.station ?? 0) - (b.lead?.station ?? 0)),
    // the QA officer and the leads work at their own stations, not on the board's issues
    doing: agents.filter((a) => a.status !== 'done' && a.task !== 'review' && a.task !== 'lead').sort((a, b) => a.startedAt - b.startedAt),
    prs: shown,
    hiddenPrs: all.length - shown.length,
  };
}

/** Where a goal is, in a few words: which slice, and whether its lead is at it, waiting on a PR, or waiting for you. */
export function goalState(lead: Pick<Agent, 'status' | 'lead' | 'held'>): string {
  const work = lead.lead;
  if (work?.closing) return 'Ready to wrap up';
  const slice = `Slice ${work?.slice ?? 1}`;
  if (lead.held) return `${slice} · on hold for your plan's limit`;
  switch (lead.status) {
    case 'waiting':
      return `${slice} · needs approval`;
    case 'error':
      return `${slice} · hit a problem`;
    case 'done':
    case 'stopped': {
      const open = work?.prs.filter((p) => !p.outcome).length ?? 0;
      return `${slice} · ${open ? `${open} PR${open === 1 ? '' : 's'} open` : 'waiting for you'}`;
    }
    default:
      return `${slice} · ${lead.status}`;
  }
}

/**
 * Whether a conflicting PR's agent already has its conflicts in hand: a developer who's at work on it (or queued to)
 * would only hear the request twice. A goal's lead always takes it, with whatever else they're doing.
 */
export function resolvingAlready(agent: Pick<Agent, 'task' | 'status'> | undefined): boolean {
  return !!agent && agent.task !== 'lead' && !FINISHED.includes(agent.status);
}

const FINISHED: Agent['status'][] = ['done', 'error', 'stopped'];

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
