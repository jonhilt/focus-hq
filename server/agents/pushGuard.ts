import fs from 'node:fs';
import path from 'node:path';
import type { LeadPr, LeadWork } from '../../shared/types';
import { paths } from '../config';
import { shellCommands } from './shell';

/**
 * A lead pushes their own branches, and Ops refuses the pushes that would hurt: to a base branch, or to a branch whose
 * pull request already merged (a squash merge leaves its commits off the base, so a new pull request from it would carry
 * them again). The refusal is git's own, from a pre-push hook: a local session's git is pointed at Ops' hooks through
 * its environment (`pushGuardEnv`), which outranks a repo's own `core.hooksPath` (husky's, say), and each of Ops' hooks
 * hands on to the repo's own (`bin/focus-git-hook`), so its checks still run.
 */

/** Every client-side hook git runs: each of Ops' hands on to the repo's own, so none goes missing. */
const HOOKS = [
  'applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit',
  'pre-rebase', 'post-checkout', 'post-merge', 'pre-push', 'post-rewrite', 'reference-transaction', 'push-to-checkout', 'pre-auto-gc',
  'post-index-change', 'sendemail-validate', 'fsmonitor-watchman',
];

/** The env var naming the file of what a session's pushes are refused for, a line each: `base <branch>`, `merged <branch>`, or `closing` (all of them). */
export const REFUSED_VAR = 'FOCUS_PUSH_REFUSED';

/** The file of branches `agentId`'s pushes are refused for: one that isn't there refuses none. */
export const refusedFile = (agentId: string, dir = paths.pushRefused): string => path.join(dir, agentId);

/** Writes Ops' hooks into `dir`, each running `focus-git-hook` (on the session's PATH, from `bin/`) with its name. */
export function writePushHooks(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const hook of HOOKS) {
    // renamed into place: another session starting at the same moment may be running this hook
    const temp = path.join(dir, `.${hook}.${process.pid}`);
    fs.writeFileSync(temp, `#!/bin/sh\nexec focus-git-hook ${hook} "$@"\n`, { mode: 0o755 });
    fs.renameSync(temp, path.join(dir, hook));
  }
}

/**
 * What a local session's environment needs for the guard: git's config from the environment (counted on from any the
 * session already has) pointing its hooks at `hooks`, and the file of refused branches.
 */
export function pushGuardEnv(hooks: string, refused: string, env: Record<string, string | undefined>): Record<string, string> {
  const count = Number(env.GIT_CONFIG_COUNT ?? 0) || 0;
  return { GIT_CONFIG_COUNT: String(count + 1), [`GIT_CONFIG_KEY_${count}`]: 'core.hooksPath', [`GIT_CONFIG_VALUE_${count}`]: hooks, [REFUSED_VAR]: refused };
}

/**
 * The refused-branches file for a goal's work: every repo's base branch, the branch of each pull request that merged
 * (this slice's, or one that landed before), and every push at all once the goal's closing.
 */
export function refusedPushes(work: Pick<LeadWork, 'closeStarted'> & { repos: Pick<LeadWork['repos'][number], 'baseBranch'>[]; prs: Pick<LeadPr, 'branch' | 'outcome'>[]; landed?: Pick<LeadPr, 'branch' | 'outcome'>[] }): string {
  const bases = [...new Set(work.repos.map((r) => r.baseBranch))].map((b) => `base ${b}`);
  const merged = [...new Set([...work.prs, ...(work.landed ?? [])].flatMap((p) => (p.outcome === 'merged' && p.branch ? [p.branch] : [])))].map((b) => `merged ${b}`);
  return [...(work.closeStarted ? ['closing'] : []), ...bases, ...merged].map((l) => `${l}\n`).join('');
}

/** Writes which branches `agentId`'s pushes are refused for, whole, so a restart loses nothing. */
export function writeRefused(agentId: string, work: Parameters<typeof refusedPushes>[0], dir = paths.pushRefused): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(refusedFile(agentId, dir), refusedPushes(work));
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

