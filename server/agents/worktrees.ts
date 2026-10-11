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

/**
 * Whose workspace a path (relative to data/workspaces) is: an agent's own folder, or one repo's folder inside a lead's
 * workspace (`lead_…/<repo>`). Anything else, including other folders nested in a workspace, belongs to no one we know.
 */
function workspaceOwner(rel: string): string | undefined {
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  const parts = rel.split(path.sep);
  if (parts.length === 1) return rel;
  return parts.length === 2 && parts[0].startsWith('lead_') ? parts[0] : undefined;
}

export function claimBranch(
  worktrees: Worktree[],
  branch: string,
  workspacesDir: string,
  inOffice: (agentId: string) => boolean,
): BranchClaim {
  const holder = worktrees.find((w) => w.branch === branch);
  if (!holder) return { kind: 'free' };
  const agentId = workspaceOwner(path.relative(workspacesDir, holder.path));
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
