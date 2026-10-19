import { sameCommit } from './qa';
import type { MergeCheck, PullRequest } from './types';

// The merge check: before the office merges a pull request, it builds what the merge would leave on the base branch
// (the PR's head merged onto the base as it is now) and runs the repo's checks on it. Whether that lets the merge
// through is decided here, pure, so it's unit tested (shared/mergeCheck.test.ts); server/agents/manager/merges.ts
// fetches, merges and runs the checks, and server/agents/workspace.ts does the git. docs/merging.md tells it.

/** The package.json scripts run on the merge when the project hasn't chosen others. */
export const DEFAULT_MERGE_CHECKS: readonly string[] = ['typecheck', 'lint', 'test'];

/** A repo that has a package.json script of this name says exactly what checks a merge of it: that script, alone. */
export const MERGE_CHECK_SCRIPT = 'merge-check';

/**
 * The package.json scripts to run on a merge of a repo with these `scripts`: its own `merge-check` script if it has
 * one, else those of the project's `chosen` (by default typecheck, lint and test) the repo has. None for a repo with no
 * package.json, or none of them: then only conflicts stop a merge.
 */
export function mergeCheckScripts(scripts: Record<string, unknown> | undefined, chosen: readonly string[] = DEFAULT_MERGE_CHECKS): string[] {
  if (!scripts) return [];
  const has = (name: string) => {
    const script = scripts[name];
    return typeof script === 'string' && !/no test specified/.test(script);
  };
  if (has(MERGE_CHECK_SCRIPT)) return [MERGE_CHECK_SCRIPT];
  return chosen.filter(has);
}

/** One command run on the merge, and the end of its output when it failed. */
export interface CheckResult {
  command: string;
  ok: boolean;
  output?: string;
}

/** The two commits a merge check is about: the base branch's head and the PR's, as the office's clone fetched them. */
export interface MergeHeads {
  base: string;
  head: string;
}

/**
 * What came of building the merge and checking it: git couldn't merge them (`files` conflict), the checks ran on the
 * merge commit (none at all for a repo without any), or the office couldn't build or check it (`reason`).
 */
export type MergeTrial =
  | (MergeHeads & { kind: 'conflicts'; files: string[] })
  | (MergeHeads & { kind: 'checked'; merge: string; results: CheckResult[] })
  | (Partial<MergeHeads> & { kind: 'broken'; reason: string });

export type GateStep =
  /** It won't merge, without building anything. */
  | { kind: 'refuse'; reason: string }
  /** A trial of these very commits already ran: its verdict stands, nothing runs again. */
  | { kind: 'reuse'; trial: MergeTrial }
  /** Build the merge and run the checks. */
  | { kind: 'try' };

/**
 * What the office does before merging a PR now at `heads.head` onto `heads.base` (the captain merging past the check
 * never gets here): `want` is the commit the caller means to merge (QA's pass, say), when it named one; `cached` the
 * PR's last trial. A trial that couldn't run is tried again; one of other commits is old news.
 */
export function gateStep(heads: MergeHeads, opts: { want?: string; cached?: MergeTrial }): GateStep {
  if (!heads.head) return { kind: 'refuse', reason: 'the office can’t tell which commit it’s at' };
  if (opts.want && !sameCommit(opts.want, heads.head)) return { kind: 'refuse', reason: `it moved on to ${short(heads.head)} since ${short(opts.want)}` };
  const cached = opts.cached;
  if (cached && cached.kind !== 'broken' && sameCommit(cached.base, heads.base) && sameCommit(cached.head, heads.head)) return { kind: 'reuse', trial: cached };
  return { kind: 'try' };
}

export type MergeVerdict = { kind: 'merge'; said: string } | { kind: 'refuse'; reason: string };

/** Whether a trial lets the merge through: only a merge git made by itself whose every check passed does. */
export function mergeVerdict(trial: MergeTrial): MergeVerdict {
  switch (trial.kind) {
    case 'broken':
      return { kind: 'refuse', reason: `the office couldn’t check the merge: ${trial.reason}` };
    case 'conflicts':
      return { kind: 'refuse', reason: `it conflicts with its base at ${short(trial.base)}${trial.files.length ? ` (${trial.files.join(', ')})` : ''}` };
    case 'checked': {
      const failed = trial.results.find((r) => !r.ok);
      if (failed) return { kind: 'refuse', reason: `\`${failed.command}\` fails on its merge with the base at ${short(trial.base)}` };
      const ran = trial.results.length;
      return { kind: 'merge', said: ran ? `its merge with the base passes ${ran === 1 ? trial.results[0].command : `${ran} checks`}` : 'it merges cleanly (no checks to run)' };
    }
  }
}

/** The merge check to show on a PR's card: only one about its head as the board has it. */
export function mergeCheckOn(pr: Pick<PullRequest, 'headSha'>, check: MergeCheck | undefined): MergeCheck | undefined {
  return check && pr.headSha && sameCommit(check.head, pr.headSha) ? check : undefined;
}

/** How a merge check reads on its PR's card. */
export function mergeCheckLine(check: MergeCheck): string {
  switch (check.state) {
    case 'queued':
      return check.behind ? `queued behind #${check.behind}` : 'queued to merge';
    case 'checking':
      return 'checking the merge';
    case 'passed':
      return 'merge checked';
    case 'overridden':
      return 'merged past the check';
    case 'refused':
      return `merge refused: ${check.reason ?? 'its merge check failed'}`;
  }
}

/** The PR comment when its merge check refuses it: why, and the end of what the failing command said. */
export function refusalComment(trial: MergeTrial, reason: string): string {
  const failed = trial.kind === 'checked' ? trial.results.find((r) => !r.ok) : undefined;
  const output = failed?.output?.trim() ? `\n\n\`\`\`\n${failed.output.trim().split('\n').slice(-30).join('\n')}\n\`\`\`` : '';
  const ran = trial.kind === 'checked' ? `\n\nOn the merge commit \`${short(trial.merge)}\`: ${trial.results.map((r) => `${r.ok ? '✅' : '❌'} \`${r.command}\``).join(' · ')}` : '';
  return `## 🚦 Merge check: refused\n\nThe office didn’t merge this: ${reason}.${ran}${output}\n\nPush a fix, or merge it anyway from the board (the ledger notes an override).`;
}

/** The ledger's line for a merge check (`merge-check`), without the PR it's on. */
export function trialOutcome(trial: MergeTrial): { outcome: 'passed' | 'failed' | 'conflicts' | 'broken'; failed?: string } {
  switch (trial.kind) {
    case 'broken':
      return { outcome: 'broken', failed: trial.reason };
    case 'conflicts':
      return { outcome: 'conflicts', ...(trial.files.length && { failed: trial.files.join(', ') }) };
    case 'checked': {
      const failed = trial.results.find((r) => !r.ok);
      return failed ? { outcome: 'failed', failed: failed.command } : { outcome: 'passed' };
    }
  }
}

/** The conflicted files `git merge-tree --write-tree --name-only` lists after the tree it wrote, up to the blank line. */
export function mergeTreeConflicts(output: string): string[] {
  const lines = output.split('\n').slice(1);
  const end = lines.findIndex((l) => !l.trim());
  return (end < 0 ? lines : lines.slice(0, end)).map((l) => l.trim()).filter(Boolean);
}

function short(sha: string): string {
  return sha.slice(0, 7);
}
