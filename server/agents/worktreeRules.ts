import path from 'node:path';
import type { Worktree } from './worktrees';

// What to do about the workspaces under data/workspaces: whether a new agent's branch is free, held, or held by a
// workspace that can go; which folders nobody owns; and whether a failed fetch lost a race worth retrying. Pure, so
// it's unit tested (worktreeRules.test.ts); workspace.ts does the git and the deleting.

/** What to do about the worktree, if any, that already has the branch a new agent needs. */
export type BranchClaim =
  | { kind: 'free' }
  /** A workspace left behind by an agent who's no longer aboard: its work is on the remote, so it can go. */
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
  aboard: (agentId: string) => boolean,
): BranchClaim {
  const holder = worktrees.find((w) => w.branch === branch);
  if (!holder) return { kind: 'free' };
  const agentId = workspaceOwner(path.relative(workspacesDir, holder.path));
  if (!agentId) return { kind: 'held', path: holder.path };
  return aboard(agentId) ? { kind: 'held', path: holder.path, agentId } : { kind: 'reclaim', path: holder.path };
}

/**
 * The folders under data/workspaces that nobody owns: each agent aboard (QA officers included) keeps the folder
 * named after it, and each project keeps its PR triage checkout. Everything else is left over and can go.
 */
export function orphanedWorkspaces(folders: string[], agentIds: Iterable<string>, projectIds: Iterable<string>): string[] {
  const owned = new Set([...agentIds, ...[...projectIds].map(triageWorkspaceId)]);
  return folders.filter((name) => !owned.has(name));
}

/** Where the room's operations officer checks out a stuck PR to look at it. */
export const triageWorkspaceId = (projectId: string) => `triage_${projectId}`;

/**
 * Agents fetch in their own worktrees, which share the mirror's refs, so the mirror's fetch can lose a race for a
 * remote-tracking ref that another fetch is updating to the same commit. That's worth retrying; other failures aren't.
 */
export function isRefLockRace(stderr: string): boolean {
  return /cannot lock ref|unable to update local ref/.test(stderr);
}
