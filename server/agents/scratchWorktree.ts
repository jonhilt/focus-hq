// A scratch worktree of Ops' clone of a repo, for Ops' own work on a pull request's branch (merging its base in, moving
// it onto the branch below): made under the clone's lock, and removed after. It keeps nothing.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config';
import { run, sleep } from '../util';
import { ensureMirror, lock, mirrorDir, removeDir } from './workspace';
import { retryLockRace } from './worktrees';

const git = (cwd: string, args: string[], timeoutMs?: number) => run('git', args, { cwd, timeoutMs });

/** Runs `work` in a scratch worktree of Ops' clone of `repo`, detached at origin's `branch` as just fetched, then removes it. */
export async function inScratchWorktree<A>(repo: string, branch: string, work: (dir: string) => Promise<A>): Promise<A> {
  const mirror = mirrorDir(repo);
  const dir = path.join(paths.merges, `${repo.replace('/', '__')}-${randomBytes(4).toString('hex')}`);
  await lock.with(repo, async () => {
    await ensureMirror(repo);
    await retryLockRace(() => git(mirror, ['fetch', 'origin', '--prune'], 10 * 60_000), () => sleep(750));
    fs.mkdirSync(paths.merges, { recursive: true });
    await git(mirror, ['worktree', 'add', '--detach', dir, `origin/${branch}`]);
  });
  try {
    return await work(dir);
  } finally {
    await lock.with(repo, () => removeDir(mirror, dir));
  }
}
