import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cherryPick, head, unshippedCommits } from './workspace';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-workspace-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function commit(dir: string, file: string, text: string): string {
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, 'add', file);
  git(dir, 'commit', '-qm', `${file}: ${text}`);
  return git(dir, 'rev-parse', 'HEAD');
}

/** An origin, and a clone of it whose slice branch shipped one commit and carried on with another. */
function sliceThatCarriedOn() {
  const origin = path.join(tmp, `origin-${Math.random().toString(36).slice(2)}`);
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  const lead = `${origin}-lead`;
  git(tmp, 'clone', '-q', origin, lead);
  git(lead, 'config', 'user.email', 'lead@focus.test');
  git(lead, 'config', 'user.name', 'Lead');
  git(lead, 'checkout', '-qb', 'main');
  commit(lead, 'readme.md', 'hello');
  git(lead, 'push', '-q', 'origin', 'main');
  git(lead, 'checkout', '-qb', 'focus/slice-1');
  const shipped = commit(lead, 'saved.ts', 'save');
  const next = commit(lead, 'saved.ts', 'save and list');
  return { lead, shipped, next };
}

describe('the lead’s workspace', () => {
  it('finds the commits that never shipped', async () => {
    const { lead, shipped, next } = sliceThatCarriedOn();
    expect(await unshippedCommits(lead, 'main', shipped)).toEqual([next]);
    // nothing shipped from this repo: everything since the base branch
    expect(await unshippedCommits(lead, 'main')).toEqual([shipped, next]);
    expect(await unshippedCommits(lead, 'main', '0123456789abcdef0123456789abcdef01234567')).toEqual([shipped, next]);
  });

  it('brings them onto fresh code, or leaves the new branch as it was when they don’t apply', async () => {
    const { lead, next } = sliceThatCarriedOn();
    const fresh = `${lead}-slice-2`;
    git(lead, 'worktree', 'add', '-q', '-b', 'focus/slice-2', fresh, 'origin/main');
    const before = await head(fresh);
    // the first commit hasn't landed, so the one after it can't apply
    await expect(cherryPick(fresh, [next])).rejects.toThrow();
    expect(await head(fresh)).toBe(before);
    expect(git(fresh, 'status', '--porcelain')).toBe('');

    // the slice landed (squashed into one commit on main): now it does
    git(lead, 'checkout', '-q', 'main');
    commit(lead, 'saved.ts', 'save');
    git(lead, 'push', '-q', 'origin', 'main');
    git(fresh, 'reset', '-q', '--hard', 'main');
    await cherryPick(fresh, [next]);
    expect(fs.readFileSync(path.join(fresh, 'saved.ts'), 'utf8')).toBe('save and list');
  });
});
