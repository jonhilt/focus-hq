import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cherryPick, freshBranch, head, unshippedCommits } from './workspace';

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

  it('moves a repo whose pull request was squash-merged onto a fresh branch that carries only what never shipped', async () => {
    const { lead, shipped, next } = sliceThatCarriedOn();
    // the shipped commit lands on main squashed, as a commit of its own, pushed from somewhere else
    const elsewhere = `${lead}-elsewhere`;
    git(tmp, 'clone', '-q', '-b', 'main', lead.replace(/-lead$/, ''), elsewhere);
    git(elsewhere, 'config', 'user.email', 'gh@focus.test');
    git(elsewhere, 'config', 'user.name', 'GitHub');
    const squashed = commit(elsewhere, 'saved.ts', 'save');
    git(elsewhere, 'push', '-q', 'origin', 'main');

    const unshipped = await unshippedCommits(lead, 'main', shipped);
    await freshBranch(lead, 'focus/slice-1-b', 'main');
    await cherryPick(lead, unshipped);
    expect(git(lead, 'branch', '--show-current')).toBe('focus/slice-1-b');
    // on the squash, with the unshipped commit and none of the shipped one's
    expect(git(lead, 'rev-list', '--count', 'origin/main..HEAD')).toBe('1');
    expect(git(lead, 'rev-parse', 'HEAD~1')).toBe(squashed);
    expect(() => git(lead, 'merge-base', '--is-ancestor', shipped, 'HEAD')).toThrow();
    expect(fs.readFileSync(path.join(lead, 'saved.ts'), 'utf8')).toBe('save and list');
    // the old branch keeps its commits
    expect(git(lead, 'rev-parse', 'focus/slice-1')).toBe(next);
  });
});
