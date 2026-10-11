import { type ChildProcess, fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SpeechEngine, SpeechStatus } from '../shared/types';
import type { KokoroVoice } from '../shared/voice';
import { kokoro } from './config';

/** server/speechWorker.ts, which runs Kokoro in a process of its own. */
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'speechWorker.ts');

/** What the office asks the speech worker. */
export type ToSpeechWorker = { type: 'load' } | { type: 'speak'; id: number; text: string; voice: KokoroVoice };

/** What the speech worker tells the office. */
export type FromSpeechWorker =
  | { type: 'progress'; bytes: number; total?: number }
  | { type: 'ready' }
  | { type: 'failed'; error: string }
  | { type: 'spoken'; id: number; wav: Uint8Array }
  | { type: 'unspoken'; id: number; error: string };

/** transformers.js reports each file it fetches; the download's progress is all of them added up. */
export function downloadProgress(files: Map<string, { loaded: number; total: number }>): { bytes: number; total?: number } {
  const all = [...files.values()];
  const total = all.reduce((sum, f) => sum + f.total, 0);
  return { bytes: all.reduce((sum, f) => sum + f.loaded, 0), total: total || undefined };
}

/**
 * The crew's voices: Kokoro (82M) through kokoro-js. The model downloads once into the models folder, the first time
 * something asks for it, and stays loaded after that. Lines are spoken one at a time, so a queue of them doesn't fight
 * over the CPU.
 *
 * Kokoro runs in a child process (server/speechWorker.ts), never in the office's: once onnxruntime-node is loaded, a
 * process that exits normally aborts on macOS ("libc++abi: … mutex lock failed: Invalid argument") as onnxruntime's
 * native teardown runs, even after its session is released. Only a process that ends without that teardown is spared,
 * so the worker is ended with SIGKILL (`close`, and the worker itself when the office goes) and the office exits as
 * any other process does: its exit listeners save the state and drop the lock, and nothing aborts.
 */
export class Speech {
  private engine: SpeechEngine = { state: 'idle' };
  private worker?: ChildProcess;
  private readonly lines = new Map<number, { resolve: (wav: Buffer) => void; reject: (err: Error) => void }>();
  private nextLine = 0;

  /** `changed` tells every browser when the status moves. */
  constructor(private readonly changed: () => void) {}

  status(): SpeechStatus {
    return { downloaded: existsSync(kokoro.marker), path: kokoro.dir, engine: this.engine };
  }

  /** Downloads (if need be) and loads the model, unless it's loaded or on its way. A failed load can be tried again. */
  load(): void {
    if (this.engine.state === 'loading' || this.engine.state === 'ready') return;
    this.engine = { state: 'loading', bytes: 0 };
    this.changed();
    this.close();
    // execArgv carries tsx's loader hooks, so the worker runs TypeScript the same way this process does; 'advanced'
    // sends the WAVs back as bytes rather than JSON
    const worker = fork(WORKER, [], { execArgv: process.execArgv, serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    this.worker = worker;
    worker.on('message', (message: FromSpeechWorker) => this.received(message));
    worker.on('error', (err) => this.lost(worker, `Couldn't start Kokoro: ${err.message}`));
    worker.on('exit', () => this.lost(worker, 'Kokoro stopped'));
    this.send({ type: 'load' });
  }

  /** The line as a WAV, in the voice given. */
  speak(text: string, voice: KokoroVoice): Promise<Buffer> {
    if (this.engine.state !== 'ready') return Promise.reject(new Error('Kokoro isn’t loaded yet'));
    const id = this.nextLine++;
    return new Promise((resolve, reject) => {
      this.lines.set(id, { resolve, reject });
      this.send({ type: 'speak', id, text, voice });
    });
  }

  /** Ends the worker, if there is one: SIGKILL, so onnxruntime's teardown never runs (see above). */
  close(): void {
    const worker = this.worker;
    if (!worker) return;
    this.worker = undefined;
    worker.kill('SIGKILL');
    this.dropLines('Kokoro stopped');
  }

  private send(message: ToSpeechWorker): void {
    this.worker?.send(message);
  }

  private received(message: FromSpeechWorker): void {
    switch (message.type) {
      case 'progress':
        this.engine = { state: 'loading', bytes: message.bytes, total: message.total };
        return this.changed();
      case 'ready':
        this.engine = { state: 'ready' };
        return this.changed();
      case 'failed':
        this.engine = { state: 'failed', error: `Couldn't load Kokoro: ${message.error}` };
        this.close();
        return this.changed();
      case 'spoken':
        this.lines.get(message.id)?.resolve(Buffer.from(message.wav));
        this.lines.delete(message.id);
        return;
      case 'unspoken':
        this.lines.get(message.id)?.reject(new Error(message.error));
        this.lines.delete(message.id);
        return;
    }
  }

  /** The worker ended without being asked to: whatever it was doing fails, and loading it again starts another. */
  private lost(worker: ChildProcess, error: string): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    this.dropLines(error);
    this.engine = { state: 'failed', error };
    this.changed();
  }

  private dropLines(error: string): void {
    for (const line of this.lines.values()) line.reject(new Error(error));
    this.lines.clear();
  }
}
