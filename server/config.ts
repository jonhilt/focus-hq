import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = new Set(process.argv.slice(2));
const demo = argv.has('--demo') || process.env.FOCUS_MODE === 'demo';

export const config = {
  /** The Focus checkout itself. */
  root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  port: Number(process.env.PORT ?? 4477),
  host: process.env.HOST ?? '127.0.0.1',
  /** --dev serves the client through Vite with hot reload. */
  dev: argv.has('--dev'),
  /** --demo (or FOCUS_MODE=demo) fakes GitHub and the agents so you can look around without credentials. */
  demo,
  /**
   * State, logs, repo clones and agent worktrees. Deliberately outside this repo: agents working in a worktree under
   * it would otherwise pick up this project's CLAUDE.md from a parent directory.
   */
  dataDir: path.resolve(process.env.FOCUS_DATA_DIR ?? path.join(os.homedir(), '.focus')),
  /** How often each project's issues and pull requests are re-read from GitHub. */
  boardRefreshMs: Number(process.env.FOCUS_BOARD_REFRESH_MS ?? 60_000),
  /** Pull, rebuild and restart when the checkout's upstream branch moves. Off in demo mode or with FOCUS_AUTO_UPDATE=0. */
  autoUpdate: process.env.FOCUS_AUTO_UPDATE !== '0' && !demo,
  /** How often auto update fetches the upstream branch. */
  updateCheckMs: Number(process.env.FOCUS_UPDATE_CHECK_MS ?? 5 * 60_000),
};

export const paths = {
  state: path.join(config.dataDir, 'state.json'),
  logs: path.join(config.dataDir, 'logs'),
  mirrors: path.join(config.dataDir, 'repos'),
  workspaces: path.join(config.dataDir, 'workspaces'),
  previews: path.join(config.dataDir, 'previews'),
  /** Read-only checkouts of each project's repos at their default branch, for the planner. */
  planning: path.join(config.dataDir, 'planning'),
};
