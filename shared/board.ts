import { issueKey, waitingFor } from './dependencyRules';
import { carryMergeable, FINISHED } from './boardRules';
import type { Agent, Board, ClosedPr, Issue, Project, PullRequest } from './types';

export interface Columns {
  /** `waitsFor`: the open issues it depends on, empty when it can start. */
  todo: (Issue & { waitsFor: number[] })[];
  /** The goals under way: each one's lead, in `goalOrder`. In progress for as long as the goal is, at it right now or not. */
  goals: Agent[];
  doing: Agent[];
  /** `agent`: whose PR it is (a slice's lead before anyone seated on it); `resolver`: who's resolving its conflicts right now. */
  prs: (PullRequest & { agent?: Agent; resolver?: Agent })[];
  /** Open PRs hidden by the project's "only my PRs" filter. */
  hiddenPrs: number;
}

/**
 * The order goals are listed in: those whose leads sit at a team station by station (goals started while goals took one),
 * then the rest as they started.
 */
export const goalOrder = (a: Agent, b: Agent): number =>
  (a.lead?.station ?? Number.MAX_SAFE_INTEGER) - (b.lead?.station ?? Number.MAX_SAFE_INTEGER) || a.startedAt - b.startedAt;

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
    goals: agents.filter((a) => a.task === 'lead' && a.lead).sort(goalOrder),
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

/** What GitHub gave back for one of a project's repos: its open issues and PRs, or why it couldn't list them. */
export type RepoListing = { repo: string; issues: Issue[]; prs: PullRequest[] } | { repo: string; error: string };

/**
 * A project's board from its repos' listings, oldest first. A repo GitHub couldn't list is named in `error`, one line
 * each, which is how the rest of Focus knows to leave that repo's work alone until it can. Each issue carries the
 * PR Ops closed for it, if any, and each PR keeps `previous`'s mergeability while GitHub works it out.
 */
export function freshBoard(projectId: string, listings: RepoListing[], previous: PullRequest[], closed: ClosedPr[], updatedAt: number): Board {
  const listed = listings.flatMap((l) => ('error' in l ? [] : [l]));
  const errors = listings.flatMap((l) => ('error' in l ? [`${l.repo}: ${l.error}`] : []));
  const oldestFirst = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);
  const issues = listed
    .flatMap((l) => l.issues)
    .sort(oldestFirst)
    .map((i) => ({ ...i, closedPr: closed.find((c) => c.repo === i.repo && c.issue === i.number) }));
  const prs = carryMergeable(previous, listed.flatMap((l) => l.prs).sort(oldestFirst));
  return { projectId, issues, prs, updatedAt, ...(errors.length ? { error: errors.join('\n') } : {}) };
}
