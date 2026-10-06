import type { ChecksState, GitHubStatus, Issue, PullRequest } from '../../shared/types';

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

/** Everything the office needs from GitHub. Implemented by the gh CLI (live) and an in-memory fake (demo). */
export interface GitHubProvider {
  status(): Promise<GitHubStatus>;
  listRepos(): Promise<string[]>;
  repoInfo(repo: string): Promise<RepoInfo>;
  listIssues(repo: string): Promise<Issue[]>;
  getIssue(repo: string, number: number): Promise<IssueDetail>;
  createIssue(repo: string, title: string, body: string, labels?: string[]): Promise<Issue>;
  /** Makes `child` a sub-issue of `parent` (an epic), both in `repo`. */
  addSubIssue(repo: string, parent: number, child: number): Promise<void>;
  listPullRequests(repo: string): Promise<PullRequest[]>;
  pullRequestState(repo: string, number: number): Promise<'OPEN' | 'CLOSED' | 'MERGED'>;
  findPullRequest(repo: string, branch: string): Promise<{ number: number; url: string } | null>;
  getPullRequest(repo: string, number: number): Promise<PullRequestDetail>;
  /** Posts a comment on a pull request and returns its URL. */
  commentOnPullRequest(repo: string, number: number, body: string): Promise<string>;
  /** Commits a file to the repo's QA evidence branch, creating the branch on first use, and returns its URL. */
  uploadQaEvidence(repo: string, path: string, bytes: Buffer): Promise<string>;
  createPullRequest(repo: string, pr: CreatePullRequest): Promise<{ number: number; url: string }>;
  mergePullRequest(repo: string, number: number, method: 'squash' | 'merge' | 'rebase'): Promise<void>;
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

export function rollupChecks(rollup: unknown): ChecksState {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  let pending = false;
  for (const item of rollup as Record<string, string | undefined>[]) {
    const conclusion = (item.conclusion ?? '').toUpperCase();
    const state = (item.state ?? '').toUpperCase();
    const status = (item.status ?? '').toUpperCase();
    if (['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'].includes(conclusion || state)) {
      return 'failing';
    }
    if ((status && status !== 'COMPLETED') || state === 'PENDING' || state === 'EXPECTED') pending = true;
  }
  return pending ? 'pending' : 'passing';
}
