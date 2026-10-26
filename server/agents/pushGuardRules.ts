import type { LeadPr, LeadWork } from '../../shared/types';
import { shellCommands } from './shell';

// What a lead's pushes are refused for, and whether a git command would skip Ops' hooks. Pure, so it's unit tested
// (pushGuardRules.test.ts); pushGuard.ts writes the refused-branches file and the hooks that read it, and scratch.ts's
// Bash guard refuses what `pushDenial` says.

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
