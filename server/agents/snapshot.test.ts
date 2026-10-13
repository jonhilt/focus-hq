import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// a data folder of its own, set before the workspace module reads the config
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-snapshot-'));
process.env.FOCUS_DATA_DIR = path.join(tmp, 'data');
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
// each test runs a few dozen git commands: a couple of seconds alone, but well past vitest's 5 s on a busy machine
vi.setConfig({ testTimeout: 30_000 });

let ws: typeof import('./workspace');
beforeAll(async () => {
  ws = await import('./workspace');
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function commit(dir: string, file: string, text: string): void {
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, 'add', file);
  git(dir, 'commit', '-qm', `${file}: ${text}`);
}

/** An origin with a main branch, and a lead's checkout of it on the goal's branch, which origin hasn't got yet. */
function goal(name: string) {
  const origin = path.join(tmp, `${name}.git`);
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  const dir = path.join(tmp, name);
  git(tmp, 'clone', '-q', origin, dir);
  git(dir, 'config', 'user.email', 'lead@focus.test');
  git(dir, 'config', 'user.name', 'Lead');
  git(dir, 'checkout', '-qb', 'main');
  commit(dir, 'readme.md', 'hello');
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'checkout', '-qb', 'focus/goal');
  return dir;
}

describe('a closing goal’s checkout', () => {
  it('keeps uncommitted work, untracked files too, as a WIP commit on the branch', async () => {
    const dir = goal('wip');
    expect(await ws.snapshot(dir, 'WIP: nothing')).toBe(false);
    fs.writeFileSync(path.join(dir, 'readme.md'), 'hello, saved items');
    fs.writeFileSync(path.join(dir, 'saved.ts'), 'export const saved = [];');
    // a commit hook that would refuse it doesn't get a say
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    expect(await ws.snapshot(dir, 'WIP: closing')).toBe(true);
    expect(await ws.hasUncommittedChanges(dir)).toBe(false);
    expect(git(dir, 'log', '-1', '--format=%s', 'focus/goal')).toBe('WIP: closing');
    expect(git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['readme.md', 'saved.ts']);
    // a checkout that's gone has nothing left to keep, and mustn't hold the goal open
    expect(await ws.snapshot(path.join(tmp, 'gone'), 'WIP: closing')).toBe(false);
  });

  it('counts the commits GitHub hasn’t got, from the base branch until the branch is pushed', async () => {
    const dir = goal('pushed');
    expect(await ws.branchState(dir, 'focus/goal', 'main')).toEqual({ onOrigin: false, unpushed: 0 });
    commit(dir, 'saved.ts', 'one');
    commit(dir, 'saved.ts', 'two');
    expect(await ws.branchState(dir, 'focus/goal', 'main')).toEqual({ onOrigin: false, unpushed: 2 });
    git(dir, 'push', '-q', 'origin', 'focus/goal');
    expect(await ws.branchState(dir, 'focus/goal', 'main')).toEqual({ onOrigin: true, unpushed: 0 });
    commit(dir, 'saved.ts', 'three');
    expect(await ws.branchState(dir, 'focus/goal', 'main')).toEqual({ onOrigin: true, unpushed: 1 });
  });
});

/** An origin, the office's clone of it, and a lead's worktree of the clone on the goal's branch, as the office sets them up. */
async function office(repo: string) {
  const origin = path.join(tmp, `${repo.replace('/', '__')}.git`);
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  const seed = path.join(tmp, `${repo.replace('/', '__')}-seed`);
  git(tmp, 'clone', '-q', origin, seed);
  git(seed, 'checkout', '-qb', 'main');
  git(seed, 'config', 'user.email', 'dev@focus.test');
  git(seed, 'config', 'user.name', 'Dev');
  commit(seed, 'readme.md', 'hello');
  git(seed, 'push', '-q', 'origin', 'main');
  const mirror = path.join(process.env.FOCUS_DATA_DIR!, 'repos', repo.replace('/', '__'));
  git(tmp, 'clone', '-q', origin, mirror);
  git(mirror, 'config', 'user.email', 'office@focus.test');
  git(mirror, 'config', 'user.name', 'Office');
  const id = `lead_p1_${repo.split('/')[1]}/web`;
  const dir = await ws.createWorktree(repo, id, 'focus/goal', 'main', () => false);
  return { origin, seed, mirror, id, dir };
}

describe('a reopened goal’s checkout', () => {
  it('is its branch as it was left, WIP snapshot and all', async () => {
    const { id, dir } = await office('acme/reopen');
    commit(dir, 'saved.ts', 'one');
    fs.writeFileSync(path.join(dir, 'saved.ts'), 'two, uncommitted');
    expect(await ws.snapshot(dir, 'WIP: closing')).toBe(true);
    const tip = git(dir, 'rev-parse', 'HEAD');
    await ws.removeWorktree('acme/reopen', id);
    expect(fs.existsSync(dir)).toBe(false);

    expect(await ws.reopenWorktree('acme/reopen', id, 'focus/goal', () => false)).toBe(dir);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(tip);
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('focus/goal');
    expect(fs.readFileSync(path.join(dir, 'saved.ts'), 'utf8')).toBe('two, uncommitted');
  });

  it('takes what GitHub has when the office’s branch is behind it, or gone', async () => {
    const { origin, seed, id, dir } = await office('acme/behind');
    commit(dir, 'saved.ts', 'one');
    git(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/focus/goal');
    await ws.removeWorktree('acme/behind', id);
    // the office merged main into the pull request's branch on GitHub while the goal was closed
    git(seed, 'fetch', '-q', 'origin');
    git(seed, 'checkout', '-qb', 'focus/goal', 'origin/focus/goal');
    commit(seed, 'merge.ts', 'merged');
    git(seed, 'push', '-q', 'origin', 'focus/goal');
    await ws.reopenWorktree('acme/behind', id, 'focus/goal', () => false);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(git(origin, 'rev-parse', 'focus/goal'));

    // the office's clone lost its branch: GitHub's is checked out
    await ws.removeWorktree('acme/behind', id);
    git(path.join(process.env.FOCUS_DATA_DIR!, 'repos', 'acme__behind'), 'branch', '-D', 'focus/goal');
    await ws.reopenWorktree('acme/behind', id, 'focus/goal', () => false);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(git(origin, 'rev-parse', 'focus/goal'));
  });

  it('fails when neither the office nor GitHub has the branch', async () => {
    const { id } = await office('acme/gone');
    await ws.removeWorktree('acme/gone', id);
    git(path.join(process.env.FOCUS_DATA_DIR!, 'repos', 'acme__gone'), 'branch', '-D', 'focus/goal');
    await expect(ws.reopenWorktree('acme/gone', id, 'focus/goal', () => false)).rejects.toThrow(/focus\/goal is gone/);
  });
});
