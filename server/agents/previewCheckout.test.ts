import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { checkoutPreview, mirrorDir } from './workspace';

// A preview pinned to a waypoint's commit, checked out by git itself: a bare origin (GitHub), Ops' clone of it where
// `gh repo clone` would have put it, and a teammate pushing to a branch.

vi.setConfig({ testTimeout: 30_000 });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-pin-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
Object.assign(process.env, { GIT_AUTHOR_NAME: 'Agent', GIT_AUTHOR_EMAIL: 'agent@focus.test', GIT_COMMITTER_NAME: 'Agent', GIT_COMMITTER_EMAIL: 'agent@focus.test', GIT_CONFIG_NOSYSTEM: '1' });

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, encoding: 'utf8' })).stdout.trim();

/** An origin with main and a branch `focus/wp` whose head is `second`, its first commit `first`; Ops' clone of it. */
async function world(n: number) {
  const repo = `pin/r${n}`;
  const origin = path.join(tmp, `origin-${n}.git`);
  await git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  // GitHub serves a commit by its id whether a branch still reaches it or not
  await git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  const other = path.join(tmp, `other-${n}`);
  await git(tmp, 'clone', '-q', origin, other);
  await git(other, 'checkout', '-qb', 'main');
  const commit = async (text: string) => {
    fs.writeFileSync(path.join(other, 'app.txt'), text);
    await git(other, 'add', '-A');
    await git(other, 'commit', '-qm', text);
    return git(other, 'rev-parse', 'HEAD');
  };
  await commit('base');
  await git(other, 'push', '-q', 'origin', 'main');
  await git(other, 'checkout', '-qb', 'focus/wp');
  const first = await commit('first');
  const second = await commit('second');
  await git(other, 'push', '-q', 'origin', 'focus/wp');
  await git(tmp, 'clone', '-q', origin, mirrorDir(repo));
  return { repo, other, first, second, commit, dir: path.join(tmp, `preview-${n}`) };
}

const read = (dir: string) => fs.readFileSync(path.join(dir, 'app.txt'), 'utf8');

describe('checkoutPreview pinned to a commit', () => {
  it('checks the pinned commit out rather than the branch’s head, and the head when nothing is pinned', async () => {
    const w = await world(1);
    expect(await checkoutPreview(w.repo, w.dir, { branch: 'focus/wp', sha: w.first })).toBe(w.first);
    expect(read(w.dir)).toBe('first');
    expect(await checkoutPreview(w.repo, w.dir, { branch: 'focus/wp' })).toBe(w.second);
    expect(read(w.dir)).toBe('second');
  });

  it('fetches a pinned commit its branch no longer reaches, as after a restack, and says so when it’s gone altogether', async () => {
    const w = await world(2);
    // the branch is rewritten before Ops' clone ever fetched `second`
    await git(w.other, 'reset', '-q', '--hard', w.first);
    await w.commit('rewritten');
    await git(w.other, 'push', '-q', '--force', 'origin', 'focus/wp');
    fs.rmSync(mirrorDir(w.repo), { recursive: true, force: true });
    await git(tmp, 'clone', '-q', '--no-local', path.join(tmp, 'origin-2.git'), mirrorDir(w.repo));
    await expect(git(mirrorDir(w.repo), 'cat-file', '-e', `${w.second}^{commit}`)).rejects.toThrow();
    expect(await checkoutPreview(w.repo, w.dir, { branch: 'focus/wp', sha: w.second })).toBe(w.second);
    expect(read(w.dir)).toBe('second');
    await expect(checkoutPreview(w.repo, w.dir, { branch: 'focus/wp', sha: 'f'.repeat(40) })).rejects.toThrow(/no longer has the commit fffffff: its branch was likely rewritten/);
  });
});
