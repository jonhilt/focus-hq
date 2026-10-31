// A commit a preview is pinned to, in Ops' clone of its repo. Keeps nothing: it fetches from GitHub, and the preview
// checkout tests hold it to real git (previewCheckout.test.ts).

import { run } from '../util';

const git = (cwd: string, args: string[], timeoutMs?: number) => run('git', args, { cwd, timeoutMs });
const hasCommit = (mirror: string, sha: string) => git(mirror, ['cat-file', '-e', `${sha}^{commit}`]).then(() => true, () => false);

/**
 * `sha`, once Ops' clone (`mirror`) has it: fetched on its own when no branch fetched so far reaches it (GitHub serves a
 * commit by its id until it's collected). One gone from GitHub too fails, saying so: a restack rewrote its branch.
 */
export async function pinnedCommit(repo: string, mirror: string, sha: string): Promise<string> {
  if (await hasCommit(mirror, sha)) return sha;
  await git(mirror, ['fetch', 'origin', sha], 10 * 60_000).catch(() => '');
  if (!(await hasCommit(mirror, sha))) throw new Error(`${repo} no longer has the commit ${sha.slice(0, 7)}: its branch was likely rewritten (restacked)`);
  return sha;
}
