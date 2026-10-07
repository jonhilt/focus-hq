import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// a data folder of its own, set before the workspace module reads the config
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-snapshot-'));
process.env.FOCUS_DATA_DIR = path.join(tmp, 'data');
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

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
