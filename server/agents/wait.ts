import path from 'node:path';
import { config } from '../config';

/**
 * Where the office's helpers for its agents' shells live (`bin/` in the Focus checkout): `focus-wait`, which polls a
 * condition until it's true or a timeout passes. Claude Code refuses a foreground `sleep N; cmd`, which agents kept
 * writing to wait for a demo, a build or a log, and left them to guess another way.
 */
export const WAIT_BIN = path.join(config.root, 'bin');

/** `env` with the office's helpers first on its PATH. */
export function withWaitHelper(env: Record<string, string | undefined>, bin = WAIT_BIN): Record<string, string | undefined> {
  return { ...env, PATH: env.PATH ? `${bin}${path.delimiter}${env.PATH}` : bin };
}

/** What every local session is told about waiting (the developers', QA's and the leads' prompts). */
export const WAIT_RULE =
  'To wait for something (a server to answer, a build to finish, a line in a log), don\'t write `sleep N; <check>`: Claude Code refuses a foreground sleep. ' +
  'Run `focus-wait --until \'<check>\' --timeout 120` instead (e.g. `focus-wait --until \'curl -sf -m 2 localhost:4477/api/state >/dev/null\' --timeout 120`): ' +
  'it runs the check every 2 s (`--every`), returns as soon as it passes, and fails with the check\'s last output when time runs out.';
