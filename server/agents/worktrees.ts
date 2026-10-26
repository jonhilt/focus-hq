import path from 'node:path';
import { CommandError } from '../util';
import { isRefLockRace } from './worktreeRules';

/** One entry of `git worktree list --porcelain`. `branch` is the short name; detached worktrees have none. */
export interface Worktree {
  path: string;
  branch?: string;
}

export function parseWorktrees(porcelain: string): Worktree[] {
  const worktrees: Worktree[] = [];
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const at = lines.find((l) => l.startsWith('worktree '));
    if (!at) continue;
    const ref = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length);
    worktrees.push({ path: at.slice('worktree '.length), branch: ref?.replace(/^refs\/heads\//, '') });
  }
  return worktrees;
}

export function heldMessage(branch: string, claim: { path: string; agentId?: string }): string {
  return claim.agentId
    ? `Branch ${branch} is checked out in ${claim.path}, the workspace of ${claim.agentId}, who's still aboard.`
    : `Branch ${branch} is checked out in ${claim.path}, which isn't an agent workspace.`;
}

/** Runs `fetch` up to `attempts` times while it keeps losing a ref lock race, pausing with `wait` in between. */
export async function retryLockRace<A>(fetch: () => Promise<A>, wait: () => Promise<void>, attempts = 3): Promise<A> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch();
    } catch (err) {
      if (attempt >= attempts || !(err instanceof CommandError) || !isRefLockRace(err.stderr)) throw err;
      await wait();
    }
  }
}

/**
 * Where a reviewer (a QA officer, or the room's operations officer looking at a stuck PR) checks pull request `number`
 * out: a folder of its own inside the reviewer's workspace, one per PR, so a goal's reviewer going from one repo's PR to
 * another's never checks out over a folder something is still using, and a re-test of the same PR keeps its installs.
 */
export const reviewCheckoutId = (reviewerId: string, repo: string, number: number) => `${reviewerId}/${repo.replace('/', '__')}-pr${number}`;

/**
 * One repo's checkout in a review's folder: laid out like the lead's workspace, each repo at its own `folder`, so the PR
 * under test (the session's current directory) finds the slice's other PRs, checked out beside it, where the lead had them.
 */
export const reviewRepoId = (reviewerId: string, pr: { repo: string; number: number }, folder: string) => `${reviewCheckoutId(reviewerId, pr.repo, pr.number)}/${folder}`;

/** What a folder that couldn't be deleted is renamed to, in data/workspaces: owned by no one, so the sweep deletes it later. */
export const trashName = (dir: string, suffix: string) => `trash_${path.basename(dir)}_${suffix}`;
