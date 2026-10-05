import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config';
import { KeyedLock, run } from '../util';

const lock = new KeyedLock();

const git = (cwd: string, args: string[], timeoutMs?: number) => run('git', args, { cwd, timeoutMs });

function mirrorDir(repo: string): string {
  return path.join(paths.mirrors, repo.replace('/', '__'));
}

/** Clones the repository into data/repos the first time it's needed. Call inside the repo's lock. */
async function ensureMirror(repo: string): Promise<void> {
  const mirror = mirrorDir(repo);
  if (fs.existsSync(path.join(mirror, '.git'))) return;
  fs.mkdirSync(paths.mirrors, { recursive: true });
  await run('gh', ['repo', 'clone', repo, mirror], { timeoutMs: 15 * 60_000 });
}

/**
 * One clone per repository lives in data/repos; every agent gets its own git worktree of it in
 * data/workspaces/<agent id> so agents on the same repo never trip over each other.
 */
export async function createWorktree(repo: string, agentId: string, branch: string, startPoint: string): Promise<string> {
  const mirror = mirrorDir(repo);
  const dir = path.join(paths.workspaces, agentId);
  await lock.with(repo, async () => {
    await ensureMirror(repo);
    await git(mirror, ['fetch', 'origin', '--prune'], 10 * 60_000);
    await git(mirror, ['worktree', 'prune']);
    if (fs.existsSync(dir)) {
      // Re-hiring the same agent id should never happen, but don't leave a half-made worktree behind.
      await git(mirror, ['worktree', 'remove', '--force', dir]).catch(() => fs.rmSync(dir, { recursive: true, force: true }));
    }
    fs.mkdirSync(paths.workspaces, { recursive: true });
    // --no-track: the branch must not track origin/<base>, so a stray `git push` can never land on the base branch
    await git(mirror, ['worktree', 'add', '--no-track', '-B', branch, dir, `origin/${startPoint}`]);
  });
  return dir;
}

export async function removeWorktree(repo: string, agentId: string): Promise<void> {
  const dir = path.join(paths.workspaces, agentId);
  if (!fs.existsSync(dir)) return;
  await lock.with(repo, () => git(mirrorDir(repo), ['worktree', 'remove', '--force', dir])).catch(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

/**
 * Checks a pull request's head (or a branch) out into a preview folder. Preview folders are reused from one preview to
 * the next, so installed dependencies and build output (ignored files) survive. Returns the commit checked out.
 */
export function checkoutPreview(repo: string, dir: string, ref: { pr: number } | { branch: string }): Promise<string> {
  // refs/pull/N/head exists for every PR, forks included
  const source = 'pr' in ref ? `refs/pull/${ref.pr}/head` : `refs/heads/${ref.branch}`;
  return checkoutDetached(repo, dir, source, 'refs/focus/preview');
}

/** The default branch's latest commit, detached in `dir`, for agents that only read the code (the planner). */
export function checkoutLatest(repo: string, dir: string): Promise<string> {
  return checkoutDetached(repo, dir, 'HEAD', 'refs/focus/latest');
}

/** Fetches `source` from origin into the mirror's `localRef` and checks it out, detached, in a reusable folder. */
function checkoutDetached(repo: string, dir: string, source: string, localRef: string): Promise<string> {
  const mirror = mirrorDir(repo);
  return lock.with(repo, async () => {
    await ensureMirror(repo);
    await git(mirror, ['fetch', 'origin', `+${source}:${localRef}`], 10 * 60_000);
    const sha = (await git(mirror, ['rev-parse', localRef])).trim();
    const reused =
      fs.existsSync(path.join(dir, '.git')) &&
      (await git(dir, ['checkout', '--detach', '--force', sha]).then(() => true, () => false));
    if (reused) {
      await git(dir, ['clean', '-fd']); // untracked files from last time; ignored ones (node_modules, bin/obj) stay
    } else {
      // first checkout here, or one broken by an earlier failure or a re-cloned mirror
      fs.rmSync(dir, { recursive: true, force: true });
      await git(mirror, ['worktree', 'prune']);
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      await git(mirror, ['worktree', 'add', '--detach', dir, sha]);
    }
    return sha;
  });
}

/** The QA officer's checkout: a pull request's head, detached, in their workspace folder. Returns the commit. */
export function checkoutPullRequest(repo: string, agentId: string, number: number): Promise<string> {
  return checkoutDetached(repo, path.join(paths.workspaces, agentId), `refs/pull/${number}/head`, 'refs/focus/qa');
}

export function workspaceDir(agentId: string): string {
  return path.join(paths.workspaces, agentId);
}

/** Number of commits on HEAD that are not on the base branch. */
export async function commitsAhead(dir: string, baseBranch: string): Promise<number> {
  const out = await git(dir, ['rev-list', '--count', `origin/${baseBranch}..HEAD`]);
  return Number(out.trim()) || 0;
}

export async function head(dir: string): Promise<string> {
  return (await git(dir, ['rev-parse', 'HEAD'])).trim();
}

export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  return (await git(dir, ['status', '--porcelain'])).trim().length > 0;
}

export async function pushBranch(dir: string, branch: string): Promise<void> {
  await git(dir, ['push', '--force-with-lease', '-u', 'origin', `HEAD:refs/heads/${branch}`], 5 * 60_000);
}

/** Creates `branch` on origin at the worktree's commit, unless it's already there: then the worktree takes what's there. */
export async function publishBranch(dir: string, branch: string): Promise<void> {
  const exists = (await git(dir, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], 60_000)).trim().length > 0;
  if (exists) await pullBranch(dir, branch);
  else await git(dir, ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`], 5 * 60_000);
}

/** Resets the worktree to what's on origin's `branch`: a cloud agent pushes there, and nothing local is kept. */
export async function pullBranch(dir: string, branch: string): Promise<void> {
  await git(dir, ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], 5 * 60_000);
  await git(dir, ['reset', '--hard', `origin/${branch}`]);
}

export async function commitLog(dir: string, baseBranch: string): Promise<string> {
  return (await git(dir, ['log', '--format=- %s', `origin/${baseBranch}..HEAD`])).trim();
}
