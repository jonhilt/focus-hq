import type { Agent, Board, ClosedPr, PullRequest } from './types';

// The board's decisions: whether a conflicting PR's agent already has it in hand, which mergeability a fresh PR
// keeps, which held PRs to ask GitHub about, and which closed-PR notes to drop. Pure, so it's unit tested
// (boardRules.test.ts); focus.ts refreshes the board and the client draws it.

/** An agent who has stopped working, for good or until a message. */
export const FINISHED: Agent['status'][] = ['done', 'error', 'stopped'];

/**
 * Whether a conflicting PR's agent already has its conflicts in hand: a developer who's at work on it (or queued to)
 * would only hear the request twice. A goal's lead always takes it, with whatever else they're doing.
 */
export function resolvingAlready(agent: Pick<Agent, 'task' | 'status'> | undefined): boolean {
  return !!agent && agent.task !== 'lead' && !FINISHED.includes(agent.status);
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

/** A pull request Ops still holds work for: a QA review (`review`), or a lead's or a finished agent's (`seat`). */
export interface HeldPr {
  repo: string;
  number: number;
  kind: 'review' | 'seat';
}

/**
 * The pull requests Ops holds work for that have left the board, so GitHub is asked whether they merged or closed:
 * QA reviews first, then the leads' PRs, then finished agents'. One opened a moment ago may not be listed yet, so it's
 * asked about rather than taken as closed; a repo GitHub couldn't list (named in `board.error`) is left until it can.
 */
export function prsOffBoard(
  board: Pick<Board, 'prs' | 'error'>,
  held: { reviews: { repo: string; number: number }[]; leadPrs: { repo: string; number: number }[]; agents: Pick<Agent, 'repo' | 'status' | 'pr'>[] },
): HeldPr[] {
  const done = held.agents.flatMap((a) => (a.pr && a.status === 'done' ? [{ repo: a.repo, number: a.pr.number }] : []));
  const all: HeldPr[] = [
    ...held.reviews.map((r) => ({ repo: r.repo, number: r.number, kind: 'review' as const })),
    ...[...held.leadPrs, ...done].map((p) => ({ repo: p.repo, number: p.number, kind: 'seat' as const })),
  ];
  return all.filter((p) => !board.error?.includes(p.repo) && !board.prs.some((b) => b.repo === p.repo && b.number === p.number));
}

/**
 * The closed-PR notes with nothing left to mark: their issue isn't open on the board any more (closed since, or built
 * another way). A note for a repo GitHub couldn't list, or one outside the project, is kept.
 */
export function staleClosedPrs(repos: string[], board: Pick<Board, 'issues' | 'error'>, closed: ClosedPr[]): ClosedPr[] {
  return closed.filter((c) => repos.includes(c.repo) && !board.error?.includes(c.repo) && !board.issues.some((i) => i.repo === c.repo && i.number === c.issue));
}
