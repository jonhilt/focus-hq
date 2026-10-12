import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { paths } from '../config';
import { checkoutPullRequest, cherryPick, freshBranch, head, removeFolder, unshippedCommits } from './workspace';

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
  const origin = fs.mkdtempSync(path.join(tmp, 'origin-'));
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

describe('removing a folder', () => {
  it('moves it aside for the sweep when it can’t be deleted, so its path is free again', async () => {
    const workspaces = path.join(tmp, 'workspaces');
    fs.mkdirSync(workspaces, { recursive: true });
    const was = paths.workspaces;
    paths.workspaces = workspaces;
    const dir = path.join(workspaces, 'qa_lead_p1_ab', 'acme__api-pr7');
    const stuck = path.join(dir, 'node_modules', '.vite');
    fs.mkdirSync(stuck, { recursive: true });
    fs.writeFileSync(path.join(stuck, 'deps.json'), '{}');
    // a folder whose entries can't be unlinked fails the delete, as one still being written to does
    fs.chmodSync(stuck, 0o555);
    try {
      await removeFolder(dir);
      expect(fs.existsSync(dir)).toBe(false);
      const aside = fs.readdirSync(workspaces).filter((n) => n.startsWith('trash_acme__api-pr7_'));
      expect(aside).toHaveLength(1);
      fs.chmodSync(path.join(workspaces, aside[0], 'node_modules', '.vite'), 0o755);
    } finally {
      paths.workspaces = was;
    }
  });

  it('deletes it when nothing holds it, and is fine when it’s already gone', async () => {
    const dir = path.join(tmp, 'gone-soon');
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    await removeFolder(dir);
    expect(fs.existsSync(dir)).toBe(false);
    await removeFolder(dir);
  });
});

describe('a reviewer’s checkout of a pull request', () => {
  it('goes in the folder it’s given, clearing a checkout left above it by an older layout', async () => {
    const was = { workspaces: paths.workspaces, mirrors: paths.mirrors };
    paths.workspaces = path.join(tmp, 'qa-workspaces');
    paths.mirrors = path.join(tmp, 'qa-mirrors');
    try {
      // an origin with pull request 7, and the office's clone of it
      const origin = path.join(tmp, 'qa-origin.git');
      git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
      const dev = path.join(tmp, 'qa-dev');
      git(tmp, 'clone', '-q', origin, dev);
      git(dev, 'config', 'user.email', 'dev@focus.test');
      git(dev, 'config', 'user.name', 'Dev');
      git(dev, 'checkout', '-qb', 'main');
      commit(dev, 'readme.md', 'hello');
      git(dev, 'push', '-q', 'origin', 'main');
      const pr = commit(dev, 'api.ts', 'the change');
      git(dev, 'push', '-q', 'origin', 'HEAD:refs/pull/7/head');
      git(tmp, 'clone', '-q', origin, path.join(paths.mirrors, 'acme__api'));

      // the reviewer's folder for PR 7 was itself a checkout, in the layout before repos had folders of their own
      const old = path.join(paths.workspaces, 'qa_lead_p1_ab', 'acme__api-pr7');
      fs.mkdirSync(old, { recursive: true });
      git(old, 'init', '-q');
      fs.writeFileSync(path.join(old, 'leftover.txt'), 'old');

      expect(await checkoutPullRequest('acme/api', 'qa_lead_p1_ab/acme__api-pr7/api', 7)).toBe(pr);
      const dir = path.join(old, 'api');
      expect(await head(dir)).toBe(pr);
      expect(fs.readFileSync(path.join(dir, 'api.ts'), 'utf8')).toBe('the change');
      expect(fs.existsSync(path.join(old, '.git'))).toBe(false);
      expect(fs.existsSync(path.join(old, 'leftover.txt'))).toBe(false);

      // a re-test reuses the checkout
      expect(await checkoutPullRequest('acme/api', 'qa_lead_p1_ab/acme__api-pr7/api', 7)).toBe(pr);
    } finally {
      Object.assign(paths, was);
    }
  });
});
