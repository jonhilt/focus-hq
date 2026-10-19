// What a replayed QA review may run, and what's left to stop after it (tools/qaReview.ts). Pure, so it's unit tested
// (replayRules.test.ts). The clones are of old builds, whose instructions say to run the office (`npm run demo`,
// `pnpm dev`) on its own port and data folder, 4477 and ~/.focus: the live office's.

import path from 'node:path';

/** The environment QA's session runs in: a port and a data folder of the review's own, and no updating itself. */
export function reviewEnv(base: NodeJS.ProcessEnv, port: number, dataDir: string): NodeJS.ProcessEnv {
  return { ...base, PORT: String(port), HOST: '127.0.0.1', FOCUS_DATA_DIR: dataDir, FOCUS_AUTO_UPDATE: '0' };
}

/**
 * The processes whose working directory is `dir` or inside it, from `lsof -d cwd -Fpn` (a `p<pid>` line, then an
 * `n<path>` line, per process), leaving out `self`: what a review left running in its clone.
 */
export function processesIn(lsof: string, dir: string, self: number): number[] {
  const pids: number[] = [];
  let pid: number | undefined;
  for (const line of lsof.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== undefined && pid !== self) {
      const cwd = line.slice(1);
      if (cwd === dir || cwd.startsWith(dir + path.sep)) pids.push(pid);
    }
  }
  return [...new Set(pids)];
}
