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
  listPullRequests(repo: string): Promise<PullRequest[]>;
  pullRequestState(repo: string, number: number): Promise<'OPEN' | 'CLOSED' | 'MERGED'>;
  findPullRequest(repo: string, branch: string): Promise<{ number: number; url: string } | null>;
  createPullRequest(repo: string, pr: CreatePullRequest): Promise<{ number: number; url: string }>;
  mergePullRequest(repo: string, number: number, method: 'squash' | 'merge' | 'rebase'): Promise<void>;
  createRepo(name: string, opts: { owner?: string; private: boolean; description: string }): Promise<string>;
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
