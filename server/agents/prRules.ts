import type { GoalRecord, LeadPr, PullRequest, QaReview } from '../../shared/types';

// The rules for a goal's pull requests, as small pure functions: which are a goal's, when one goes to QA, when QA
// tests it again. `manager/goalPrs.ts` runs them as the board refreshes and the lead's turns start and end; each rule
// changes here, with its test beside it (prRules.test.ts).

/** The branches one lead's checkout of a repo has been on, as its own HEAD reflog has them. */
export interface SeenBranches {
  leadId: string;
  repo: string;
  branches: readonly string[];
}

/** A PR that's a lead's: one they opened themselves, from a branch of theirs. */
export interface Claim {
  leadId: string;
  pr: Pick<LeadPr, 'repo' | 'number' | 'url'> & { branch: string };
  draft: boolean;
}

/**
 * The open PRs whose head branch exactly one lead's checkout has been on, that no lead holds yet. A lead opens their
 * own PRs, so Ops learns which are theirs from where their checkout has been, not from being told. A base branch is
 * never claimed, since every checkout starts on one; a branch two leads have been on is neither's, rather than a guess.
 */
export function claims(
  prs: readonly Pick<PullRequest, 'repo' | 'number' | 'url' | 'branch' | 'baseBranch' | 'isDraft'>[],
  seen: readonly SeenBranches[],
  held: (repo: string, number: number) => boolean,
): Claim[] {
  return prs.flatMap((pr) => {
    if (held(pr.repo, pr.number) || pr.branch === pr.baseBranch) return [];
    const leads = new Set(seen.filter((s) => s.repo === pr.repo && s.branches.includes(pr.branch)).map((s) => s.leadId));
    const [leadId] = leads;
    if (leads.size !== 1) return [];
    return [{ leadId, pr: { repo: pr.repo, number: pr.number, url: pr.url, branch: pr.branch }, draft: pr.isDraft }];
  });
}

/** A PR from a closed goal's own branch, to keep with that goal. */
export interface FiledClaim {
  goalId: string;
  pr: Pick<LeadPr, 'repo' | 'number' | 'url'> & { branch: string };
  draft: boolean;
}

/**
 * The open PRs from a closed goal's own branch, in a repo it was checked out from, that nobody holds: one its lead
 * opened as the goal closed (from a branch they'd pushed before) stays with the goal, rather than on no goal.
 */
export function filedClaims(
  prs: readonly Pick<PullRequest, 'repo' | 'number' | 'url' | 'branch' | 'baseBranch' | 'isDraft'>[],
  goals: readonly Pick<GoalRecord, 'id' | 'branch' | 'repos' | 'prs'>[],
  held: (repo: string, number: number) => boolean,
): FiledClaim[] {
  return prs.flatMap((pr) => {
    if (held(pr.repo, pr.number) || pr.branch === pr.baseBranch) return [];
    const goal = goals.find((g) => !g.prs.some((p) => p.repo === pr.repo && p.number === pr.number) && g.repos?.some((r) => r.repo === pr.repo && (r.branch ?? g.branch) === pr.branch));
    return goal ? [{ goalId: goal.id, pr: { repo: pr.repo, number: pr.number, url: pr.url, branch: pr.branch }, draft: pr.isDraft }] : [];
  });
}

/**
 * A goal's PRs that are ready for review that `seen` hasn't seen yet (QA's review, the ledger's ready line): marking a
 * draft ready (or opening one ready) is how a lead asks for review, in place of shipping it. A draft waits.
 */
export function readyPrs<P extends Pick<PullRequest, 'repo' | 'number' | 'isDraft'>>(
  prs: readonly P[],
  goals: (repo: string, number: number) => boolean,
  seen: (repo: string, number: number) => boolean,
): P[] {
  return prs.filter((pr) => !pr.isDraft && goals(pr.repo, pr.number) && !seen(pr.repo, pr.number));
}

/**
 * As a lead's turn ends, the PRs of theirs to send back to QA: open, ready, with a verdict from QA. Whether the lead
 * pushed to one since is QA's precheck to say (it leaves a verdict on the same head standing), so a turn of several
 * pushes gets one re-test, and a turn of none gets none. One QA is still on, or hasn't started, waits for that.
 */
export function retestAfterTurn<P extends Pick<PullRequest, 'repo' | 'number' | 'isDraft'>>(
  prs: readonly Pick<LeadPr, 'repo' | 'number' | 'outcome'>[],
  board: readonly P[],
  review: (repo: string, number: number) => Pick<QaReview, 'status'> | undefined,
): P[] {
  return board.filter((pr) => !pr.isDraft
    && prs.some((p) => p.repo === pr.repo && p.number === pr.number && !p.outcome)
    && ['passed', 'failed'].includes(review(pr.repo, pr.number)?.status ?? ''));
}

/** The branches a HEAD reflog (`git reflog --format=%gs`) says its checkout moved between. */
export function reflogBranches(reflog: string): string[] {
  const moves = [...reflog.matchAll(/^checkout: moving from (\S+) to (\S+)$/gm)];
  return [...new Set(moves.flatMap((m) => [m[1], m[2]]))];
}
