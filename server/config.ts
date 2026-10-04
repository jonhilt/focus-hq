import os from 'node:os';
import path from 'node:path';

const argv = new Set(process.argv.slice(2));

export const config = {
  port: Number(process.env.PORT ?? 4477),
  host: process.env.HOST ?? '127.0.0.1',
  /** --dev serves the client through Vite with hot reload. */
  dev: argv.has('--dev'),
  /** --demo (or FOCUS_MODE=demo) fakes GitHub and the agents so you can look around without credentials. */
  demo: argv.has('--demo') || process.env.FOCUS_MODE === 'demo',
  /**
   * State, logs, repo clones and agent worktrees. Deliberately outside this repo: agents working in a worktree under
   * it would otherwise pick up this project's CLAUDE.md from a parent directory.
   */
  dataDir: path.resolve(process.env.FOCUS_DATA_DIR ?? path.join(os.homedir(), '.focus')),
  /** How often each project's issues and pull requests are re-read from GitHub. */
  boardRefreshMs: Number(process.env.FOCUS_BOARD_REFRESH_MS ?? 60_000),
};

export const paths = {
  state: path.join(config.dataDir, 'state.json'),
  logs: path.join(config.dataDir, 'logs'),
  mirrors: path.join(config.dataDir, 'repos'),
  workspaces: path.join(config.dataDir, 'workspaces'),
};
