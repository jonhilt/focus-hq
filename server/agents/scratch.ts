import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { mergeDenial, pushDenial } from './pushGuardRules';
import { shellCommands } from './shell';
import { SCRATCH_RM, SCRATCH_VAR, scratchRmDenial } from './scratchRules';

// Each local session's scratch dir, for throwaway files: `$FOCUS_SCRATCH`. Ops makes it when a run starts and
// deletes it when the run ends, and lets the session `rm -rf` inside it: dcg (the destructive command guard, a
// PreToolUse hook in your own settings) is told to allow exactly that command shape (`dcgConfig`), and Ops'
// own hook (`scratchRmDenial`) refuses any of those that would reach outside the dir.

export const scratchDir = (agentId: string, tmp = os.tmpdir()): string => path.join(tmp, 'focus-scratch', agentId);

/** What every local session is told about its scratch dir (the developers', QA's and the leads' prompts). */
export const SCRATCH_RULE =
  `Put throwaway files and folders (probe scripts, scratch repos, test output you won't commit) in \`$${SCRATCH_VAR}\`, never in the repo or /tmp. ` +
  `Don't clean them up: Ops deletes the folder when you finish. If you need something in it gone sooner, \`rm -rf "$${SCRATCH_VAR}/<path>"\` is the one \`rm -rf\` allowed, on its own (not chained with other commands).`;

/** A session's scratch dir, made empty, and what the session needs for it: its environment, and a hook to guard it. */
export interface Scratch {
  dir: string;
  env: Record<string, string>;
  hook: HookCallback;
  /** Deletes the dir and all that's in it. */
  close(): void;
}

/**
 * Makes `agentId`'s scratch dir (emptied of anything a run before left there) and writes Ops' dcg layer to
 * `dcgFile`. `DCG_CONFIG` points dcg at it unless you've set your own, which Ops leaves alone.
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
      // the push guard's too: a command that would skip the git hooks it rests on, or merge or approve a pull request
      const reason = typeof command === 'string' ? (scratchRmDenial(command, dir, fs.realpathSync.native) ?? pushDenial(command) ?? mergeDenial(command)) : null;
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
 * Ops' layer of dcg configuration, on top of yours and the project's (dcg reads it from `DCG_CONFIG`): allow a
 * scratch `rm`, and say what to do instead when git would throw away uncommitted changes. Each block is a narrower
 * version of one dcg's core pack already has, so Ops only changes its message, never what it blocks.
 */
export function dcgConfig(): string {
  // git, as a command of its own: at the start, or after a separator (not in an echo or a commit message)
  const GIT = String.raw`(?:^|[;&|(]\s*)git\s+`;
  const toml = (s: string) => `'''${s}'''`;
  const block = (pattern: string, reason: string) => `  { pattern = ${toml(pattern)}, reason = ${toml(reason)} },`;
  return [
    '# Written by Ops for its agents\' sessions (server/agents/scratch.ts): overwritten at every session.',
    '[overrides]',
    `allow = [ ${toml(SCRATCH_RM)} ]`,
    'block = [',
    block(String.raw`${GIT}checkout(?:\s+[^-\s;&|]\S*|\s+--ours|\s+--theirs)*\s+--\s+[^\s;&|]`, `git checkout -- <file> throws away uncommitted changes, so it stays blocked. ${UNDO}`),
    block(String.raw`${GIT}restore\s+(?:-W\s+|--worktree\s+)?[^-\s;&|]`, `git restore <file> throws away uncommitted changes, so it stays blocked (git restore --staged <file> is fine). ${UNDO}`),
    ']',
    '',
  ].join('\n');
}

/** What runs a script: an interpreter, after any runner (npx tsx …) or subcommand (go run …) in front of it. */
const INTERPRETERS = new Set(['node', 'tsx', 'ts-node', 'bun', 'deno', 'python', 'python3', 'ruby', 'perl', 'bash', 'sh', 'zsh', 'php', 'go', 'vitest', 'playwright']);
const RUNNERS = new Set(['npx', 'pnpm', 'pnpx', 'bunx', 'yarn', 'exec', 'dlx', 'run', 'time', 'env', 'nohup', 'timeout', 'test']);

/**
 * The script a Bash `command` runs from the scratch dir `dir` (its path there), when it runs one: a probe the session
 * sent out to try something. `node "$FOCUS_SCRATCH/probe.mjs"`, `npx tsx $FOCUS_SCRATCH/render.ts`, `python3 x.py` after a
 * `cd` into it, or the script itself; not writing one, listing or removing them, or a heredoc's body.
 */
export function scratchScript(command: string, dir: string): string | undefined {
  const inside = (word: string) => {
    for (const root of [`$${SCRATCH_VAR}/`, `\${${SCRATCH_VAR}}/`, `${dir}/`]) if (word.startsWith(root)) return word.slice(root.length);
    return undefined;
  };
  let here = false;
  for (const words of shellCommands(command)) {
    while (words.length && /^\w+=/.test(words[0])) words.shift();
    if (!words.length) continue;
    if (words[0] === 'cd') {
      here = words[1] !== undefined && inside(`${words[1].replace(/\/$/, '')}/`) !== undefined;
      continue;
    }
    // the script itself, run directly
    const direct = inside(words[0]) ?? (here && words[0].startsWith('./') ? words[0].slice(2) : undefined);
    if (direct) return direct;
    let i = 0;
    while (i < words.length && (RUNNERS.has(words[i]) || words[i].startsWith('-') || /^\d+[smh]?$/.test(words[i]))) i++;
    if (!INTERPRETERS.has(words[i])) continue;
    const script = words.slice(i + 1).find((w) => !w.startsWith('-') && w !== 'run');
    if (!script) continue;
    const found = inside(script) ?? (here && !/^[/$]/.test(script) && /\.\w+$/.test(script) ? script.replace(/^\.\//, '') : undefined);
    if (found) return found;
  }
  return undefined;
}
