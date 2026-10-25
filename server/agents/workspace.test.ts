import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { paths } from '../config';
import { checkoutPullRequest, createWorktree, head, installDependencies, removeFolder, reopenWorktree, removeWorktree } from './workspace';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-workspace-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
// each test runs a few dozen git commands: a couple of seconds alone, but well past vitest's 5 s on a busy machine
vi.setConfig({ testTimeout: 30_000 });

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function commit(dir: string, file: string, text: string): string {
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, 'add', file);
  git(dir, 'commit', '-qm', `${file}: ${text}`);
  return git(dir, 'rev-parse', 'HEAD');
}


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
      // an origin with pull request 7, and Ops' clone of it
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

describe('the local base branch', () => {
  it('follows origin’s, so a diff against main in a worktree shows only the branch’s own commits', async () => {
    const was = { workspaces: paths.workspaces, mirrors: paths.mirrors };
    paths.workspaces = path.join(tmp, 'base-workspaces');
    paths.mirrors = path.join(tmp, 'base-mirrors');
    try {
      // an origin, and Ops' clone of it, whose own checkout has main, as `gh repo clone` leaves it
      const origin = path.join(tmp, 'base-origin.git');
      git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
      const dev = path.join(tmp, 'base-dev');
      git(tmp, 'clone', '-q', origin, dev);
      git(dev, 'config', 'user.email', 'dev@focus.test');
      git(dev, 'config', 'user.name', 'Dev');
      git(dev, 'checkout', '-qb', 'main');
      commit(dev, 'readme.md', 'hello');
      git(dev, 'push', '-q', 'origin', 'main');
      const mirror = path.join(paths.mirrors, 'acme__base');
      git(tmp, 'clone', '-q', origin, mirror);
      let merges = 0;
      const merged = () => {
        const sha = commit(dev, 'readme.md', `merge ${++merges}`);
        git(dev, 'push', '-q', 'origin', 'main');
        return sha;
      };

      // main moved on GitHub since Ops cloned it
      let tip = merged();
      const dir = await createWorktree('acme/base', 'agent_base', 'focus/base', 'main', () => false);
      expect(git(mirror, 'rev-parse', 'refs/heads/main')).toBe(tip);
      git(dir, 'config', 'user.email', 'agent@focus.test');
      git(dir, 'config', 'user.name', 'Agent');
      const own = commit(dir, 'mine.ts', 'mine');
      expect(git(dir, 'rev-list', 'main..HEAD')).toBe(own);
      expect(git(dir, 'diff', '--name-only', 'main...HEAD')).toBe('mine.ts');

      // a goal reopened, and QA seated on a pull request, see main as GitHub has it
      const branch = git(dir, 'branch', '--show-current');
      await removeWorktree('acme/base', 'agent_base');
      tip = merged();
      await reopenWorktree('acme/base', 'agent_base', branch, () => false);
      expect(git(mirror, 'rev-parse', 'main')).toBe(tip);
      tip = merged();
      git(dev, 'push', '-q', 'origin', 'HEAD:refs/pull/9/head');
      await checkoutPullRequest('acme/base', 'qa_base/acme__base-pr9/base', 9);
      expect(git(mirror, 'rev-parse', 'main')).toBe(tip);

      // main checked out in someone's worktree stays as it is, rather than moving under them
      const holder = path.join(paths.workspaces, 'holder');
      git(mirror, 'worktree', 'add', '-q', holder, 'main');
      merged();
      git(dev, 'push', '-q', 'origin', 'HEAD:refs/pull/10/head');
      await checkoutPullRequest('acme/base', 'qa_base/acme__base-pr10/base', 10);
      expect(git(holder, 'rev-parse', 'HEAD')).toBe(tip);
      expect(git(holder, 'status', '--porcelain')).toBe('');
    } finally {
      Object.assign(paths, was);
    }
  });
});

describe('installing a checkout’s dependencies', () => {
  /** A checkout with a pnpm project at its root and an npm one in e2e/, and an exec that records what it ran. */
  function checkout() {
    const dir = fs.mkdtempSync(path.join(tmp, 'deps-'));
    const write = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), text);
    };
    write('package.json', '{"name":"app"}');
    write('pnpm-lock.yaml', 'lockfileVersion: 9');
    write('e2e/package.json', '{"name":"e2e"}');
    write('e2e/package-lock.json', '{"lockfileVersion":3}');
    // a package.json with no lockfile of its own (a workspace package) is the root install's
    write('docs/package.json', '{"name":"docs"}');
    const ran: string[] = [];
    const exec = async (cmd: string, args: string[], opts: { cwd?: string } = {}) => {
      ran.push(`${path.relative(dir, opts.cwd ?? dir) || '.'}: ${[cmd, ...args].join(' ')}`);
      return '';
    };
    return { dir, write, ran, exec };
  }

  it('installs the root and each folder with a lockfile of its own, then skips them until a lockfile changes', async () => {
    const { dir, write, ran, exec } = checkout();
    expect(await installDependencies(dir, exec)).toBeUndefined();
    expect(ran.splice(0)).toEqual(['.: pnpm install --frozen-lockfile', 'e2e: npm ci --no-audit --no-fund']);

    expect(await installDependencies(dir, exec)).toBeUndefined();
    expect(ran).toEqual([]);

    write('e2e/package-lock.json', '{"lockfileVersion":3,"packages":{}}');
    await installDependencies(dir, exec);
    expect(ran.splice(0)).toEqual(['e2e: npm ci --no-audit --no-fund']);

    // node_modules gone (a fresh worktree of the same commit, or cleared by hand): installs again
    fs.rmSync(path.join(dir, 'node_modules'), { recursive: true });
    await installDependencies(dir, exec);
    expect(ran).toEqual(['.: pnpm install --frozen-lockfile']);
  });

  it('tells the agent what failed, and tries again next time', async () => {
    const { dir, ran, exec } = checkout();
    const failing = async (cmd: string, args: string[], opts: { cwd?: string } = {}) => {
      if (cmd === 'pnpm') throw new Error('spawn pnpm ENOENT');
      return exec(cmd, args, opts);
    };
    const note = await installDependencies(dir, failing);
    expect(note).toContain(`${dir}: \`pnpm install --frozen-lockfile\` failed: pnpm isn't on the PATH: run \`corepack enable\``);
    expect(note).not.toContain('e2e');
    ran.length = 0;
    await installDependencies(dir, exec);
    expect(ran).toEqual(['.: pnpm install --frozen-lockfile']);
  });

  it('leaves a project with no lockfile alone, rather than write one into the checkout', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'deps-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    const ran: string[] = [];
    const exec = async (cmd: string) => {
      ran.push(cmd);
      return '';
    };
    expect(await installDependencies(dir, exec)).toBeUndefined();
    expect(ran).toEqual([]);
  });
});
