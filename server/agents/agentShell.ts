import fs from 'node:fs';

export const BASH = '/bin/bash';

/**
 * `env` with Claude Code's Bash tool set to run in bash (`CLAUDE_CODE_SHELL`). Left to itself it picks the user's
 * shell, zsh on a Mac, where a glob that matches nothing (`grep -r x --include=*.ts`, `ls server/**\/*.test.ts`) is an
 * error that skips the command ("no matches found"), the commonest failed Bash call in the ledger; bash passes it on
 * as it is. A shell the captain set is kept, and Windows is left alone (Claude Code runs Git Bash there).
 */
export function withBash(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = fs.existsSync,
): Record<string, string | undefined> {
  if (env.CLAUDE_CODE_SHELL || platform === 'win32' || !exists(BASH)) return env;
  return { ...env, CLAUDE_CODE_SHELL: BASH };
}
