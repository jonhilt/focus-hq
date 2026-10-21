import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import type { KokoroTTS } from 'kokoro-js';
import { kokoro } from './config';
import { downloadProgress, type FromSpeechWorker, type ToSpeechWorker } from './speech';
import { errorMessage } from './util';

// Kokoro, in a process of its own: server/speech.ts starts it and says why. It only ever ends by SIGKILL, so
// onnxruntime's native teardown, which aborts on macOS, never runs.

const PROGRESS_EVERY_MS = 250;

const tell = (message: FromSpeechWorker) => process.send?.(message);
const quit = () => process.kill(process.pid, 'SIGKILL');

// Focus ends this process when it closes; if Focus goes without doing so (it crashed, or was killed), this
// one goes too. Ctrl+C reaches the whole process group, but it's Focus that decides when Kokoro stops.
process.on('disconnect', quit);
process.on('SIGTERM', quit);
process.on('SIGINT', () => undefined);

let tts: Promise<KokoroTTS> | undefined;
let queue: Promise<unknown> = Promise.resolve();

process.on('message', (message: ToSpeechWorker) => {
  if (message.type === 'load') {
    tts ??= fetchModel();
    tts.then(
      () => tell({ type: 'ready' }),
      (err: unknown) => tell({ type: 'failed', error: errorMessage(err) }),
    );
  } else if (message.type === 'speak') {
    const { id, text, voice } = message;
    const line = queue.then(async () => {
      if (!tts) throw new Error('Kokoro isn’t loaded yet');
      return (await (await tts).generate(text, { voice })).toWav();
    });
    queue = line.catch(() => undefined);
    line.then(
      (wav) => tell({ type: 'spoken', id, wav: new Uint8Array(wav) }),
      (err: unknown) => tell({ type: 'unspoken', id, error: errorMessage(err) }),
    );
  }
});

async function fetchModel(): Promise<KokoroTTS> {
  const [{ KokoroTTS }, { env }] = await Promise.all([import('kokoro-js'), import('@huggingface/transformers')]);
  env.cacheDir = kokoro.dir;
  // whatever an earlier, unfinished download left behind would load as a broken model
  if (!existsSync(kokoro.marker)) await rm(kokoro.dir, { recursive: true, force: true });
  const files = new Map<string, { loaded: number; total: number }>();
  let sentAt = 0;
  const model = await KokoroTTS.from_pretrained(kokoro.model, {
    dtype: kokoro.dtype,
    device: 'cpu',
    progress_callback: (p) => {
      if (p.status !== 'progress') return;
      files.set(p.file, { loaded: p.loaded, total: p.total });
      if (Date.now() - sentAt > PROGRESS_EVERY_MS) {
        sentAt = Date.now();
        tell({ type: 'progress', ...downloadProgress(files) });
      }
    },
  });
  await writeFile(kokoro.marker, '');
  return model;
}
