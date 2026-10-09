import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';

/**
 * Each local session's scratch dir, for throwaway files: `$FOCUS_SCRATCH`. The office makes it when a run starts and
 * deletes it when the run ends, and lets the session `rm -rf` inside it: dcg (the destructive command guard, a
 * PreToolUse hook in your own settings) is told to allow exactly that command shape (`dcgConfig`), and the office's
 * own hook (`scratchRmDenial`) refuses any of those that would reach outside the dir.
 */
export const SCRATCH_VAR = 'FOCUS_SCRATCH';

export const scratchDir = (agentId: string, tmp = os.tmpdir()): string => path.join(tmp, 'focus-scratch', agentId);

// $FOCUS_SCRATCH or ${FOCUS_SCRATCH}, a slash, then a path with no quoting, globbing, expansion or command in it.
// Written once for both JavaScript and dcg's Rust regexes: plain classes and groups, no lookarounds.
const VAR = String.raw`(?:\$FOCUS_SCRATCH|\$\{FOCUS_SCRATCH\})/`;
const QUOTED = String.raw`"${VAR}([^"$` + '`' + String.raw`\\*?\[\]{}~]+)"`;
const BARE = VAR + String.raw`([^\s"'$` + '`' + String.raw`\\*?\[\]{}~;&|<>()!#]+)`;
const TARGET = `(?:${QUOTED}|${BARE})`;

/** A whole command that's only `rm` (any short flags) of paths in the scratch dir. Nothing chained before or after. */
export const SCRATCH_RM = String.raw`^\s*rm(?:\s+-[a-zA-Z]+)*(?:\s+${TARGET})+\s*$`;

/** The paths (relative to the scratch dir) a scratch `rm` removes, or null when `command` isn't one. */
export function scratchRmTargets(command: string): string[] | null {
  if (!new RegExp(SCRATCH_RM).test(command)) return null;
  return [...command.matchAll(new RegExp(TARGET, 'g'))].map((m) => m[1] ?? m[2]);
}

/** Where `p` really is: symlinks followed as far as it exists, the rest appended as written. */
function resolveReal(p: string, realpath: (p: string) => string): string {
  const rest: string[] = [];
  for (let dir = p; ; dir = path.dirname(dir)) {
    try {
      return path.join(realpath(dir), ...rest);
    } catch {
      if (path.dirname(dir) === dir) return p;
      rest.unshift(path.basename(dir));
    }
  }
}

/**
 * Whether `rel` (as written after `$FOCUS_SCRATCH/`) is inside `scratch` and not the dir itself. Any `..` is refused
 * outright (the shell resolves it after symlinks, not as written), and so is a path whose symlinks lead outside.
 */
export function insideScratch(rel: string, scratch: string, realpath: (p: string) => string = fs.realpathSync.native): boolean {
  if (rel.split('/').includes('..')) return false;
  let root: string;
  try {
    root = realpath(scratch);
  } catch {
    return false;
  }
  const real = resolveReal(path.join(scratch, rel), realpath);
  return real.startsWith(root + path.sep) && real !== root;
}

/** Why the office refuses a scratch `rm` that reaches outside the scratch dir; null for any other command, or a safe one. */
export function scratchRmDenial(command: string, scratch: string, realpath?: (p: string) => string): string | null {
  const targets = scratchRmTargets(command);
  const outside = targets?.filter((t) => !insideScratch(t, scratch, realpath)) ?? [];
  if (!outside.length) return null;
  return `Refused by the Focus office: ${outside.map((t) => `$${SCRATCH_VAR}/${t}`).join(', ')} isn't inside your scratch dir (no "..", and no symlinks leading out of it). Delete only what's in $${SCRATCH_VAR}, and leave anything else where it is.`;
}

/** What every local session is told about its scratch dir (the developers', QA's and the leads' prompts). */
export const SCRATCH_RULE =
  `Put throwaway files and folders (probe scripts, scratch repos, test output you won't commit) in \`$${SCRATCH_VAR}\`, never in the repo or /tmp. ` +
  `Don't clean them up: the office deletes the folder when you finish. If you need something in it gone sooner, \`rm -rf "$${SCRATCH_VAR}/<path>"\` is the one \`rm -rf\` allowed, on its own (not chained with other commands).`;

/** A session's scratch dir, made empty, and what the session needs for it: its environment, and a hook to guard it. */
export interface Scratch {
  dir: string;
  env: Record<string, string>;
  hook: HookCallback;
  /** Deletes the dir and all that's in it. */
  close(): void;
}

/**
 * Makes `agentId`'s scratch dir (emptied of anything a run before left there) and writes the office's dcg layer to
 * `dcgFile`. `DCG_CONFIG` points dcg at it unless you've set your own, which the office leaves alone.
 */
export function openScratch(agentId: string, dcgFile: string, env: NodeJS.ProcessEnv = process.env): Scratch {
  const dir = scratchDir(agentId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.dirname(dcgFile), { recursive: true });
  fs.writeFileSync(dcgFile, dcgConfig());
  return {
    dir,
    env: { [SCRATCH_VAR]: dir, ...(!env.DCG_CONFIG && { DCG_CONFIG: dcgFile }) },
    hook: (input) => {
      const command = input.hook_event_name === 'PreToolUse' ? (input.tool_input as { command?: unknown } | undefined)?.command : undefined;
      const reason = typeof command === 'string' ? scratchRmDenial(command, dir) : null;
      return Promise.resolve(reason ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } } : {});
    },
    close: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // left for the OS to clear out of the temp dir; the next run of this agent empties it anyway
      }
    },
  };
}

const UNDO =
  `To undo your own edits to a file, save them and reverse them: \`git diff -- <file> > "$${SCRATCH_VAR}/undo.patch" && git apply -R "$${SCRATCH_VAR}/undo.patch"\`, or undo them with the Edit tool. ` +
  "Don't use git stash: its stack is shared with every other worktree of the repo. If the changes aren't yours to drop, leave them and say so (to the lead, or in your summary).";

/**
 * The office's layer of dcg configuration, on top of yours and the project's (dcg reads it from `DCG_CONFIG`): allow a
 * scratch `rm`, and say what to do instead when git would throw away uncommitted changes. Each block is a narrower
 * version of one dcg's core pack already has, so the office only changes its message, never what it blocks.
 */
export function dcgConfig(): string {
  // git, as a command of its own: at the start, or after a separator (not in an echo or a commit message)
  const GIT = String.raw`(?:^|[;&|(]\s*)git\s+`;
  const toml = (s: string) => `'''${s}'''`;
  const block = (pattern: string, reason: string) => `  { pattern = ${toml(pattern)}, reason = ${toml(reason)} },`;
  return [
    '# Written by the Focus office for its agents\' sessions (server/agents/scratch.ts): overwritten at every session.',
    '[overrides]',
    `allow = [ ${toml(SCRATCH_RM)} ]`,
    'block = [',
    block(String.raw`${GIT}checkout(?:\s+[^-\s;&|]\S*|\s+--ours|\s+--theirs)*\s+--\s+[^\s;&|]`, `git checkout -- <file> throws away uncommitted changes, so it stays blocked. ${UNDO}`),
    block(String.raw`${GIT}restore\s+(?:-W\s+|--worktree\s+)?[^-\s;&|]`, `git restore <file> throws away uncommitted changes, so it stays blocked (git restore --staged <file> is fine). ${UNDO}`),
    ']',
    '',
  ].join('\n');
}
