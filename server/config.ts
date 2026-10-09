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
  /** The ship's log of how work went (shared/ledger.ts): appended to, never rewritten. */
  ledger: path.join(config.dataDir, 'ledger.jsonl'),
  logs: path.join(config.dataDir, 'logs'),
  mirrors: path.join(config.dataDir, 'repos'),
  workspaces: path.join(config.dataDir, 'workspaces'),
  /** Scratch worktrees where the office merges a pull request's base branch into it (outside workspaces, so the sweep leaves them be). */
  merges: path.join(config.dataDir, 'merges'),
  previews: path.join(config.dataDir, 'previews'),
  /** One reusable checkout per repo where the office runs a PR's checks itself, after a merge of its base branch (outside workspaces, so the sweep leaves them be). */
  checks: path.join(config.dataDir, 'checks'),
  /** The screenshots that go with QA reports, for the QA station. */
  qaShots: path.join(config.dataDir, 'qa-shots'),
  /** What each goal's lead has put on their station's screen, a folder per lead, until the goal closes. */
  artifacts: path.join(config.dataDir, 'artifacts'),
  /** Read-only checkouts of each project's repos at their default branch, for the planner. */
  planning: path.join(config.dataDir, 'planning'),
  /** The chief engineer's retros: the evidence gathered for each, and what came of it. */
  retros: path.join(config.dataDir, 'retros'),
  /** Where Claude Code keeps session transcripts, the agents' among them (one folder per working directory). */
  transcripts: path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects'),
  /** The terminals the office opens to start agents' cloud sessions: each one's script and what it showed, a folder per agent. */
  cloudTerminals: path.join(config.dataDir, 'cloud-terminals'),
  /** The office's layer of dcg configuration for its agents' sessions (server/agents/scratch.ts). */
  dcgConfig: path.join(config.dataDir, 'dcg.toml'),
  /** Speech models: whisper for dictation, Kokoro for the crew's voices. */
  models: path.join(config.dataDir, 'models'),
};

/** whisper.cpp's CLI and model for dictation (see server/voice.ts). */
export const whisper = {
  bin: process.env.FOCUS_WHISPER_BIN || 'whisper-cli',
  model: path.resolve(process.env.FOCUS_WHISPER_MODEL || path.join(paths.models, 'ggml-large-v3-turbo-q5_0.bin')),
  modelUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
};

/** Kokoro, the crew's voices (see server/speech.ts), run in-process through kokoro-js. */
export const kokoro = {
  model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  dtype: 'q8',
  /** transformers.js's cache: the model downloads into it once. */
  dir: path.join(paths.models, 'kokoro'),
  /** Written once the model has downloaded and loaded: transformers.js streams straight into the cache, so a download cut short looks like a model. */
  marker: path.join(paths.models, 'kokoro', 'complete'),
} as const;
