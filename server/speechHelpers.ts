import { fork, spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { kokoro } from './config';
import type { FromSpeechWorker, ToSpeechWorker } from './speech';
import { withoutSecrets } from './secrets';
import { fieldsOf } from '../shared/records';

// The processes Kokoro can run in, for server/speech.ts: on the Apple GPU through mlx-audio (server/speechMlx.py),
// which the agents' work on the CPU doesn't slow, or on the CPU through kokoro-js (server/speechWorker.ts). Each takes
// the same messages, so the queue in front of them is the same whichever runs.

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where a helper runs Kokoro: the Apple GPU, or the CPU. */
export type SpeechOn = 'gpu' | 'cpu';

/** A running helper: tell it something, or end it (SIGKILL, so no native teardown runs; see server/speech.ts). */
export interface SpeechProcess {
  send(message: ToSpeechWorker): void;
  kill(): void;
}

/** What a helper tells whoever started it: its messages, and that it's gone (crashed, or couldn't start). */
export interface SpeechListener {
  message(message: FromSpeechWorker): void;
  gone(error: string): void;
}

export interface SpeechHelper {
  on: SpeechOn;
  start(listener: SpeechListener): SpeechProcess;
}

/**
 * Which helpers to try, in order: the GPU first where it can run (Apple Silicon, with uv to set up its Python), then the
 * CPU, which runs anywhere. A helper that can't load hands over to the next. `gpu` is Settings' speechGpu: false keeps it on the CPU.
 */
export function speechHelpers(machine: { platform: string; arch: string; uv: boolean; gpu?: boolean }): SpeechOn[] {
  return machine.gpu !== false && machine.platform === 'darwin' && machine.arch === 'arm64' && machine.uv ? ['gpu', 'cpu'] : ['cpu'];
}

/** One line of the GPU helper's stdout as a message (its WAVs come base64); anything else it printed, undefined. */
export function fromHelperLine(line: string): FromSpeechWorker | undefined {
  if (!line.startsWith('{')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  const m = fieldsOf(parsed);
  const id = typeof m.id === 'number' ? m.id : -1;
  switch (m.type) {
    case 'ready':
      return { type: 'ready' };
    case 'failed':
      return { type: 'failed', error: String(m.error ?? 'failed') };
    case 'spoken':
      return typeof m.wav === 'string' ? { type: 'spoken', id, wav: new Uint8Array(Buffer.from(m.wav, 'base64')) } : undefined;
    case 'unspoken':
      return { type: 'unspoken', id, error: String(m.error ?? 'failed') };
    default:
      return undefined;
  }
}

/** Kokoro on the CPU: kokoro-js in a Node process of its own. */
export const cpuKokoro: SpeechHelper = {
  on: 'cpu',
  start(listener) {
    // execArgv carries tsx's loader hooks, so the worker runs TypeScript the same way this process does; 'advanced'
    // sends the WAVs back as bytes rather than JSON
    const worker = fork(path.join(here, 'speechWorker.ts'), [], { execArgv: process.execArgv, serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    worker.on('message', (message: FromSpeechWorker) => listener.message(message));
    worker.on('error', (err) => listener.gone(`Couldn't start Kokoro: ${err.message}`));
    worker.on('exit', () => listener.gone('Kokoro stopped'));
    return { send: (message) => worker.send(message), kill: () => worker.kill('SIGKILL') };
  },
};

/**
 * The GPU helper's Python packages, pinned: uv installs them once into its cache (a few hundred MB, with torch), and
 * the model (about 350 MB) downloads into the models folder the first time it loads.
 */
const MLX_PACKAGES = [
  'mlx-audio==0.5.9',
  'misaki[en]==0.9.4',
  'en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl',
];

/** Kokoro on the Apple GPU: mlx-audio in a Python process uv sets up (`uv` is its path). */
export function gpuKokoro(uv: string): SpeechHelper {
  return {
    on: 'gpu',
    start(listener) {
      const args = ['run', '--quiet', '--no-project', '--python', '3.12', ...MLX_PACKAGES.flatMap((p) => ['--with', p]), 'python', path.join(here, 'speechMlx.py')];
      const child = spawn(uv, args, {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...withoutSecrets(), HF_HOME: kokoro.gpuDir, HF_HUB_DISABLE_PROGRESS_BARS: '1', TOKENIZERS_PARALLELISM: 'false' },
      });
      createInterface({ input: child.stdout }).on('line', (line) => {
        const message = fromHelperLine(line);
        if (message) listener.message(message);
      });
      child.on('error', (err) => listener.gone(`Couldn't start Kokoro on the GPU: ${err.message}`));
      child.on('exit', () => listener.gone('Kokoro on the GPU stopped'));
      // its stdin closing as it goes would otherwise throw
      child.stdin.on('error', () => undefined);
      return { send: (message) => void child.stdin.write(`${JSON.stringify(message)}\n`), kill: () => child.kill('SIGKILL') };
    },
  };
}
