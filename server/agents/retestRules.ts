import { sameCommit } from '../../shared/qa';
import type { QaReview } from '../../shared/types';
import { type PackageManager, scriptCommand } from '../packageManagerRules';

// Whether a PR that's back for QA needs the QA officer at all. A head QA already gave a verdict on doesn't; one that only
// merged the base branch in, cleanly, on top of a pass gets the project's checks run by Ops instead. Pure, so
// it's unit tested (retestRules.test.ts); manager.ts gathers the git facts and runs the checks.

/** What git says about the commits on a PR since QA's verdict. */
export interface SinceVerdict {
  /** The PR's head now. */
  head: string;
  /** False when the verdict's commit isn't an ancestor of the head any more (a force-push), or git doesn't have it. */
  descends: boolean;
  /** The commits after the verdict's, up to the head. */
  commits: { sha: string; mergesBase: boolean; clean: boolean }[];
  /** `git range-diff` of the PR's own commits, before and after, shows no changes. */
  sameChanges: boolean;
}

export type RetestStep =
  /** QA already has a verdict on the head: nothing to do. */
  | { kind: 'skip'; reason: string }
  /** Only the base branch came in since QA passed `passed`: Ops runs the checks and carries the pass over if they're green. */
  | { kind: 'checks-only'; head: string; passed: string }
  | { kind: 'retest'; reason: string };

/** Whether `review`, the last round, settles the PR at `head` without the QA officer. `since` is null when git couldn't tell. */
export function retestStep(review: QaReview | undefined, head: string, since: SinceVerdict | null): RetestStep {
  if (!review?.sha || (review.status !== 'passed' && review.status !== 'failed')) return { kind: 'retest', reason: 'no verdict yet' };
  if (head && sameCommit(review.sha, head)) return { kind: 'skip', reason: `QA already ${review.status} ${head.slice(0, 7)}` };
  if (review.status !== 'passed') return { kind: 'retest', reason: 'QA failed the last round' };
  if (!since || !sameCommit(since.head, head || since.head)) return { kind: 'retest', reason: 'couldn’t compare with the passed commit' };
  if (!since.descends) return { kind: 'retest', reason: 'the branch was rewritten since QA passed it' };
  if (!since.commits.length) return { kind: 'retest', reason: 'no new commits found' };
  if (!since.commits.every((c) => c.mergesBase)) return { kind: 'retest', reason: 'new commits besides merges of the base branch' };
  if (!since.commits.every((c) => c.clean)) return { kind: 'retest', reason: 'the merge of the base branch needed conflicts resolving' };
  if (!since.sameChanges) return { kind: 'retest', reason: 'the PR’s own changes differ from what QA passed' };
  return { kind: 'checks-only', head: since.head, passed: review.sha };
}

/**
 * The commit QA owes a review of once they've given a verdict: one Ops shipped while they were testing an
 * earlier one. Undefined when the verdict is on the latest ship (or nothing shipped).
 */
export function shippedSinceTested(review: Pick<QaReview, 'sha' | 'shippedHead'>): string | undefined {
  const { sha, shippedHead } = review;
  return shippedHead && sha && !sameCommit(sha, shippedHead) ? shippedHead : undefined;
}

/**
 * The project's checks (typecheck, lint, tests, or only those `names`), from its package.json scripts, run with its
 * package manager `pm`; none when it has none of them.
 */
export function checkCommands(
  scripts: Record<string, unknown> | undefined,
  pm: PackageManager,
  names: readonly ('typecheck' | 'lint' | 'test')[] = ['typecheck', 'lint', 'test'],
): string[][] {
  if (!scripts) return [];
  const has = (name: string) => {
    const script = scripts[name];
    return typeof script === 'string' && !/no test specified/.test(script);
  };
  return names.filter(has).map((name) => scriptCommand(pm, name));
}

/** `git range-diff` output with every commit pair unchanged ("1: abc = 1: def"). */
export function rangeDiffUnchanged(output: string): boolean {
  const lines = output.split('\n').filter((l) => l.trim());
  return lines.length > 0 && lines.every((l) => /^\s*\d+:\s+[0-9a-f]+\s+=\s+\d+:\s+[0-9a-f]+/.test(l));
}

/** The PR comment when Ops carries a pass over a merge of the base branch. */
export function carriedComment(baseBranch: string, head: string, passed: string, commands: string[]): string {
  const ran = commands.length ? ` (${commands.map((c) => `\`${c}\``).join(', ')})` : '';
  return `## 🔍 QA: ✅ Passed\n\nMerge of ${baseBranch} only; checks green at \`${head.slice(0, 7)}\`${ran}. QA's pass at \`${passed.slice(0, 7)}\` carries over.`;
}
