import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import type { KokoroTTS } from 'kokoro-js';
import type { SpeechEngine, SpeechStatus } from '../shared/types';
import type { KokoroVoice } from '../shared/voice';
import { kokoro } from './config';
import { errorMessage } from './util';

const PROGRESS_EVERY_MS = 250;

/** transformers.js reports each file it fetches; the download's progress is all of them added up. */
export function downloadProgress(files: Map<string, { loaded: number; total: number }>): { bytes: number; total?: number } {
  const all = [...files.values()];
  const total = all.reduce((sum, f) => sum + f.total, 0);
  return { bytes: all.reduce((sum, f) => sum + f.loaded, 0), total: total || undefined };
}

/**
 * The crew's voices: Kokoro (82M) through kokoro-js, in this process. The model downloads once into the models folder,
 * the first time something asks for it, and stays loaded after that. Lines are spoken one at a time, so a queue of
 * them doesn't fight over the CPU.
 */
export class Speech {
  private engine: SpeechEngine = { state: 'idle' };
  private tts?: KokoroTTS;
  private queue: Promise<unknown> = Promise.resolve();

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
    void this.fetchModel().then(
      (tts) => {
        this.tts = tts;
        this.engine = { state: 'ready' };
      },
      (err) => (this.engine = { state: 'failed', error: `Couldn't load Kokoro: ${errorMessage(err)}` }),
    ).finally(this.changed);
  }

  /** The line as a WAV, in the voice given. */
  speak(text: string, voice: KokoroVoice): Promise<Buffer> {
    const tts = this.tts;
    if (!tts) return Promise.reject(new Error('Kokoro isn’t loaded yet'));
    const line = this.queue.then(async () => Buffer.from((await tts.generate(text, { voice })).toWav()));
    this.queue = line.catch(() => undefined);
    return line;
  }

  private async fetchModel(): Promise<KokoroTTS> {
    // imported on first use: it loads onnxruntime, which a session that never speaks doesn't need
    const [{ KokoroTTS }, { env }] = await Promise.all([import('kokoro-js'), import('@huggingface/transformers')]);
    env.cacheDir = kokoro.dir;
    // whatever an earlier, unfinished download left behind would load as a broken model
    if (!existsSync(kokoro.marker)) await rm(kokoro.dir, { recursive: true, force: true });
    const files = new Map<string, { loaded: number; total: number }>();
    let sentAt = 0;
    const tts = await KokoroTTS.from_pretrained(kokoro.model, {
      dtype: kokoro.dtype,
      device: 'cpu',
      progress_callback: (p) => {
        if (p.status !== 'progress') return;
        files.set(p.file, { loaded: p.loaded, total: p.total });
        this.engine = { state: 'loading', ...downloadProgress(files) };
        if (Date.now() - sentAt > PROGRESS_EVERY_MS) {
          sentAt = Date.now();
          this.changed();
        }
      },
    });
    await writeFile(kokoro.marker, '');
    return tts;
  }
}
