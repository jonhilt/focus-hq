// Ops' move of a stacked waypoint's branch onto the branch below it. It keeps nothing of its own: it works in a scratch
// worktree of Ops' clone (`inScratchWorktree`) and pushes to GitHub, and the workspace contract holds it to real git
// (workspaceContract.ts).

import { run } from '../util';
import { conflictStages } from './conflicts';
import type { Restack } from './types';
import { inScratchWorktree } from './scratchWorktree';
import { head } from './workspace';

const git = (cwd: string, args: string[], timeoutMs?: number) => run('git', args, { cwd, timeoutMs });

/**
 * Moves origin's `branch` onto origin's `onto` in a scratch worktree (`git rebase --onto origin/<onto> <upstream>`), so
 * only its own commits are replayed: after the branch below was squash-merged, replaying that one's commits too would
 * conflict with their squash. Up to date when it's on `onto` already. A conflict aborts it and pushes nothing. The
 * push is forced, leased to where the branch was, so it fails if someone pushed to it meanwhile.
 */
export function restack(repo: string, branch: string, onto: string, upstream: string): Promise<Restack> {
  return inScratchWorktree(repo, branch, async (dir) => {
    const before = await head(dir);
    const on = await git(dir, ['merge-base', '--is-ancestor', `origin/${onto}`, 'HEAD']).then(() => true, () => false);
    if (on) return { kind: 'up-to-date' };
    try {
      await git(dir, ['-c', 'core.hooksPath=/dev/null', 'rebase', '--onto', `origin/${onto}`, upstream]);
    } catch (err) {
      const files = [...conflictStages(await git(dir, ['ls-files', '-u', '-z']).catch(() => '')).keys()];
      await git(dir, ['rebase', '--abort']).catch(() => '');
      if (!files.length) throw err;
      return { kind: 'conflicts', files };
    }
    const after = await head(dir);
    await git(dir, ['push', `--force-with-lease=refs/heads/${branch}:${before}`, 'origin', `HEAD:refs/heads/${branch}`], 5 * 60_000);
    return { kind: 'restacked', sha: after, from: before };
  });
}
