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
  /** How often auto update fetches the upstream branch. */
  updateCheckMs: Number(process.env.FOCUS_UPDATE_CHECK_MS ?? 5 * 60_000),
  /**
   * FOCUS_PLUGINS, the plugins to switch on (docs/plugins.md): names of folders under plugins/, paths to plugin folders
   * anywhere, or `all` for every one under plugins/. Where it's set, it overrides the captain's choice in the ready room
   * (`pluginChoice` in shared/shipPluginRules.ts).
   */
  pluginsEnv: process.env.FOCUS_PLUGINS,
};

export const paths = {
  state: path.join(config.dataDir, 'state.json'),
  /** What the captain sets that mustn't reach the browser or the agents, the bot's token among them (server/secrets.ts). */
  secrets: path.join(config.dataDir, 'secrets.env'),
  /** The ship's log of how work went (shared/ledger.ts): appended to, never rewritten. */
  ledger: path.join(config.dataDir, 'ledger.jsonl'),
  logs: path.join(config.dataDir, 'logs'),
  /** The captain's personal log (shared/personalLog.ts): what they jotted down to come back to, appended and flushed, never rewritten. */
  personalLog: path.join(config.dataDir, 'personal-log.jsonl'),
  /** Each agent's run journal (server/agents/runJournal.ts): the facts of its turns and inbox, appended and flushed, never rewritten. */
  runs: path.join(config.dataDir, 'runs'),
  /** How the 3D view ran in each browser opened with ?stats=1 (server/frameStats.ts): a file per page load. */
  frameStats: path.join(config.dataDir, 'frame-stats'),
  mirrors: path.join(config.dataDir, 'repos'),
  workspaces: path.join(config.dataDir, 'workspaces'),
  /** Scratch worktrees where Ops merges a pull request's base branch into it (outside workspaces, so the sweep leaves them be). */
  merges: path.join(config.dataDir, 'merges'),
  previews: path.join(config.dataDir, 'previews'),
  /** One reusable checkout per repo where Ops runs a PR's checks itself, after a merge of its base branch (outside workspaces, so the sweep leaves them be). */
  checks: path.join(config.dataDir, 'checks'),
  /** The screenshots that go with QA reports, for the QA station. */
  qaShots: path.join(config.dataDir, 'qa-shots'),
  /** The images sessions' tool results gave back, named by their content (server/sessionImages.ts). */
  sessionImages: path.join(config.dataDir, 'session-images'),
  /** What each goal's lead has put on their station's screen, a folder per lead, until the goal closes. */
  artifacts: path.join(config.dataDir, 'artifacts'),
  /** Read-only checkouts of each project's repos at their default branch, for the planner. */
  planning: path.join(config.dataDir, 'planning'),
  /** Where Claude Code keeps session transcripts, the agents' among them (one folder per working directory). */
  transcripts: path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects'),
  /** The git hooks every local session's git runs, which refuse a lead's harmful pushes and hand on to the repo's own (server/agents/pushGuard.ts). */
  gitHooks: path.join(config.dataDir, 'git-hooks'),
  /** The branches each lead's pushes are refused for, a file per lead, rewritten as their goal's work changes (server/agents/pushGuard.ts). */
  pushRefused: path.join(config.dataDir, 'push-refused'),
  /** Ops' layer of dcg configuration for its agents' sessions (server/agents/scratch.ts). */
  dcgConfig: path.join(config.dataDir, 'dcg.toml'),
  /** Speech models: whisper for dictation, Kokoro for the crew's voices. */
  models: path.join(config.dataDir, 'models'),
};

/** whisper.cpp's model for dictation (see server/voice.ts) unless Settings name another, and where it's downloaded from. */
export const whisper = {
  model: path.join(paths.models, 'ggml-large-v3-turbo-q5_0.bin'),
  modelUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
};

/**
 * Previews' ports mirrored where other machines reach them (server/previewMirrors.ts), on the addresses Settings name
 * (`previewHosts`). With a certificate and key (from `tailscale cert`), the mirrors serve https.
 */
export const previewMirrors = {
  cert: path.resolve(process.env.FOCUS_PREVIEW_CERT || path.join(config.dataDir, 'tls', 'preview.crt')),
  key: path.resolve(process.env.FOCUS_PREVIEW_KEY || path.join(config.dataDir, 'tls', 'preview.key')),
};

/** Kokoro, the crew's voices (see server/speech.ts), run on the Apple GPU (server/speechMlx.py) or through kokoro-js on the CPU (server/speechWorker.ts), each in a process of its own. */
export const kokoro = {
  model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  dtype: 'q8',
  /** transformers.js's cache: the model downloads into it once. */
  dir: path.join(paths.models, 'kokoro'),
  /** Written once the model has downloaded and loaded: transformers.js streams straight into the cache, so a download cut short looks like a model. */
  marker: path.join(paths.models, 'kokoro', 'complete'),
  /** Hugging Face's cache for Kokoro on the Apple GPU (mlx-audio, server/speechMlx.py): its model downloads there once. */
  gpuDir: path.join(paths.models, 'kokoro-mlx'),
  /** Written once Kokoro has loaded on the GPU, so Focus knows the voices are there to load as it starts. */
  gpuMarker: path.join(paths.models, 'kokoro-mlx', 'complete'),
} as const;
