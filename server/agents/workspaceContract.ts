import { describe, expect, it } from 'vitest';
import type { WorkspaceOps } from './types';

// The contract every `WorkspaceOps` keeps (docs/contracts.md): what Ops relies on git doing, written once and
// run against the real thing (workspace.ts, on throwaway repos) and against each fake that stands in for it, so a fake
// can't quietly encode an assumption git doesn't keep. Each expectation is one scenario, told through a `World`: the
// workspace under test, and what happens around it (the agent committing, the base moving on GitHub, someone else
// pushing). A fake that can't play a scenario out says so, with its reason, rather than passing it.

/** A workspace under test, and the world around it. */
export interface World {
  ops: WorkspaceOps;
  repo: string;
  /** A checkout for `agent` on a new `branch`, from origin's `main`. */
  checkout(agent: string, branch: string): Promise<string>;
  /** The agent commits `file` with `text` in their checkout. */
  commit(dir: string, file: string, text: string): Promise<void>;
  /** The agent changes `file` and leaves it uncommitted (untracked, when it's new). */
  write(dir: string, file: string, text: string): Promise<void>;
  /** What `file` holds in the checkout; undefined when there's none on disk. */
  read(dir: string, file: string): Promise<string | undefined>;
  /** Someone else's change to `file` lands on origin's `main` (a pull request merged, squashed into one commit). */
  land(file: string, text: string): Promise<void>;
  /** Someone else (Ops' merge, say) pushes a change to `file` onto origin's `branch`, creating it from `main` if need be. */
  pushElsewhere(branch: string, file: string, text: string): Promise<void>;
  /** GitHub deletes `branch` (`gh pr merge --delete-branch`, after its pull request merged). */
  deleteOnOrigin(branch: string): Promise<void>;
  /** The commit origin's `branch` is at; undefined when origin hasn't got it. */
  originHead(branch: string): Promise<string | undefined>;
  /** What `ref` names inside the checkout, as an agent's own `git` there sees it (`main`, say). */
  localRef(dir: string, ref: string): Promise<string | undefined>;
}

export interface Expectation {
  name: string;
  /** The real bug fix that taught it, when one did. */
  fix?: string;
  run(w: World): Promise<void>;
}

export const WORKSPACE_CONTRACT: Expectation[] = [
  {
    name: 'a new checkout starts at origin’s base: nothing ahead or uncommitted',
    run: async (w) => {
      const dir = await w.checkout('a1', 'focus/new');
      expect(await w.ops.head(dir)).toBe(await w.originHead('main'));
      expect(await w.ops.commitsAhead(dir, 'main')).toBe(0);
      expect(await w.ops.hasUncommittedChanges(dir)).toBe(false);
    },
  },
  {
    name: 'HEAD stays put until a commit, which moves it',
    run: async (w) => {
      const dir = await w.checkout('a1', 'focus/head');
      const before = await w.ops.head(dir);
      expect(await w.ops.head(dir)).toBe(before);
      await w.commit(dir, 'a.ts', 'a');
      const after = await w.ops.head(dir);
      expect(after).not.toBe(before);
      expect(await w.ops.head(dir)).toBe(after);
    },
  },
  {
    name: 'an untracked file is an uncommitted change, and a snapshot commits it',
    fix: 'b186a17',
    run: async (w) => {
      const dir = await w.checkout('a1', 'focus/untracked');
      await w.write(dir, '.idea/workspace.xml', '<project/>');
      expect(await w.ops.hasUncommittedChanges(dir)).toBe(true);
      expect(await w.ops.snapshot(dir, 'WIP')).toBe(true);
      expect(await w.ops.hasUncommittedChanges(dir)).toBe(false);
      expect(await w.ops.commitsAhead(dir, 'main')).toBe(1);
      expect(await w.ops.snapshot(dir, 'WIP')).toBe(false);
    },
  },
  {
    name: 'a branch never pushed isn’t on origin and counts its commits from the base; once pushed, nothing is unpushed',
    run: async (w) => {
      const dir = await w.checkout('a1', 'focus/state');
      await w.commit(dir, 'a.ts', 'a');
      expect(await w.ops.branchState(dir, 'focus/state', 'main')).toEqual({ onOrigin: false, unpushed: 1 });
      await w.ops.push(dir, 'focus/state');
      expect(await w.ops.branchState(dir, 'focus/state', 'main')).toEqual({ onOrigin: true, unpushed: 0 });
      expect(await w.originHead('focus/state')).toBe(await w.ops.head(dir));
      await w.commit(dir, 'b.ts', 'b');
      expect(await w.ops.branchState(dir, 'focus/state', 'main')).toEqual({ onOrigin: true, unpushed: 1 });
    },
  },
  {
    name: 'the base moving on origin is never counted as the branch’s own work',
    run: async (w) => {
      const dir = await w.checkout('a1', 'focus/moved');
      await w.commit(dir, 'mine.ts', 'mine');
      await w.land('theirs.ts', 'theirs');
      await w.ops.push(dir, 'focus/moved');
      expect(await w.ops.commitsAhead(dir, 'main')).toBe(1);
      if (w.ops.changedFiles) expect(await w.ops.changedFiles(dir, 'main')).toEqual(['mine.ts']);
    },
  },
  {
    name: 'the local base follows origin’s, so an agent’s own diff against main is only their commits',
    fix: 'b0ac83c',
    run: async (w) => {
      await w.land('readme.md', 'moved before the checkout');
      const dir = await w.checkout('a1', 'focus/base');
      expect(await w.localRef(dir, 'main')).toBe(await w.originHead('main'));
      expect(await w.ops.commitsAhead(dir, 'main')).toBe(0);
    },
  },
  {
    name: 'a push still lands after GitHub deleted the branch its last push went to',
    fix: '5e27b8e',
    run: async (w) => {
      const dir = await w.checkout('a1', 'focus/again');
      await w.commit(dir, 'a.ts', 'a');
      await w.ops.push(dir, 'focus/again');
      await w.deleteOnOrigin('focus/again');
      await w.commit(dir, 'b.ts', 'b');
      await w.ops.push(dir, 'focus/again');
      expect(await w.originHead('focus/again')).toBe(await w.ops.head(dir));
      expect(await w.ops.branchState(dir, 'focus/again', 'main')).toEqual({ onOrigin: true, unpushed: 0 });
    },
  },
  {
    name: 'someone else’s commits on origin’s branch are noticed, and a pull brings them in',
    run: async (w) => {
      const dir = await w.checkout('a1', 'focus/shared');
      expect(await w.ops.missingRemoteCommits(dir, 'focus/shared')).toBe(false);
      await w.commit(dir, 'a.ts', 'a');
      await w.ops.push(dir, 'focus/shared');
      expect(await w.ops.missingRemoteCommits(dir, 'focus/shared')).toBe(false);
      await w.pushElsewhere('focus/shared', 'theirs.ts', 'theirs');
      expect(await w.ops.missingRemoteCommits(dir, 'focus/shared')).toBe(true);
      await w.ops.pull(dir, 'focus/shared');
      expect(await w.ops.missingRemoteCommits(dir, 'focus/shared')).toBe(false);
      expect(await w.ops.head(dir)).toBe(await w.originHead('focus/shared'));
      expect(await w.read(dir, 'theirs.ts')).toBe('theirs');
    },
  },
  {
    name: 'merging the base: up to date when it hasn’t moved, merged and pushed when it has',
    run: async (w) => {
      const dir = await w.checkout('a1', 'focus/merge');
      await w.commit(dir, 'mine.ts', 'mine');
      await w.ops.push(dir, 'focus/merge');
      const from = await w.originHead('focus/merge');
      expect(await w.ops.mergeBase(w.repo, 'focus/merge', 'main')).toEqual({ kind: 'up-to-date' });
      await w.land('theirs.ts', 'theirs');
      const merge = await w.ops.mergeBase(w.repo, 'focus/merge', 'main');
      expect(merge).toEqual({ kind: 'merged', from, sha: await w.originHead('focus/merge') });
      expect(await w.ops.missingRemoteCommits(dir, 'focus/merge')).toBe(true);
    },
  },
  {
    name: 'merging the base reports the files that conflict, and pushes nothing',
    run: async (w) => {
      const dir = await w.checkout('a1', 'focus/clash');
      await w.commit(dir, 'readme.md', 'mine');
      await w.ops.push(dir, 'focus/clash');
      await w.land('readme.md', 'theirs');
      const before = await w.originHead('focus/clash');
      expect(await w.ops.mergeBase(w.repo, 'focus/clash', 'main')).toEqual({ kind: 'conflicts', files: ['readme.md'] });
      expect(await w.originHead('focus/clash')).toBe(before);
    },
  },
  {
    name: 'restacking a waypoint after the one below was squash-merged replays only its own commits: no conflict, then up to date',
    run: async (w) => {
      // waypoint 1 changes a file twice; waypoint 2, cut from it, changes it again
      const dir = await w.checkout('a1', 'focus/wp1');
      await w.commit(dir, 'a.ts', 'one');
      await w.commit(dir, 'a.ts', 'two');
      await w.ops.push(dir, 'focus/wp1');
      const below = (await w.originHead('focus/wp1')) ?? '';
      await w.commit(dir, 'a.ts', 'three');
      await w.ops.push(dir, 'focus/wp2');
      const from = await w.originHead('focus/wp2');
      // waypoint 1 lands squashed into one commit, and GitHub deletes its branch
      await w.land('a.ts', 'two');
      await w.deleteOnOrigin('focus/wp1');
      expect(await w.ops.restack(w.repo, 'focus/wp2', 'main', below)).toEqual({ kind: 'restacked', from, sha: await w.originHead('focus/wp2') });
      expect(await w.ops.mergeBase(w.repo, 'focus/wp2', 'main')).toEqual({ kind: 'up-to-date' });
      expect(await w.ops.restack(w.repo, 'focus/wp2', 'main', below)).toEqual({ kind: 'up-to-date' });
    },
  },
  {
    name: 'restacking onto a change that clashes with the waypoint’s own reports the files, and pushes nothing',
    run: async (w) => {
      const dir = await w.checkout('a1', 'focus/wp1');
      await w.commit(dir, 'a.ts', 'one');
      await w.ops.push(dir, 'focus/wp1');
      const below = (await w.originHead('focus/wp1')) ?? '';
      await w.commit(dir, 'a.ts', 'mine');
      await w.ops.push(dir, 'focus/wp2');
      await w.land('a.ts', 'theirs');
      const before = await w.originHead('focus/wp2');
      expect(await w.ops.restack(w.repo, 'focus/wp2', 'main', below)).toEqual({ kind: 'conflicts', files: ['a.ts'] });
      expect(await w.originHead('focus/wp2')).toBe(before);
    },
  },
];

/**
 * Registers the contract for one implementation: `world` makes a fresh world for each expectation. `simplifies` names
 * the expectations it knowingly doesn't keep, each with why: those are held to fail (`it.fails`), so a fake that comes
 * to keep one is told to drop the excuse.
 */
export function holdsToWorkspaceContract(name: string, world: (n: number) => World | Promise<World>, simplifies: Record<string, string> = {}): void {
  const unknown = Object.keys(simplifies).filter((k) => !WORKSPACE_CONTRACT.some((e) => e.name === k));
  describe.concurrent(`${name} keeps the workspace contract`, () => {
    it('excuses only expectations the contract has', () => expect(unknown).toEqual([]));
    WORKSPACE_CONTRACT.forEach((e, n) => {
      const title = e.fix ? `${e.name} (${e.fix})` : e.name;
      if (simplifies[e.name]) it.fails(`${title} [simplified: ${simplifies[e.name]}]`, async () => e.run(await world(n)));
      else it(title, async () => e.run(await world(n)));
    });
  });
}
