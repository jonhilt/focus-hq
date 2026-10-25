// Issues, pull requests and the board, as Focus sees them on GitHub.

export interface Issue {
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  author?: string;
  createdAt: string;
  /** Ops closed a PR for it because the approach was wrong, so it's open for another go. */
  closedPr?: ClosedPr;
}

/** A PR the room's operations officer closed, remembered on the issue it was meant to close. */
export interface ClosedPr {
  repo: string;
  issue: number;
  pr: number;
  officer: string;
  /** What was wrong with the approach, for whoever builds it next. */
  note: string;
  at: number;
}

export type ChecksState = 'passing' | 'failing' | 'pending' | 'none';

/** A check on a pull request that failed. */
export interface FailedCheck {
  name: string;
  url?: string;
  /** The GitHub Actions run it's part of, which `gh run rerun --failed` can re-run. Missing for other CI. */
  runId?: number;
}

export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  url: string;
  branch: string;
  /** Commit at the head of the PR branch. */
  headSha?: string;
  baseBranch: string;
  author?: string;
  isDraft: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  reviewDecision?: string;
  checks: ChecksState;
  /** The checks that failed, while `checks` is 'failing'. */
  failedChecks: FailedCheck[];
  /** Issues in the same repo it closes ("Closes #N", or linked on GitHub). */
  closes: number[];
  createdAt: string;
  /** Last activity on GitHub. Missing when the provider can't tell. */
  updatedAt?: string;
  /** Where Ops' merge check on its head stands (docs/merging.md): Ops stamps it on, GitHub never says. */
  mergeCheck?: MergeCheck;
  /** The reviews submitted on it, oldest first. Missing when the provider can't tell. */
  reviews?: PrReview[];
}

/** A review submitted on a pull request on GitHub: approving it, asking for changes, or commenting (on lines of code too). */
export interface PrReview {
  /** GitHub's id for it, which its comments on the code are read by (`GitHub.reviewComments`). */
  id: string;
  author: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  body: string;
  submittedAt: string;
}

/** One of a review's comments on a line of code. `line` is missing on one whose code has since changed. */
export interface ReviewComment {
  author: string;
  path: string;
  line?: number;
  body: string;
}

/** Where a PR's merge check stands, as its card on the board shows it (shared/mergeCheck.ts). */
export interface MergeCheck {
  state: 'queued' | 'checking' | 'passed' | 'refused' | 'overridden';
  /** The PR's head it's about: a push makes it old news. */
  head: string;
  /** While queued: the PR whose merge in the same repo goes just before it. */
  behind?: number;
  reason?: string;
}

export interface Board {
  projectId: string;
  issues: Issue[];
  prs: PullRequest[];
  updatedAt: number;
  error?: string;
}

export interface GitHubStatus {
  ok: boolean;
  login?: string;
  error?: string;
}
