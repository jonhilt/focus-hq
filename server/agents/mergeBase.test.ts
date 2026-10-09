import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The office's own merges work in data/repos and data/merges, so this file gets a data folder of its own (set before the
// workspace module reads the config).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-merge-'));
process.env.FOCUS_DATA_DIR = path.join(tmp, 'data');
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let ws: typeof import('./workspace');
beforeAll(async () => {
  ws = await import('./workspace');
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function commit(dir: string, file: string, text: string): string {
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, 'add', file);
  git(dir, 'commit', '-qm', `${file}: ${text}`);
  return git(dir, 'rev-parse', 'HEAD');
}

/**
 * An origin with a PR branch, a developer's clone of it, and the office's mirror (as if it had already cloned). `files`
 * go on main before the branch starts, and `changes` on the branch.
 */
function pullRequest(repo: string, files: Record<string, string> = {}, changes: Record<string, string> = {}) {
  const origin = path.join(tmp, `${repo.replace('/', '__')}.git`);
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  const dev = path.join(tmp, `${repo.replace('/', '__')}-dev`);
  git(tmp, 'clone', '-q', origin, dev);
  git(dev, 'config', 'user.email', 'dev@focus.test');
  git(dev, 'config', 'user.name', 'Dev');
  git(dev, 'checkout', '-qb', 'main');
  commit(dev, 'readme.md', 'hello');
  commit(dev, 'header.ts', 'header');
  for (const [file, text] of Object.entries(files)) commit(dev, file, text);
  git(dev, 'push', '-q', 'origin', 'main');
  git(dev, 'checkout', '-qb', 'focus/pr');
  for (const [file, text] of Object.entries(changes)) commit(dev, file, text);
  const pr = commit(dev, 'header.ts', 'header with saved items');
  git(dev, 'push', '-q', '-u', 'origin', 'focus/pr');
  const mirror = path.join(process.env.FOCUS_DATA_DIR!, 'repos', repo.replace('/', '__'));
  git(tmp, 'clone', '-q', origin, mirror);
  git(mirror, 'config', 'user.email', 'office@focus.test');
  git(mirror, 'config', 'user.name', 'Office');
  /** Someone lands `text` in `file` on main. */
  const land = (file: string, text: string) => {
    git(dev, 'checkout', '-q', 'main');
    commit(dev, file, text);
    git(dev, 'push', '-q', 'origin', 'main');
    git(dev, 'checkout', '-q', 'focus/pr');
  };
  const remoteHead = () => git(origin, 'rev-parse', 'focus/pr');
  /** `file` as it is on origin's PR branch. */
  const remoteFile = (file: string) => git(origin, 'show', `focus/pr:${file}`);
  return { dev, pr, land, remoteHead, remoteFile };
}

describe('the office’s own merge of a PR’s base branch', () => {
  it('pushes the merge when git needs no help, and the developer’s checkout is then behind', async () => {
    const { dev, pr, land, remoteHead } = pullRequest('acme/clean');
    land('footer.ts', 'footer');
    const merge = await ws.mergeBase('acme/clean', 'focus/pr', 'main');
    expect(merge).toEqual({ kind: 'merged', sha: remoteHead(), from: pr });
    expect(git(path.join(tmp, 'acme__clean.git'), 'log', '-1', '--format=%s', 'focus/pr')).toBe('Merge main into focus/pr');
    expect(await ws.missingRemoteCommits(dev, 'focus/pr')).toBe(true);
    git(dev, 'pull', '-q', '--no-rebase', 'origin', 'focus/pr');
    expect(await ws.missingRemoteCommits(dev, 'focus/pr')).toBe(false);
    // the scratch worktree is gone
    expect(fs.readdirSync(path.join(process.env.FOCUS_DATA_DIR!, 'merges'))).toEqual([]);
  });

  it('leaves the branch alone when the merge conflicts', async () => {
    const { pr, land, remoteHead } = pullRequest('acme/conflict');
    land('header.ts', 'header with a cart');
    expect(await ws.mergeBase('acme/conflict', 'focus/pr', 'main')).toEqual({ kind: 'conflicts', files: ['header.ts'] });
    expect(remoteHead()).toBe(pr);
  });

  const ruled = {
    '.gitattributes': 'notes.md focus-merge=union\ndeck.glb focus-merge=theirs\n',
    'notes.md': '# Notes\n- first\n',
    'deck.glb': 'deck, baked',
  };
  const branchSide = { 'notes.md': '# Notes\n- first\n- from the PR\n', 'deck.glb': 'deck, baked on the PR' };

  it('settles conflicts confined to union and generated files by the repo’s rules, and pushes the merge', async () => {
    const { pr, land, remoteHead, remoteFile } = pullRequest('acme/ruled', ruled, branchSide);
    land('notes.md', '# Notes\n- first\n- from main\n');
    land('deck.glb', 'deck, baked on main');
    const merge = await ws.mergeBase('acme/ruled', 'focus/pr', 'main');
    expect(merge).toEqual({ kind: 'merged', sha: remoteHead(), from: pr, auto: ['deck.glb', 'notes.md'] });
    expect(remoteFile('notes.md')).toBe('# Notes\n- first\n- from the PR\n- from main');
    expect(remoteFile('deck.glb')).toBe('deck, baked on main');
    expect(remoteFile('header.ts')).toBe('header with saved items');
  });

  it('leaves it all to an agent when anything else conflicts too', async () => {
    const { pr, land, remoteHead } = pullRequest('acme/ruled-and-not', ruled, branchSide);
    land('deck.glb', 'deck, baked on main');
    land('header.ts', 'header with a cart');
    expect(await ws.mergeBase('acme/ruled-and-not', 'focus/pr', 'main')).toEqual({ kind: 'conflicts', files: ['deck.glb', 'header.ts'] });
    expect(remoteHead()).toBe(pr);
  });

  it('pushes nothing when a merge git makes by itself fails the typecheck', async () => {
    // the PR's typecheck fails once main's footer is in
    const typecheck = `node -e "process.exit(require('fs').existsSync('footer.ts') ? 1 : 0)"`;
    const { pr, land, remoteHead } = pullRequest('acme/broken', {}, { 'package.json': JSON.stringify({ name: 'broken', private: true, scripts: { typecheck } }) });
    land('footer.ts', 'footer');
    expect(await ws.mergeBase('acme/broken', 'focus/pr', 'main')).toEqual({ kind: 'conflicts', files: [], broke: 'npm run typecheck' });
    expect(remoteHead()).toBe(pr);
  }, 60_000);

  it('says so when the branch already has everything from its base', async () => {
    const { pr, remoteHead } = pullRequest('acme/current');
    expect(await ws.mergeBase('acme/current', 'focus/pr', 'main')).toEqual({ kind: 'up-to-date' });
    expect(remoteHead()).toBe(pr);
  });

  it('finds nothing missing from a branch origin hasn’t got', async () => {
    const { dev } = pullRequest('acme/new');
    git(dev, 'checkout', '-qb', 'focus/unpublished');
    expect(await ws.missingRemoteCommits(dev, 'focus/unpublished')).toBe(false);
  });
});

describe('what came onto a PR since QA’s verdict', () => {
  /** Publishes the PR branch as GitHub does, at refs/pull/1/head. */
  const publish = (dev: string) => git(dev, 'push', '-q', 'origin', 'HEAD:refs/heads/focus/pr', 'HEAD:refs/pull/1/head');

  it('finds a clean merge of main, with the PR’s own changes unchanged', async () => {
    const { dev, pr, land } = pullRequest('acme/since-merge');
    land('footer.ts', 'footer');
    git(dev, 'merge', '-q', '--no-edit', 'origin/main');
    publish(dev);
    const since = await ws.sinceVerdict('acme/since-merge', 1, 'main', pr);
    expect(since).toMatchObject({ head: git(dev, 'rev-parse', 'HEAD'), descends: true, sameChanges: true, commits: [{ mergesBase: true, clean: true }] });
  }, 20_000);

  it('finds a change of the PR’s own, and a merge that slipped something else in', async () => {
    const { dev, pr, land } = pullRequest('acme/since-change');
    land('footer.ts', 'footer');
    git(dev, 'merge', '-q', '--no-commit', 'origin/main');
    fs.writeFileSync(path.join(dev, 'header.ts'), 'header, edited in the merge');
    git(dev, 'commit', '-qam', 'Merge main');
    publish(dev);
    const since = await ws.sinceVerdict('acme/since-change', 1, 'main', pr);
    expect(since?.commits).toEqual([expect.objectContaining({ mergesBase: true, clean: false })]);
    commit(dev, 'header.ts', 'header, changed again');
    publish(dev);
    const later = await ws.sinceVerdict('acme/since-change', 1, 'main', pr);
    expect(later?.commits.map((c) => c.mergesBase)).toEqual([true, false]);
  }, 20_000);
});
