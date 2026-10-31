import type { LeadPr, LeadWork } from '../../shared/types';
import { shellCommands } from './shell';

// What a lead's pushes are refused for, whether a git command would skip Ops' hooks, and whether a gh command would
// merge or approve a pull request. Pure, so it's unit tested (pushGuardRules.test.ts); pushGuard.ts writes the
// refused-branches file and the hooks that read it, and scratch.ts's Bash guard refuses what `pushDenial` and
// `mergeDenial` say.

/**
 * The refused-branches file for a goal's work: every repo's base branch, the branch of each pull request that merged
 * (this slice's, or one that landed before), and every push at all once the goal's closing.
 */
export function refusedPushes(work: Pick<LeadWork, 'closeStarted'> & { repos: Pick<LeadWork['repos'][number], 'baseBranch'>[]; prs: Pick<LeadPr, 'branch' | 'outcome'>[]; landed?: Pick<LeadPr, 'branch' | 'outcome'>[] }): string {
  const bases = [...new Set(work.repos.map((r) => r.baseBranch))].map((b) => `base ${b}`);
  const merged = [...new Set([...work.prs, ...(work.landed ?? [])].flatMap((p) => (p.outcome === 'merged' && p.branch ? [p.branch] : [])))].map((b) => `merged ${b}`);
  return [...(work.closeStarted ? ['closing'] : []), ...bases, ...merged].map((l) => `${l}\n`).join('');
}

/** Why Ops refuses a git command that would skip the hooks (`--no-verify`, or its own `core.hooksPath`); null for any other. */
export function pushDenial(command: string): string | null {
  const skips = shellCommands(command).some((words) => {
    const at = words.indexOf('git');
    if (at < 0) return false;
    const rest = words.slice(at + 1);
    return rest.some((w) => /core\.hookspath/i.test(w)) || (rest.includes('push') && rest.includes('--no-verify'));
  });
  return skips ? 'Refused by Ops: pushes go through the hooks, so leave out --no-verify and core.hooksPath. If a hook of the repo\'s own fails, fix what it found.' : null;
}

/** `gh pr <sub>` somewhere in `words`, as gh has it: the subcommand right after `pr`. */
const prSub = (words: string[], sub: string) => words.some((w, i) => w === 'pr' && words[i + 1] === sub);

/**
 * `gh pr review`'s approve, on its own (`--approve`, `-a`) or among short flags (`-ab "Fine"`): read left to right up to
 * one that takes a value (`-b`, `-F`), since the rest of the word is that value.
 */
function approves(word: string): boolean {
  if (word === '--approve') return true;
  if (!/^-[A-Za-z]/.test(word)) return false;
  for (const flag of word.slice(1)) {
    if (flag === 'a') return true;
    if (flag === 'b' || flag === 'F') return false;
  }
  return false;
}

/** A `gh api` call that merges a pull request, turns on its auto-merge, or approves it. */
const apiMerges = (words: string[]) =>
  words[0] === 'api' &&
  words.some(
    // a field as its own word or run into its flag (`-f event=APPROVE`, `-fevent=APPROVE`, `--field=event=APPROVE`)
    (w) => /\/pulls\/[^/\s]+\/merge\b/.test(w) || /\b(?:mergePullRequest|enablePullRequestAutoMerge|addPullRequestReview\b[\s\S]*\bAPPROVE)\b/.test(w) || /(?:^|[-=f])event=APPROVE$/i.test(w),
  );

/**
 * Why Ops refuses a gh command that would merge or approve a pull request (`gh pr merge`, `gh pr review --approve`,
 * or the same through `gh api`); null for any other. Only Ops or the user merges: Ops at the commit QA passed, in its lane.
 */
export function mergeDenial(command: string): string | null {
  const merges = shellCommands(command).some((words) => {
    // gh by name or by path (`/opt/homebrew/bin/gh`)
    const at = words.findIndex((w) => w === 'gh' || w.endsWith('/gh'));
    if (at < 0) return false;
    const rest = words.slice(at + 1);
    return prSub(rest, 'merge') || (prSub(rest, 'review') && rest.some(approves)) || apiMerges(rest);
  });
  return merges
    ? 'Refused by Ops: only Ops or the user merges or approves a pull request. Mark it ready (`gh pr ready`): QA reviews it, and Ops merges it at the commit QA passed when its lane allows, or the user does.'
    : null;
}
