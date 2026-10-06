import path from 'node:path';
import { CommandError } from '../util';

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

/** What to do about the worktree, if any, that already has the branch a new agent needs. */
export type BranchClaim =
  | { kind: 'free' }
  /** A workspace left behind by an agent who's no longer in the office: its work is on the remote, so it can go. */
  | { kind: 'reclaim'; path: string }
  /** Checked out somewhere we mustn't touch: a colleague's workspace, or a folder that isn't a workspace at all. */
  | { kind: 'held'; path: string; agentId?: string };

export function claimBranch(
  worktrees: Worktree[],
  branch: string,
  workspacesDir: string,
  inOffice: (agentId: string) => boolean,
): BranchClaim {
  const holder = worktrees.find((w) => w.branch === branch);
  if (!holder) return { kind: 'free' };
  const rel = path.relative(workspacesDir, holder.path);
  const agentId = rel && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep) ? rel : undefined;
  if (!agentId) return { kind: 'held', path: holder.path };
  return inOffice(agentId) ? { kind: 'held', path: holder.path, agentId } : { kind: 'reclaim', path: holder.path };
}

/**
 * The folders under data/workspaces that nobody owns: each agent in the office (QA officers included) keeps the folder
 * named after it, and each project keeps its PR triage checkout. Everything else is left over and can go.
 */
export function orphanedWorkspaces(folders: string[], agentIds: Iterable<string>, projectIds: Iterable<string>): string[] {
  const owned = new Set([...agentIds, ...[...projectIds].map(triageWorkspaceId)]);
  return folders.filter((name) => !owned.has(name));
}

/** Where the room's operations officer checks out a stuck PR to look at it. */
export const triageWorkspaceId = (projectId: string) => `triage_${projectId}`;

export function heldMessage(branch: string, claim: { path: string; agentId?: string }): string {
  return claim.agentId
    ? `Branch ${branch} is checked out in ${claim.path}, the workspace of ${claim.agentId}, who's still in the office.`
    : `Branch ${branch} is checked out in ${claim.path}, which isn't an agent workspace.`;
}

/**
 * Agents fetch in their own worktrees, which share the mirror's refs, so the mirror's fetch can lose a race for a
 * remote-tracking ref that another fetch is updating to the same commit. That's worth retrying; other failures aren't.
 */
export function isRefLockRace(stderr: string): boolean {
  return /cannot lock ref|unable to update local ref/.test(stderr);
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
