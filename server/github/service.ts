import { Context, Data, Effect, ManagedRuntime, type Layer } from 'effect';
import type { GitHubStatus, Issue, PullRequest } from '../../shared/types';
import type { CreatePullRequest, GitHubProvider, IssueDetail, PullRequestDetail, RepoInfo } from './provider';
import type { GhBadOutput, GhCommandError } from './runner';

/** The demo GitHub has no such repo, issue or PR. */
export class GitHubNotFound extends Data.TaggedError('GitHubNotFound')<{ message: string }> {}

/** The demo GitHub refuses the change (the PR isn't open, the repo already exists). */
export class GitHubRejected extends Data.TaggedError('GitHubRejected')<{ message: string }> {}

export type GitHubError = GhCommandError | GhBadOutput | GitHubNotFound | GitHubRejected;

type Op<A> = Effect.Effect<A, GitHubError>;

/** Everything the office needs from GitHub, as Effects. Provided by the gh CLI (`ghCliLayer`) or in memory (`demoLayer`). */
export class GitHub extends Context.Service<GitHub, {
  /** Never fails: a missing or logged-out gh is a status, not an error. */
  readonly status: Effect.Effect<GitHubStatus>;
  readonly listRepos: Op<string[]>;
  repoInfo(repo: string): Op<RepoInfo>;
  listIssues(repo: string): Op<Issue[]>;
  getIssue(repo: string, number: number): Op<IssueDetail>;
  createIssue(repo: string, title: string, body: string, labels?: string[]): Op<Issue>;
  addSubIssue(repo: string, parent: number, child: number): Op<void>;
  listPullRequests(repo: string): Op<PullRequest[]>;
  pullRequestState(repo: string, number: number): Op<'OPEN' | 'CLOSED' | 'MERGED'>;
  findPullRequest(repo: string, branch: string): Op<{ number: number; url: string } | null>;
  getPullRequest(repo: string, number: number): Op<PullRequestDetail>;
  commentOnPullRequest(repo: string, number: number, body: string): Op<string>;
  uploadQaEvidence(repo: string, path: string, bytes: Buffer): Op<string>;
  createPullRequest(repo: string, pr: CreatePullRequest): Op<{ number: number; url: string }>;
  mergePullRequest(repo: string, number: number, method: 'squash' | 'merge' | 'rebase'): Op<void>;
  createRepo(name: string, opts: { owner?: string; private: boolean; description: string }): Op<string>;
}>()('focus/github/GitHub') {}

/**
 * The Promise-based `GitHubProvider` the rest of the server uses, run on a GitHub layer. Promises reject with the
 * tagged error itself, so `errorMessage(err)` still reads well and `err._tag` is there for anyone who wants it.
 */
export function toProvider(layer: Layer.Layer<GitHub>): GitHubProvider {
  const runtime = ManagedRuntime.make(layer);
  const call = <A>(op: (gh: GitHub['Service']) => Effect.Effect<A, GitHubError>) => runtime.runPromise(GitHub.use(op));
  return {
    status: () => call((gh) => gh.status),
    listRepos: () => call((gh) => gh.listRepos),
    repoInfo: (repo) => call((gh) => gh.repoInfo(repo)),
    listIssues: (repo) => call((gh) => gh.listIssues(repo)),
    getIssue: (repo, number) => call((gh) => gh.getIssue(repo, number)),
    createIssue: (repo, title, body, labels) => call((gh) => gh.createIssue(repo, title, body, labels)),
    addSubIssue: (repo, parent, child) => call((gh) => gh.addSubIssue(repo, parent, child)),
    listPullRequests: (repo) => call((gh) => gh.listPullRequests(repo)),
    pullRequestState: (repo, number) => call((gh) => gh.pullRequestState(repo, number)),
    findPullRequest: (repo, branch) => call((gh) => gh.findPullRequest(repo, branch)),
    getPullRequest: (repo, number) => call((gh) => gh.getPullRequest(repo, number)),
    commentOnPullRequest: (repo, number, body) => call((gh) => gh.commentOnPullRequest(repo, number, body)),
    uploadQaEvidence: (repo, path, bytes) => call((gh) => gh.uploadQaEvidence(repo, path, bytes)),
    createPullRequest: (repo, pr) => call((gh) => gh.createPullRequest(repo, pr)),
    mergePullRequest: (repo, number, method) => call((gh) => gh.mergePullRequest(repo, number, method)),
    createRepo: (name, opts) => call((gh) => gh.createRepo(name, opts)),
  };
}
