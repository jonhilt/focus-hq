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
export async function checkoutPreview(repo: string, dir: string, ref: { pr: number } | { branch: string }): Promise<string> {
  const mirror = mirrorDir(repo);
  // refs/pull/N/head exists for every PR, forks included
  const source = 'pr' in ref ? `refs/pull/${ref.pr}/head` : `refs/heads/${ref.branch}`;
  return lock.with(repo, async () => {
    await ensureMirror(repo);
    await git(mirror, ['fetch', 'origin', `+${source}:refs/focus/preview`], 10 * 60_000);
    const sha = (await git(mirror, ['rev-parse', 'refs/focus/preview'])).trim();
    const reused =
      fs.existsSync(path.join(dir, '.git')) &&
      (await git(dir, ['checkout', '--detach', '--force', sha]).then(() => true, () => false));
    if (reused) {
      await git(dir, ['clean', '-fd']); // untracked files from the last preview; ignored ones (node_modules, bin/obj) stay
    } else {
      // first preview here, or a checkout broken by an earlier failure or a re-cloned mirror
      fs.rmSync(dir, { recursive: true, force: true });
      await git(mirror, ['worktree', 'prune']);
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      await git(mirror, ['worktree', 'add', '--detach', dir, sha]);
    }
    return sha;
  });
}

export function workspaceDir(agentId: string): string {
  return path.join(paths.workspaces, agentId);
}

/** Number of commits on HEAD that are not on the base branch. */
export async function commitsAhead(dir: string, baseBranch: string): Promise<number> {
  const out = await git(dir, ['rev-list', '--count', `origin/${baseBranch}..HEAD`]);
  return Number(out.trim()) || 0;
}

export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  return (await git(dir, ['status', '--porcelain'])).trim().length > 0;
}

export async function pushBranch(dir: string, branch: string): Promise<void> {
  await git(dir, ['push', '--force-with-lease', '-u', 'origin', `HEAD:refs/heads/${branch}`], 5 * 60_000);
}

export async function commitLog(dir: string, baseBranch: string): Promise<string> {
  return (await git(dir, ['log', '--format=- %s', `origin/${baseBranch}..HEAD`])).trim();
}
