import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, vi } from 'vitest';
import { demoWorkspace } from './demoRunner';
import { liveWorkspace, mirrorDir } from './workspace';
import { holdsToWorkspaceContract, type World } from './workspaceContract';

// The workspace contract (docs/contracts.md), held against git itself and against the demo's stand-in for it.

vi.setConfig({ testTimeout: 30_000 });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-contract-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
// Ops' own git commands (through run()) commit as someone, whatever the machine's git config says
Object.assign(process.env, { GIT_AUTHOR_NAME: 'Agent', GIT_AUTHOR_EMAIL: 'agent@focus.test', GIT_COMMITTER_NAME: 'Agent', GIT_COMMITTER_EMAIL: 'agent@focus.test', GIT_CONFIG_NOSYSTEM: '1' });

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, encoding: 'utf8' })).stdout.trim();
const tryGit = (cwd: string, ...args: string[]) => git(cwd, ...args).then((out) => out || undefined, () => undefined);
const put = (dir: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const commitAll = async (dir: string, message: string) => {
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-qm', message);
};

/** An origin with one commit on main, made once and copied for each world. */
const template = (async () => {
  const origin = path.join(tmp, 'template.git');
  await git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  const seed = path.join(tmp, 'template-seed');
  await git(tmp, 'clone', '-q', origin, seed);
  await git(seed, 'checkout', '-qb', 'main');
  put(seed, 'readme.md', 'hello');
  await commitAll(seed, 'start');
  await git(seed, 'push', '-q', 'origin', 'main');
  return origin;
})();

/**
 * Git on throwaway repos: a bare origin (GitHub), Ops' clone of it where `gh repo clone` would have put it (main
 * checked out), and a teammate's clone that lands changes on main and pushes to branches as others would.
 */
async function gitWorld(n: number): Promise<World> {
  const repo = `contract/r${n}`;
  const origin = path.join(tmp, `origin-${n}.git`);
  fs.cpSync(await template, origin, { recursive: true });
  const other = path.join(tmp, `other-${n}`);
  await Promise.all([git(tmp, 'clone', '-q', origin, other), git(tmp, 'clone', '-q', origin, mirrorDir(repo))]);
  const elsewhere = async (branch: string, file: string, text: string) => {
    await git(other, 'fetch', '-q', '--prune', 'origin');
    const from = (await tryGit(other, 'rev-parse', '--verify', '-q', `origin/${branch}`)) ? `origin/${branch}` : 'origin/main';
    await git(other, 'checkout', '-q', '-B', branch, from);
    put(other, file, text);
    await commitAll(other, `${file}: ${text}`);
    await git(other, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  };
  return {
    ops: liveWorkspace,
    repo,
    checkout: (agent, branch) => liveWorkspace.create(repo, `contract-${n}-${agent}`, branch, 'main', () => false),
    commit: async (dir, file, text) => {
      put(dir, file, text);
      await commitAll(dir, `${file}: ${text}`);
    },
    write: async (dir, file, text) => put(dir, file, text),
    read: async (dir, file) => (fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8') : undefined),
    land: (file, text) => elsewhere('main', file, text),
    pushElsewhere: elsewhere,
    deleteOnOrigin: async (branch) => void (await git(origin, 'branch', '-q', '-D', branch)),
    originHead: (branch) => tryGit(origin, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`),
    localRef: (dir, ref) => tryGit(dir, 'rev-parse', '--verify', '-q', ref),
  };
}

holdsToWorkspaceContract('git', gitWorld);

/**
 * The demo ship's workspace, as fakeFocus's tests use it: demo agents never touch git, so there's no checkout, and
 * nothing anyone does to one (or to GitHub's branches) shows in what it answers.
 */
const demoWorld = (n: number): World => ({
  ops: demoWorkspace,
  repo: `demo/r${n}`,
  checkout: (agent, branch) => demoWorkspace.create(`demo/r${n}`, `contract-${n}-${agent}`, branch, 'main', () => false),
  commit: async () => undefined,
  write: async () => undefined,
  read: async () => undefined,
  land: async () => undefined,
  pushElsewhere: async () => undefined,
  deleteOnOrigin: async () => undefined,
  originHead: async () => undefined,
  localRef: async () => undefined,
});

const NO_DISK = 'no checkout on disk: what an agent does in one never shows';
const NO_ORIGIN = 'no origin: nothing pushed or pulled is kept';
holdsToWorkspaceContract('the demo workspace', demoWorld, {
  'a new checkout starts at origin’s base: nothing ahead or uncommitted': 'every checkout is 2 commits ahead, so every agent has something to ship',
  'HEAD stays put until a commit, which moves it': 'every read of HEAD is a new commit, standing for a session that just committed',
  'an untracked file is an uncommitted change, and a snapshot commits it': NO_DISK,
  'a branch never pushed isn’t on origin and counts its commits from the base; once pushed, nothing is unpushed': 'every branch is on origin with nothing unpushed',
  'the base moving on origin is never counted as the branch’s own work': NO_DISK,
  'the local base follows origin’s, so an agent’s own diff against main is only their commits': NO_DISK,
  'a push still lands after GitHub deleted the branch its last push went to': NO_ORIGIN,
  'someone else’s commits on origin’s branch are noticed, and a pull brings them in': 'nobody else ever pushes to a branch',
  'merging the base: up to date when it hasn’t moved, merged and pushed when it has': 'Ops’ merge always conflicts, so there’s an agent to watch resolving it',
  'merging the base reports the files that conflict, and pushes nothing': 'Ops’ merge always conflicts in src/header.ts, whatever changed',
  'restacking a waypoint after the one below was squash-merged replays only its own commits: no conflict, then up to date': 'Ops’ restack always goes through, to a made-up commit',
  'restacking onto a change that clashes with the waypoint’s own reports the files, and pushes nothing': 'Ops’ restack always goes through, whatever changed',
});
