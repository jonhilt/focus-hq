import type { ChecksState, FailedCheck, GitHubStatus, Issue, PullRequest, ReviewComment } from '../../shared/types';

export interface RepoInfo {
  nameWithOwner: string;
  defaultBranch: string;
  url: string;
  description: string;
  isEmpty: boolean;
}

export interface IssueDetail extends Issue {
  comments: { author: string; body: string }[];
}

/** One pull request in full, for the QA officer. */
export interface PullRequestDetail {
  number: number;
  title: string;
  body: string;
  url: string;
  branch: string;
  baseBranch: string;
  headSha: string;
  author?: string;
  /** Issues it closes ("Closes #N", or linked on GitHub). */
  linkedIssues: number[];
}

/** A pull request of any state, with its conversation: the record of past work on a line of branches (a plugin's, like the climbs'). */
export interface PastPullRequest {
  number: number;
  title: string;
  body: string;
  url: string;
  branch: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  createdAt: string;
  closedAt?: string;
  comments: { author: string; body: string }[];
}

/** The orphan branch QA's screenshots go on: no shared history with the code, never merged. */
export const QA_EVIDENCE_BRANCH = 'focus-qa-evidence';

/** How a file on the QA evidence branch is linked from a comment; works for private repos too. */
export const evidenceUrl = (repo: string, path: string) => `https://github.com/${repo}/blob/${QA_EVIDENCE_BRANCH}/${path}?raw=true`;

export interface CreatePullRequest {
  head: string;
  base: string;
  title: string;
  body: string;
}

/** Everything Focus needs from GitHub. Implemented by the gh CLI (live) and an in-memory fake (demo). */
export interface GitHubProvider {
  status(): Promise<GitHubStatus>;
  listRepos(): Promise<string[]>;
  repoInfo(repo: string): Promise<RepoInfo>;
  listIssues(repo: string): Promise<Issue[]>;
  getIssue(repo: string, number: number): Promise<IssueDetail>;
  createIssue(repo: string, title: string, body: string, labels?: string[]): Promise<Issue>;
  listPullRequests(repo: string): Promise<PullRequest[]>;
  pullRequestState(repo: string, number: number): Promise<'OPEN' | 'CLOSED' | 'MERGED'>;
  findPullRequest(repo: string, branch: string): Promise<{ number: number; url: string } | null>;
  getPullRequest(repo: string, number: number): Promise<PullRequestDetail>;
  /** Posts a comment on a pull request and returns its URL. */
  commentOnPullRequest(repo: string, number: number, body: string): Promise<string>;
  /** Replaces a pull request's description. */
  editPullRequestBody(repo: string, number: number, body: string): Promise<void>;
  /** What a pull request's comments say, oldest first. */
  pullRequestComments(repo: string, number: number): Promise<string[]>;
  /** A review's comments on lines of code (`reviewId` as `PrReview.id` has it), in order. */
  reviewComments(repo: string, reviewId: string): Promise<ReviewComment[]>;
  /** Commits a file to the repo's QA evidence branch, creating the branch on first use, and returns its URL. */
  uploadQaEvidence(repo: string, path: string, bytes: Buffer): Promise<string>;
  createPullRequest(repo: string, pr: CreatePullRequest): Promise<{ number: number; url: string }>;
  /** `headSha` makes GitHub refuse the merge if the branch has moved past that commit. */
  mergePullRequest(repo: string, number: number, method: 'squash' | 'merge' | 'rebase', headSha?: string): Promise<void>;
  /** Re-runs the failed jobs of these GitHub Actions runs. */
  rerunFailedRuns(repo: string, runIds: number[]): Promise<void>;
  /** Closes a pull request unmerged, with a comment saying why. The issues it would have closed stay open. */
  closePullRequest(repo: string, number: number, comment: string): Promise<void>;
  /** The pull request's diff against its base. */
  pullRequestDiff(repo: string, number: number): Promise<string>;
  createRepo(name: string, opts: { owner?: string; private: boolean; description: string }): Promise<string>;
}

/** Issue numbers a PR body says it closes ("Closes #7", "fixes #8, #9"). */
export function closingIssues(body: string): number[] {
  const out = new Set<number>();
  for (const m of (body ?? '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+((?:#\d+(?:\s*(?:,|and)\s*)?)+)/gi)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) out.add(Number(n[1]));
  }
  return [...out];
}

type RollupItem = Record<string, string | undefined>;

const rollupItems = (rollup: unknown): RollupItem[] => (Array.isArray(rollup) ? (rollup as RollupItem[]) : []);

const failed = (item: RollupItem) =>
  ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'].includes((item.conclusion || item.state || '').toUpperCase());

export function rollupChecks(rollup: unknown): ChecksState {
  const items = rollupItems(rollup);
  if (items.length === 0) return 'none';
  let pending = false;
  for (const item of items) {
    const state = (item.state ?? '').toUpperCase();
    const status = (item.status ?? '').toUpperCase();
    if (failed(item)) return 'failing';
    if ((status && status !== 'COMPLETED') || state === 'PENDING' || state === 'EXPECTED') pending = true;
  }
  return pending ? 'pending' : 'passing';
}

/** The failed checks in a status check rollup: GitHub Actions jobs (check runs) and other CI's commit statuses. */
export function failedChecks(rollup: unknown): FailedCheck[] {
  return rollupItems(rollup)
    .filter(failed)
    .map((item) => {
      const url = item.detailsUrl || item.targetUrl || undefined;
      const run = url ? /\/actions\/runs\/(\d+)/.exec(url) : null;
      const name = [item.workflowName, item.name || item.context].filter(Boolean).join(' / ') || 'a check';
      return { name, url, runId: run ? Number(run[1]) : undefined };
    });
}
