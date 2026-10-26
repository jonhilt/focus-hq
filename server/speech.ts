import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { SpeechEngine, SpeechStatus } from '../shared/types';
import { KOKORO_VOICES, type KokoroVoice } from '../shared/voice';
import { kokoro } from './config';
import { cpuKokoro, type SpeechHelper, type SpeechProcess } from './speechHelpers';
import { type LineUrgency, nextLine } from './speechRules';

interface Line {
  id: number;
  text: string;
  voice: KokoroVoice;
  urgency: LineUrgency;
  resolve: (wav: Buffer) => void;
  reject: (err: Error) => void;
}

/** What Focus asks the speech worker. */
export type ToSpeechWorker = { type: 'load'; voices?: readonly KokoroVoice[] } | { type: 'speak'; id: number; text: string; voice: KokoroVoice };

/** What the speech worker tells Focus. */
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

/** Remembers that Kokoro has loaded on the GPU (its model's there), so `status` says the voices are downloaded. */
function markLoadedOnGpu(): void {
  try {
    mkdirSync(kokoro.gpuDir, { recursive: true });
    writeFileSync(kokoro.gpuMarker, '');
  } catch {
    // only Focus's warm start misses it
  }
}

/**
 * The crew's voices: Kokoro (82M), on the Apple GPU where it can run there, otherwise on the CPU through kokoro-js
 * (`helpers`, tried in turn: one that can't load hands over to the next; server/speechHelpers.ts). On the GPU it keeps
 * up however busy the agents keep the CPU. The model downloads once into the models folder, the first time something
 * asks for it, and stays loaded after that. Lines are spoken one at a time, so a queue of them doesn't fight over it.
 *
 * Kokoro runs in a child process, never in Focus's: once onnxruntime-node is loaded, a
 * process that exits normally aborts on macOS ("libc++abi: … mutex lock failed: Invalid argument") as onnxruntime's
 * native teardown runs, even after its session is released. Only a process that ends without that teardown is spared,
 * so the worker is ended with SIGKILL (`close`, and the worker itself when Focus goes) and Focus exits as
 * any other process does: its exit listeners save the state and drop the lock, and nothing aborts.
 */
export class Speech {
  private engine: SpeechEngine = { state: 'idle' };
  private worker?: SpeechProcess;
  /** Lines waiting their turn, and the one Kokoro is saying (its id), one at a time so they don't fight over the CPU. */
  private waiting: Line[] = [];
  private saying: Line | undefined;
  private lineIds = 0;

  /** `changed` tells every browser when the status moves. */
  constructor(
    private readonly changed: () => void,
    private readonly helpersHere: () => readonly SpeechHelper[] = () => [cpuKokoro],
  ) {}

  /** The helpers this load tries, chosen as it starts (Settings may have moved Kokoro off the GPU since). */
  private helpers: readonly SpeechHelper[] = [];

  status(): SpeechStatus {
    const gpu = existsSync(kokoro.gpuMarker);
    return { downloaded: gpu || existsSync(kokoro.marker), path: gpu ? kokoro.gpuDir : kokoro.dir, engine: this.engine };
  }

  /** Downloads (if need be) and loads the model, unless it's loaded or on its way. A failed load can be tried again. */
  load(): void {
    if (this.engine.state === 'loading' || this.engine.state === 'ready') return;
    this.engine = { state: 'loading', bytes: 0 };
    this.changed();
    this.close();
    this.helpers = this.helpersHere();
    this.start(0);
  }

  /** Loads Kokoro again, on the helpers as they are now, if it's loaded or on its way; otherwise the next load will. */
  reload(): void {
    if (this.engine.state !== 'loading' && this.engine.state !== 'ready') return;
    this.close();
    this.engine = { state: 'idle' };
    this.load();
  }

  /** Starts the helper at `at`; if it can't load, the next one, until there are none left to try. */
  private start(at: number): void {
    const helper = this.helpers[at];
    let ready = false;
    // a helper only speaks up once it's started (its messages come in later), so the closures can name it
    // eslint-disable-next-line prefer-const
    let worker: SpeechProcess | undefined;
    const handOver = (error: string) => {
      if (this.worker !== worker) return;
      if (at + 1 < this.helpers.length) {
        this.worker = undefined;
        worker?.kill();
        return this.start(at + 1);
      }
      this.lost(error);
    };
    worker = helper.start({
      message: (message) => {
        if (this.worker !== worker) return;
        if (!ready && message.type === 'failed') return handOver(`Couldn't load Kokoro: ${message.error}`);
        if (message.type === 'ready') {
          ready = true;
          if (helper.on === 'gpu') markLoadedOnGpu();
        }
        this.received(message, helper.on);
      },
      gone: (error) => (ready ? this.worker === worker && this.lost(error) : handOver(error)),
    });
    this.worker = worker;
    this.send({ type: 'load', voices: KOKORO_VOICES });
  }

  /**
   * The line as a WAV, in the voice given. Lines wanted now go ahead of those fetched ahead of time (`nextLine`); one
   * whose `signal` aborts while it waits is dropped (whoever wanted it has gone), and one already being said finishes.
   */
  speak(text: string, voice: KokoroVoice, urgency: LineUrgency = 'now', signal?: AbortSignal): Promise<Buffer> {
    if (this.engine.state !== 'ready') return Promise.reject(new Error('Kokoro isn’t loaded yet'));
    if (signal?.aborted) return Promise.reject(new Error('No longer wanted'));
    return new Promise((resolve, reject) => {
      const line: Line = { id: this.lineIds++, text, voice, urgency, resolve, reject };
      this.waiting.push(line);
      signal?.addEventListener('abort', () => {
        if (!this.waiting.includes(line)) return;
        this.waiting = this.waiting.filter((l) => l !== line);
        reject(new Error('No longer wanted'));
      });
      this.sayNext();
    });
  }

  private sayNext(): void {
    if (this.saying) return;
    const at = nextLine(this.waiting);
    if (at < 0) return;
    const [line] = this.waiting.splice(at, 1);
    this.saying = line;
    this.send({ type: 'speak', id: line.id, text: line.text, voice: line.voice });
  }

  /** The line being said has been (or couldn't be): the next one's turn. */
  private said(id: number, outcome: (line: Line) => void): void {
    const line = this.saying;
    if (line?.id !== id) return;
    this.saying = undefined;
    outcome(line);
    this.sayNext();
  }

  /** Ends the worker, if there is one: SIGKILL, so onnxruntime's teardown never runs (see above). */
  close(): void {
    const worker = this.worker;
    if (!worker) return;
    this.worker = undefined;
    worker.kill();
    this.dropLines('Kokoro stopped');
  }

  private send(message: ToSpeechWorker): void {
    this.worker?.send(message);
  }

  private received(message: FromSpeechWorker, on: SpeechHelper['on']): void {
    switch (message.type) {
      case 'progress':
        this.engine = { state: 'loading', bytes: message.bytes, total: message.total };
        return this.changed();
      case 'ready':
        this.engine = { state: 'ready', on };
        return this.changed();
      case 'failed':
        this.engine = { state: 'failed', error: `Couldn't load Kokoro: ${message.error}` };
        this.close();
        return this.changed();
      case 'spoken':
        return this.said(message.id, (line) => line.resolve(Buffer.from(message.wav)));
      case 'unspoken':
        return this.said(message.id, (line) => line.reject(new Error(message.error)));
    }
  }

  /** The worker ended (or failed) without being asked to: whatever it was doing fails, and loading it again starts another. */
  private lost(error: string): void {
    const worker = this.worker;
    this.worker = undefined;
    worker?.kill();
    this.dropLines(error);
    this.engine = { state: 'failed', error };
    this.changed();
  }

  private dropLines(error: string): void {
    for (const line of [...(this.saying ? [this.saying] : []), ...this.waiting]) line.reject(new Error(error));
    this.saying = undefined;
    this.waiting = [];
  }
}
