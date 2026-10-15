import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config';
import { INSTALL_STAMP, installable, installCommand, installFailedNote, installStamp, lockfilesIn, missingPackageManager, packageManagerFor, packageManagerIn } from '../packageManager';
import { errorMessage, KeyedLock, run, sleep } from '../util';
import { sameCommit } from '../../shared/qa';
import { autoMergePlan, conflictStages, type MergeRule, mergeRules } from './conflicts';
import { checkCommands, rangeDiffUnchanged, type SinceVerdict } from './retest';
import type { BaseMerge, BranchState, ChecksRun } from './types';
import { claimBranch, heldMessage, orphanedWorkspaces, parseWorktrees, retryLockRace, trashName } from './worktrees';

const lock = new KeyedLock();
/** One run of the checks at a time in each repo's checks folder. */
const checksLock = new KeyedLock();

const git = (cwd: string, args: string[], timeoutMs?: number) => run('git', args, { cwd, timeoutMs });

function mirrorDir(repo: string): string {
  return path.join(paths.mirrors, repo.replace('/', '__'));
}

/** Clones the repository into data/repos the first time it's needed. Call inside the repo's lock. */
async function ensureMirror(repo: string): Promise<void> {
  const mirror = mirrorDir(repo);
  if (fs.existsSync(path.join(mirror, '.git'))) return;
  fs.mkdirSync(paths.mirrors, { recursive: true });
  await run('gh', ['repo', 'clone', repo, mirror], { timeoutMs: 15 * 60_000 });
}

/**
 * Brings the local `branch` (the base, `main`) up to origin's, just fetched, so `git diff main...HEAD` in an agent's
 * worktree shows only their own commits. The mirror's own checkout lets go of it first (`gh repo clone` leaves it there,
 * and git won't move a branch that's checked out). Only ever a fast-forward, and not while a worktree has the branch
 * checked out: then it stays where it is. Never fails. Call inside the repo's lock when `mirror` is given.
 */
export async function followOrigin(dir: string, branch: string, mirror?: string): Promise<void> {
  if (mirror && (await git(mirror, ['symbolic-ref', '-q', 'HEAD']).then((ref) => ref.trim() === `refs/heads/${branch}`, () => false))) {
    await git(mirror, ['checkout', '-q', '--detach']).catch(() => undefined);
  }
  await git(dir, ['fetch', '-q', '.', `refs/remotes/origin/${branch}:refs/heads/${branch}`]).catch(() => undefined);
}

/** The branch origin's HEAD points at (`main`), as the clone recorded it, if it did. */
function defaultBranch(mirror: string): Promise<string | undefined> {
  return git(mirror, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']).then(
    (ref) => ref.trim().replace(/^origin\//, '') || undefined,
    () => undefined,
  );
}

/** `followOrigin` for the default branch. */
async function followDefault(mirror: string): Promise<void> {
  const branch = await defaultBranch(mirror);
  if (branch) await followOrigin(mirror, branch, mirror);
}

/**
 * One clone per repository lives in data/repos; every agent gets its own git worktree of it in
 * data/workspaces/<agent id> so agents on the same repo never trip over each other. A worktree left behind by an agent
 * who isn't `inOffice` any more gives up its branch to the new one. `local` names the branch in the worktree, when it
 * can't be `branch` itself (checked out in someone else's).
 */
export async function createWorktree(
  repo: string,
  agentId: string,
  branch: string,
  startPoint: string,
  inOffice: (agentId: string) => boolean,
  local = branch,
): Promise<string> {
  const mirror = mirrorDir(repo);
  const dir = path.join(paths.workspaces, agentId);
  await lock.with(repo, async () => {
    await ensureMirror(repo);
    await retryLockRace(() => git(mirror, ['fetch', 'origin', '--prune'], 10 * 60_000), () => sleep(750));
    await followOrigin(mirror, startPoint, mirror);
    if (fs.existsSync(dir)) {
      // The last work of someone who keeps one record (a plugin's crew, like the climber), or a half-made worktree: start clean.
      await removeDir(mirror, dir);
    }
    await git(mirror, ['worktree', 'prune']);
    fs.mkdirSync(paths.workspaces, { recursive: true });
    const worktrees = parseWorktrees(await git(mirror, ['worktree', 'list', '--porcelain']));
    const claim = claimBranch(worktrees, local, fs.realpathSync(paths.workspaces), inOffice);
    if (claim.kind === 'held') throw new Error(heldMessage(local, claim));
    if (claim.kind === 'reclaim') {
      await removeDir(mirror, claim.path);
      await git(mirror, ['worktree', 'prune']);
    }
    // --no-track: the branch must not track origin/<base>, so a stray `git push` can never land on the base branch
    await git(mirror, ['worktree', 'add', '--no-track', '-B', local, dir, `origin/${startPoint}`]);
  });
  return dir;
}

/**
 * A worktree on `branch` as it was left (a closed goal's, with its WIP snapshot): the office's own branch if it still has
 * it, brought up to GitHub's when that's only ahead of it (the office pushed a merge), else GitHub's. Nothing is reset.
 * Fails when neither has the branch, or a colleague's workspace has it checked out.
 */
export async function reopenWorktree(repo: string, agentId: string, branch: string, inOffice: (agentId: string) => boolean): Promise<string> {
  const mirror = mirrorDir(repo);
  const dir = path.join(paths.workspaces, agentId);
  await lock.with(repo, async () => {
    await ensureMirror(repo);
    await retryLockRace(() => git(mirror, ['fetch', 'origin', '--prune'], 10 * 60_000), () => sleep(750));
    await followDefault(mirror);
    if (fs.existsSync(dir)) await removeDir(mirror, dir);
    await git(mirror, ['worktree', 'prune']);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const has = (ref: string) => git(mirror, ['rev-parse', '--verify', '--quiet', ref]).then(() => true, () => false);
    const local = await has(`refs/heads/${branch}`);
    const remote = await has(`refs/remotes/origin/${branch}`);
    if (!local && !remote) throw new Error(`${branch} is gone: neither the office’s clone of ${repo} nor GitHub has it`);
    const worktrees = parseWorktrees(await git(mirror, ['worktree', 'list', '--porcelain']));
    const claim = claimBranch(worktrees, branch, fs.realpathSync(paths.workspaces), inOffice);
    if (claim.kind === 'held') throw new Error(heldMessage(branch, claim));
    if (claim.kind === 'reclaim') {
      await removeDir(mirror, claim.path);
      await git(mirror, ['worktree', 'prune']);
    }
    if (!local) await git(mirror, ['branch', '--no-track', branch, `origin/${branch}`]);
    else if (remote && (await git(mirror, ['merge-base', '--is-ancestor', branch, `origin/${branch}`]).then(() => true, () => false))) {
      await git(mirror, ['branch', '-f', branch, `origin/${branch}`]);
    }
    await git(mirror, ['worktree', 'add', dir, branch]);
  });
  return dir;
}

async function removeDir(mirror: string, dir: string): Promise<void> {
  await git(mirror, ['worktree', 'remove', '--force', dir]).catch(() => removeFolder(dir));
}

/**
 * Deletes `dir`, retrying while something still writes into it (a dev server or an install a session left running makes
 * the delete fail with ENOTEMPTY or EBUSY). If it still won't go, it's renamed aside into data/workspaces, where the sweep
 * deletes it later, so the path is free either way. Only fails when it can't even be renamed.
 */
export async function removeFolder(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
  } catch (err) {
    const aside = path.join(paths.workspaces, trashName(dir, randomBytes(4).toString('hex')));
    await fs.promises.rename(dir, aside);
    console.warn(`Couldn't delete ${dir} (${errorMessage(err)}): moved it to ${aside} for the sweep`);
  }
}

/** Removes the agent's checkout (`agentId` may be a folder inside a workspace, like a reviewer's checkout of one PR). */
export async function removeWorktree(repo: string, agentId: string): Promise<void> {
  const dir = path.join(paths.workspaces, agentId);
  if (!fs.existsSync(dir)) return;
  const mirror = mirrorDir(repo);
  await lock.with(repo, async () => {
    // a reviewer's workspace holds a checkout per PR rather than being one, so git won't remove it: delete it, and prune
    await git(mirror, ['worktree', 'remove', '--force', dir]).catch(() => removeFolder(dir));
    await git(mirror, ['worktree', 'prune']).catch(() => undefined);
  });
}

/**
 * Deletes the folders in data/workspaces that no agent in the office or project owns (a removal that failed, or a
 * dismissal the server never got round to), then prunes every mirror so it stops listing them. A folder that can't be
 * deleted is logged and the sweep carries on.
 */
export async function sweepWorkspaces(agentIds: Iterable<string>, projectIds: Iterable<string>): Promise<void> {
  const folders = subfolders(paths.workspaces);
  for (const name of orphanedWorkspaces(folders, agentIds, projectIds)) {
    const dir = path.join(paths.workspaces, name);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      console.log(`Swept orphaned workspace ${dir}`);
    } catch (err) {
      console.error(`Couldn't sweep orphaned workspace ${dir}: ${errorMessage(err)}`);
    }
  }
  for (const name of subfolders(paths.mirrors)) {
    const repo = name.replace('__', '/');
    await lock.with(repo, () => git(mirrorDir(repo), ['worktree', 'prune'])).catch((err: unknown) => {
      console.error(`Couldn't prune worktrees of ${repo}: ${errorMessage(err)}`);
    });
  }
}

/** Real folders directly inside `dir` (symlinks aren't followed), or none if `dir` doesn't exist yet. */
function subfolders(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

/**
 * Checks a pull request's head (or a branch) out into a preview folder. Preview folders are reused from one preview to
 * the next, so installed dependencies and build output (ignored files) survive. Returns the commit checked out.
 */
export function checkoutPreview(repo: string, dir: string, ref: { pr: number } | { branch: string }): Promise<string> {
  // refs/pull/N/head exists for every PR, forks included
  const source = 'pr' in ref ? `refs/pull/${ref.pr}/head` : `refs/heads/${ref.branch}`;
  return checkoutDetached(repo, dir, source, 'refs/focus/preview');
}

/** The default branch's latest commit, detached in `dir`, for agents that only read the code (the planner). */
export function checkoutLatest(repo: string, dir: string): Promise<string> {
  return checkoutDetached(repo, dir, 'HEAD', 'refs/focus/latest');
}

/** Fetches `source` from origin into the mirror's `localRef` and checks it out, detached, in a reusable folder. */
function checkoutDetached(repo: string, dir: string, source: string, localRef: string): Promise<string> {
  const mirror = mirrorDir(repo);
  return lock.with(repo, async () => {
    await ensureMirror(repo);
    const base = await defaultBranch(mirror);
    await git(mirror, ['fetch', 'origin', `+${source}:${localRef}`, ...(base ? [`+refs/heads/${base}:refs/remotes/origin/${base}`] : [])], 10 * 60_000);
    if (base) await followOrigin(mirror, base, mirror);
    const sha = (await git(mirror, ['rev-parse', localRef])).trim();
    await detachAt(mirror, dir, sha);
    return sha;
  });
}

/** Checks `sha`, already in the mirror, out in a reusable folder, detached. Call inside the repo's lock. */
async function detachAt(mirror: string, dir: string, sha: string): Promise<void> {
  const reused =
    fs.existsSync(path.join(dir, '.git')) &&
    (await git(dir, ['checkout', '--detach', '--force', sha]).then(() => true, () => false));
  if (reused) {
    await git(dir, ['clean', '-fd']); // untracked files from last time; ignored ones (node_modules, bin/obj) stay
  } else {
    // first checkout here, or one broken by an earlier failure or a re-cloned mirror
    await removeFolder(dir);
    await git(mirror, ['worktree', 'prune']);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(mirror, ['worktree', 'add', '--detach', dir, sha]);
  }
}

/**
 * A reviewer's checkout of pull request `number`'s head, detached, in `id` (a folder in data/workspaces: `reviewRepoId`).
 * Returns the commit.
 */
export async function checkoutPullRequest(repo: string, id: string, number: number): Promise<string> {
  const dir = path.join(paths.workspaces, id);
  // a reviewer's folders from an older layout were checkouts themselves: they go, rather than nest checkouts in them
  for (let above = path.dirname(dir); above.startsWith(paths.workspaces + path.sep); above = path.dirname(above)) {
    if (fs.existsSync(path.join(above, '.git'))) await removeFolder(above);
  }
  return checkoutDetached(repo, dir, `refs/pull/${number}/head`, 'refs/focus/qa');
}

const isAncestor = (dir: string, a: string, b: string) => git(dir, ['merge-base', '--is-ancestor', a, b]).then(() => true, () => false);

/**
 * What came onto pull request `number` since QA's verdict on `sha`: each new commit not from the base branch, whether it's a merge of the base
 * branch whose tree is exactly what git merges by itself (no conflicts resolved, nothing else slipped in), and whether
 * `git range-diff` finds the PR's own commits unchanged. Null when the mirror doesn't have `sha`.
 */
export function sinceVerdict(repo: string, number: number, baseBranch: string, sha: string): Promise<SinceVerdict | null> {
  const mirror = mirrorDir(repo);
  const base = `refs/remotes/origin/${baseBranch}`;
  return lock.with(repo, async () => {
    await ensureMirror(repo);
    await retryLockRace(() => git(mirror, ['fetch', 'origin', `+refs/pull/${number}/head:refs/focus/since`, `+refs/heads/${baseBranch}:${base}`], 10 * 60_000), () => sleep(750));
    if (!(await git(mirror, ['cat-file', '-e', `${sha}^{commit}`]).then(() => true, () => false))) return null;
    const head = (await git(mirror, ['rev-parse', 'refs/focus/since'])).trim();
    if (!(await isAncestor(mirror, sha, head))) return { head, descends: false, commits: [], sameChanges: false };
    const commits: SinceVerdict['commits'] = [];
    for (const line of (await git(mirror, ['rev-list', '--reverse', '--parents', head, `^${sha}`, `^${base}`])).split('\n').filter((l) => l.trim())) {
      const [commit, ...parents] = line.trim().split(/\s+/);
      const mergesBase = parents.length === 2 && (await isAncestor(mirror, parents[1], base));
      let clean = false;
      if (mergesBase) {
        const merged = await git(mirror, ['merge-tree', '--write-tree', parents[0], parents[1]]).then((o) => o.split('\n')[0].trim(), () => '');
        clean = !!merged && merged === (await git(mirror, ['rev-parse', `${commit}^{tree}`])).trim();
      }
      commits.push({ sha: commit, mergesBase, clean });
    }
    const own = async (tip: string) => `${(await git(mirror, ['merge-base', base, tip])).trim()}..${tip}`;
    const diff = await git(mirror, ['range-diff', '--no-color', await own(sha), await own(head)]).catch(() => '');
    return { head, descends: true, commits, sameChanges: rangeDiffUnchanged(diff) };
  });
}

/**
 * Checks pull request `number` out in its repo's checks folder (reused, so installed dependencies survive) and runs the
 * project's checks there, stopping at the first that fails. Null when the project has none the office knows.
 */
export function runChecks(repo: string, number: number, head: string): Promise<ChecksRun | null> {
  const dir = path.join(paths.checks, repo.replace('/', '__'));
  return checksLock.with(repo, async () => {
    const sha = await checkoutDetached(repo, dir, `refs/pull/${number}/head`, 'refs/focus/checks');
    if (!sameCommit(sha, head)) return { sha, results: [{ command: 'git checkout', ok: false, output: `the PR moved on to ${sha.slice(0, 7)}` }] };
    const results = await installAndRun(dir, checkCommands(packageScripts(dir), packageManagerIn(dir)));
    return results && { sha, results };
  });
}

function packageScripts(dir: string): Record<string, unknown> | undefined {
  const pkg = path.join(dir, 'package.json');
  return fs.existsSync(pkg) ? (JSON.parse(fs.readFileSync(pkg, 'utf8')) as { scripts?: Record<string, unknown> }).scripts : undefined;
}

/**
 * Installs the project's dependencies in `dir`, from its lockfile with the package manager that wrote it, and runs
 * `commands`, stopping at the first that fails. Null when there are none.
 */
async function installAndRun(dir: string, commands: string[][]): Promise<ChecksRun['results'] | null> {
  if (!commands.length) return null;
  const lockfiles = lockfilesIn(dir);
  const install = installCommand(packageManagerFor(lockfiles), lockfiles);
  const results: ChecksRun['results'] = [];
  for (const [cmd, ...args] of [install, ...commands]) {
    const command = [cmd, ...args].join(' ');
    const ok = await run(cmd, args, { cwd: dir, timeoutMs: 20 * 60_000 }).then(() => true, (err: unknown) => {
      results.push({ command, ok: false, output: errorMessage(err) });
      return false;
    });
    if (!ok) break;
    results.push({ command, ok: true });
  }
  return results;
}

/**
 * Installs the dependencies in a checkout an agent is about to work in, from the lockfile, in `dir` and in each folder
 * directly inside it with a lockfile of its own (`e2e/`), so the agent's first typecheck or test doesn't fail on missing
 * packages. A folder whose package.json and lockfile haven't changed since its last install (`INSTALL_STAMP`) is skipped.
 * Never fails: what went wrong comes back as a note for the agent.
 */
export async function installDependencies(dir: string, exec: typeof run = run): Promise<string | undefined> {
  const folders = [dir, ...subfolders(dir).filter((name) => !name.startsWith('.') && name !== 'node_modules').map((name) => path.join(dir, name))];
  const failures: { dir: string; command: string; reason: string }[] = [];
  for (const folder of folders.filter((f) => installable(fs.readdirSync(f)))) {
    const lockfiles = lockfilesIn(folder);
    const pm = packageManagerFor(lockfiles);
    const stampFile = path.join(folder, INSTALL_STAMP);
    const stamp = installStamp(pm, Object.fromEntries(['package.json', ...lockfiles].map((name) => [name, fs.readFileSync(path.join(folder, name), 'utf8')])));
    if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp) continue;
    const [cmd, ...args] = installCommand(pm, lockfiles);
    try {
      await exec(cmd, args, { cwd: folder, timeoutMs: 15 * 60_000 });
      fs.mkdirSync(path.dirname(stampFile), { recursive: true });
      fs.writeFileSync(stampFile, stamp);
    } catch (err) {
      const reason = /ENOENT/.test(errorMessage(err)) ? missingPackageManager(pm) : errorMessage(err);
      failures.push({ dir: folder, command: [cmd, ...args].join(' '), reason });
    }
  }
  return installFailedNote(failures);
}

/**
 * The office's merge of a PR's base, at `sha` in the mirror (not pushed yet), type-checked in the repo's checks folder:
 * the command that failed, if one did, with the end of its output. Git can merge two branches cleanly and still break
 * the tree. Nothing when the project has no typecheck script.
 */
function typecheckMerge(repo: string, sha: string): Promise<{ command: string; output?: string } | undefined> {
  const dir = path.join(paths.checks, repo.replace('/', '__'));
  return checksLock.with(repo, async () => {
    await lock.with(repo, () => detachAt(mirrorDir(repo), dir, sha));
    const results = await installAndRun(dir, checkCommands(packageScripts(dir), packageManagerIn(dir), ['typecheck']));
    return results?.find((r) => !r.ok);
  });
}

export function workspaceDir(agentId: string): string {
  return path.join(paths.workspaces, agentId);
}

/** Number of commits on HEAD that are not on the base branch. */
export async function commitsAhead(dir: string, baseBranch: string): Promise<number> {
  const out = await git(dir, ['rev-list', '--count', `origin/${baseBranch}..HEAD`]);
  return Number(out.trim()) || 0;
}

/**
 * The commits on HEAD that haven't shipped, oldest first: those not on the base branch, nor part of `shipped` (the commit
 * last pushed for a pull request), when git still has it.
 */
export async function unshippedCommits(dir: string, baseBranch: string, shipped?: string): Promise<string[]> {
  const known = shipped ? await git(dir, ['cat-file', '-e', `${shipped}^{commit}`]).then(() => true, () => false) : false;
  const out = await git(dir, ['rev-list', '--reverse', 'HEAD', `^origin/${baseBranch}`, ...(known ? [`^${shipped}`] : [])]);
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** The files HEAD changes against origin's `baseBranch`, as the three-dot diff QA reviews names them. */
export async function changedFiles(dir: string, baseBranch: string): Promise<string[]> {
  const out = await git(dir, ['diff', '--name-only', `origin/${baseBranch}...HEAD`]);
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Moves the checkout in `dir` onto a new local `branch` at origin's `baseBranch`, fetched first. Commits on the branch it
 * was on stay there. (Like a new worktree's, the branch doesn't track the base, so a stray `git push` can't land on it.)
 */
export async function freshBranch(dir: string, branch: string, baseBranch: string): Promise<void> {
  await retryLockRace(() => git(dir, ['fetch', 'origin', `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`], 5 * 60_000), () => sleep(750));
  await followOrigin(dir, baseBranch);
  await git(dir, ['checkout', '--no-track', '-B', branch, `origin/${baseBranch}`]);
}

/** Applies `commits` on top of HEAD, in order. If they don't apply cleanly, HEAD is left as it was and this fails. */
export async function cherryPick(dir: string, commits: string[]): Promise<void> {
  try {
    await git(dir, ['cherry-pick', '--keep-redundant-commits', ...commits]);
  } catch (err) {
    await git(dir, ['cherry-pick', '--abort']).catch(() => undefined);
    throw err;
  }
}

export async function head(dir: string): Promise<string> {
  return (await git(dir, ['rev-parse', 'HEAD'])).trim();
}

export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  return (await git(dir, ['status', '--porcelain'])).trim().length > 0;
}

/**
 * Commits everything uncommitted in `dir`, untracked files too, as `message`, skipping commit hooks: work about to be
 * thrown away is kept on the branch instead. False when there was nothing to commit, or no checkout to commit in.
 */
export async function snapshot(dir: string, message: string): Promise<boolean> {
  if (!fs.existsSync(dir)) return false;
  await git(dir, ['add', '-A']);
  if (await git(dir, ['diff', '--cached', '--quiet']).then(() => true, () => false)) return false;
  await git(dir, ['commit', '--no-verify', '-q', '-m', message]);
  return true;
}

/**
 * Whether origin has `branch`, and how many commits on HEAD it hasn't got: those not on origin's `branch` or, while
 * origin hasn't got it, not on `baseBranch`.
 */
export async function branchState(dir: string, branch: string, baseBranch: string): Promise<BranchState> {
  const onOrigin = (await git(dir, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], 60_000)).trim().length > 0;
  if (onOrigin) await git(dir, ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], 5 * 60_000);
  const out = await git(dir, ['rev-list', '--count', `origin/${onOrigin ? branch : baseBranch}..HEAD`]);
  return { onOrigin, unpushed: Number(out.trim()) || 0 };
}

/**
 * Force-pushes HEAD to origin's `branch`, after a fetch with `--prune`: a remote-tracking ref left behind by a branch
 * GitHub has since deleted (a squash-merged PR's) would otherwise poison the lease, and git refuses with "stale info".
 * (What the lease would have caught, someone else's commits on the branch, the manager checks for before pushing.)
 */
export async function pushBranch(dir: string, branch: string): Promise<void> {
  await retryLockRace(() => git(dir, ['fetch', 'origin', '--prune'], 10 * 60_000), () => sleep(750));
  await git(dir, ['push', '--force-with-lease', '-u', 'origin', `HEAD:refs/heads/${branch}`], 5 * 60_000);
}

/** Creates `branch` on origin at the worktree's commit, unless it's already there: then the worktree takes what's there. */
export async function publishBranch(dir: string, branch: string): Promise<void> {
  const exists = (await git(dir, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], 60_000)).trim().length > 0;
  if (exists) await pullBranch(dir, branch);
  else await git(dir, ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`], 5 * 60_000);
}

/** Resets the worktree to what's on origin's `branch`: a cloud agent pushes there, and nothing local is kept. */
export async function pullBranch(dir: string, branch: string): Promise<void> {
  await git(dir, ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], 5 * 60_000);
  await git(dir, ['reset', '--hard', `origin/${branch}`]);
}

/**
 * Merges origin's `baseBranch` into origin's `branch` in a scratch worktree, and pushes the merge when git needed no
 * help, or every conflicted file has a rule in the repo's `.gitattributes` (`MergeRule`), and its typecheck passes.
 * Otherwise nothing is pushed. The push isn't forced, so it fails if someone pushed to the branch meanwhile.
 */
export async function mergeBase(repo: string, branch: string, baseBranch: string): Promise<BaseMerge> {
  const mirror = mirrorDir(repo);
  const dir = path.join(paths.merges, `${repo.replace('/', '__')}-${randomBytes(4).toString('hex')}`);
  await lock.with(repo, async () => {
    await ensureMirror(repo);
    await retryLockRace(() => git(mirror, ['fetch', 'origin', '--prune'], 10 * 60_000), () => sleep(750));
    fs.mkdirSync(paths.merges, { recursive: true });
    await git(mirror, ['worktree', 'add', '--detach', dir, `origin/${branch}`]);
  });
  try {
    const before = await head(dir);
    let auto: string[] = [];
    try {
      await git(dir, ['merge', '--no-edit', '-m', `Merge ${baseBranch} into ${branch}`, `origin/${baseBranch}`]);
    } catch (err) {
      const stages = conflictStages(await git(dir, ['ls-files', '-u', '-z']).catch(() => ''));
      const files = [...stages.keys()];
      if (!files.length) throw err;
      const rules = mergeRules(await git(dir, ['check-attr', '-z', 'focus-merge', 'merge', '--', ...files]).catch(() => ''));
      const plan = autoMergePlan(stages, rules);
      if (plan.left.length) return { kind: 'conflicts', files };
      for (const { file, rule } of plan.auto) await settle(dir, file, rule, stages.get(file) ?? new Set());
      await git(dir, ['commit', '--no-edit', '--no-verify']);
      auto = files;
    }
    const after = await head(dir);
    if (after === before) return { kind: 'up-to-date' };
    const broke = await typecheckMerge(repo, after);
    if (broke) {
      console.warn(`The office's merge of ${baseBranch} into ${repo}'s ${branch} failed \`${broke.command}\`: ${broke.output ?? ''}`);
      return { kind: 'conflicts', files: auto, broke: broke.command };
    }
    await git(dir, ['push', 'origin', `HEAD:refs/heads/${branch}`], 5 * 60_000);
    return { kind: 'merged', sha: after, from: before, ...(auto.length ? { auto } : {}) };
  } finally {
    await lock.with(repo, () => removeDir(mirror, dir));
  }
}

/** Settles a conflicted file in `dir` by its rule (see `MergeRule`), and stages it. */
async function settle(dir: string, file: string, rule: MergeRule, stages: Set<number>): Promise<void> {
  if (rule === 'union') {
    const scratch = fs.mkdtempSync(path.join(paths.merges, 'union-'));
    try {
      const base = path.join(scratch, 'base');
      const theirs = path.join(scratch, 'theirs');
      fs.writeFileSync(base, stages.has(1) ? await git(dir, ['show', `:1:${file}`]) : '');
      fs.writeFileSync(theirs, await git(dir, ['show', `:3:${file}`]));
      fs.writeFileSync(path.join(dir, file), await git(dir, ['show', `:2:${file}`]));
      await git(dir, ['merge-file', '--union', file, base, theirs]);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  } else if (stages.has(rule === 'ours' ? 2 : 3)) {
    await git(dir, ['checkout', `--${rule}`, '--', file]);
  } else {
    await git(dir, ['rm', '-q', '-f', '--', file]);
    return;
  }
  await git(dir, ['add', '--', file]);
}

/** Whether origin's `branch` has commits that HEAD doesn't (someone else pushed to it). False while origin hasn't got it. */
export async function missingRemoteCommits(dir: string, branch: string): Promise<boolean> {
  const remote = (await git(dir, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], 60_000)).trim().split(/\s/)[0];
  if (!remote) return false;
  await git(dir, ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], 5 * 60_000);
  return !(await git(dir, ['merge-base', '--is-ancestor', remote, 'HEAD']).then(() => true, () => false));
}

export async function commitLog(dir: string, baseBranch: string): Promise<string> {
  return (await git(dir, ['log', '--format=- %s', `origin/${baseBranch}..HEAD`])).trim();
}
