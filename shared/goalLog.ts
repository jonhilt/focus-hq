import type { GoalRecord } from './types';

/**
 * Where a closed goal's repos were left, as the log says it: the branch each repo was on (its own, when Ops
 * renamed or moved it, or else the goal's), in one line. Undefined for a goal closed before branches were kept.
 */
export function leftOn(goal: Pick<GoalRecord, 'branch' | 'repos'>): string | undefined {
  const { branch } = goal;
  if (!branch) return undefined;
  const on = (goal.repos ?? []).map((r) => ({ folder: r.folder, branch: r.branch ?? branch }));
  const branches = [...new Set(on.map((r) => r.branch))];
  if (branches.length <= 1) return `Left on ${branches[0] ?? branch}`;
  return `Left on ${on.map((r) => `${r.branch} in ${r.folder}`).join(', ')}`;
}
