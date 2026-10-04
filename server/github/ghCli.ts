import type { GitHubStatus, Issue, PullRequest } from '../../shared/types';
import { errorMessage, run } from '../util';
import { rollupChecks, type CreatePullRequest, type GitHubProvider, type IssueDetail, type RepoInfo } from './provider';

const gh = (args: string[], input?: string) => run('gh', args, { input, timeoutMs: 120_000 });
const ghJson = async <T>(args: string[]): Promise<T> => JSON.parse(await gh(args)) as T;

interface RawIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: { name: string }[];
  author?: { login: string };
  createdAt: string;
  comments?: { author?: { login: string }; body: string }[];
}

interface RawPr {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  author?: { login: string };
  isDraft: boolean;
  mergeable: PullRequest['mergeable'];
  reviewDecision?: string;
  statusCheckRollup?: unknown;
  createdAt: string;
}

const ISSUE_FIELDS = 'number,title,body,url,labels,author,createdAt';
const PR_FIELDS = 'number,title,url,headRefName,author,isDraft,mergeable,reviewDecision,statusCheckRollup,createdAt';

function toIssue(repo: string, raw: RawIssue): Issue {
  return {
    repo,
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    url: raw.url,
    labels: (raw.labels ?? []).map((l) => l.name),
    author: raw.author?.login,
    createdAt: raw.createdAt,
  };
}

function numberFromUrl(url: string): number {
  const match = /\/(\d+)\s*$/.exec(url.trim());
  if (!match) throw new Error(`Could not read a number from "${url.trim()}"`);
  return Number(match[1]);
}

/** Talks to GitHub through the `gh` CLI, so it uses whatever account `gh auth login` set up. */
export class GhCliProvider implements GitHubProvider {
  async status(): Promise<GitHubStatus> {
    try {
      const login = (await gh(['api', 'user', '--jq', '.login'])).trim();
      return { ok: true, login };
    } catch (err) {
      return { ok: false, error: `gh is not ready: ${errorMessage(err)}. Install the GitHub CLI and run "gh auth login".` };
    }
  }

  async listRepos(): Promise<string[]> {
    const out = await gh(['repo', 'list', '--limit', '200', '--json', 'nameWithOwner', '--jq', '.[].nameWithOwner']);
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async repoInfo(repo: string): Promise<RepoInfo> {
    const raw = await ghJson<{
      nameWithOwner: string;
      defaultBranchRef: { name: string } | null;
      url: string;
      description: string | null;
      isEmpty: boolean;
    }>(['repo', 'view', repo, '--json', 'nameWithOwner,defaultBranchRef,url,description,isEmpty']);
    return {
      nameWithOwner: raw.nameWithOwner,
      defaultBranch: raw.defaultBranchRef?.name || 'main',
      url: raw.url,
      description: raw.description ?? '',
      isEmpty: raw.isEmpty,
    };
  }

  async listIssues(repo: string): Promise<Issue[]> {
    const raw = await ghJson<RawIssue[]>(['issue', 'list', '-R', repo, '--state', 'open', '--limit', '100', '--json', ISSUE_FIELDS]);
    return raw.map((i) => toIssue(repo, i));
  }

  async getIssue(repo: string, number: number): Promise<IssueDetail> {
    const raw = await ghJson<RawIssue>(['issue', 'view', String(number), '-R', repo, '--json', `${ISSUE_FIELDS},comments`]);
    return {
      ...toIssue(repo, raw),
      comments: (raw.comments ?? []).map((c) => ({ author: c.author?.login ?? 'someone', body: c.body })),
    };
  }

  async createIssue(repo: string, title: string, body: string, labels: string[] = []): Promise<Issue> {
    const args = ['issue', 'create', '-R', repo, '--title', title, '--body-file', '-'];
    for (const label of labels) args.push('--label', label);
    const url = (await gh(args, body)).trim().split('\n').pop()!;
    return { repo, number: numberFromUrl(url), title, body, url, labels, createdAt: new Date().toISOString() };
  }

  async listPullRequests(repo: string): Promise<PullRequest[]> {
    const raw = await ghJson<RawPr[]>(['pr', 'list', '-R', repo, '--state', 'open', '--limit', '100', '--json', PR_FIELDS]);
    return raw.map((p) => ({
      repo,
      number: p.number,
      title: p.title,
      url: p.url,
      branch: p.headRefName,
      author: p.author?.login,
      isDraft: p.isDraft,
      mergeable: p.mergeable ?? 'UNKNOWN',
      reviewDecision: p.reviewDecision || undefined,
      checks: rollupChecks(p.statusCheckRollup),
      createdAt: p.createdAt,
    }));
  }

  async pullRequestState(repo: string, number: number): Promise<'OPEN' | 'CLOSED' | 'MERGED'> {
    const raw = await ghJson<{ state: 'OPEN' | 'CLOSED' | 'MERGED' }>(['pr', 'view', String(number), '-R', repo, '--json', 'state']);
    return raw.state;
  }

  async findPullRequest(repo: string, branch: string): Promise<{ number: number; url: string } | null> {
    const raw = await ghJson<{ number: number; url: string }[]>([
      'pr', 'list', '-R', repo, '--head', branch, '--state', 'open', '--json', 'number,url',
    ]);
    return raw[0] ?? null;
  }

  async createPullRequest(repo: string, pr: CreatePullRequest): Promise<{ number: number; url: string }> {
    const out = await gh(
      ['pr', 'create', '-R', repo, '--head', pr.head, '--base', pr.base, '--title', pr.title, '--body-file', '-'],
      pr.body,
    );
    const url = out.trim().split('\n').pop()!;
    return { number: numberFromUrl(url), url };
  }

  async mergePullRequest(repo: string, number: number, method: 'squash' | 'merge' | 'rebase'): Promise<void> {
    await gh(['pr', 'merge', String(number), '-R', repo, `--${method}`, '--delete-branch']);
  }

  async createRepo(name: string, opts: { owner?: string; private: boolean; description: string }): Promise<string> {
    const full = opts.owner ? `${opts.owner}/${name}` : name;
    const args = ['repo', 'create', full, opts.private ? '--private' : '--public', '--add-readme'];
    if (opts.description) args.push('--description', opts.description);
    const url = (await gh(args)).trim().split('\n').pop()!;
    const match = /github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(url);
    if (match) return match[1];
    return (await this.repoInfo(full)).nameWithOwner;
  }
}
