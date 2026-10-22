import { accessSync, constants, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Settings, VoiceDownload, VoiceStatus } from '../shared/types';
import { type KokoroVoice, voiceMissing } from '../shared/voice';
import { whisper } from './config';
import type { Hub } from './hub';
import { type LineUrgency, Speech } from './speech';
import { cpuKokoro, gpuKokoro, type SpeechHelper, speechHelpers } from './speechHelpers';
import { errorMessage, newId, run } from './util';

export const DEMO_TRANSCRIPT = 'This is a demo transcription.';

// A server started from a GUI or launchd may not have Homebrew's bin directories on its PATH.
const BREW_BINS = ['/opt/homebrew/bin', '/usr/local/bin'];
const PROGRESS_EVERY_MS = 250;

/** whisper-cli's stdout as plain text: its lines joined, without markers like [BLANK_AUDIO] for silence. */
export function cleanTranscript(stdout: string): string {
  return stdout
    .replace(/\[[A-Z_ ]+\]/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findExecutable(bin: string): string | undefined {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean), ...BREW_BINS];
  const candidates = bin.includes('/') ? [path.resolve(bin)] : dirs.map((d) => path.join(d, bin));
  return candidates.find((file) => {
    try {
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** What Voice goes by of the settings in force (`settingsInForce`): read each time, so a change applies at once. */
export type VoiceSettings = Pick<Settings, 'whisperBin' | 'whisperModel' | 'speechGpu'>;

/** whisper's CLI and model as `settings` name them, else whisper-cli on the PATH and the model in Focus's data folder. */
export function whisperFor(settings: VoiceSettings): { bin: string; model: string } {
  return { bin: settings.whisperBin || 'whisper-cli', model: path.resolve(settings.whisperModel || whisper.model) };
}

/** Kokoro's helpers on this machine, in the order to try them: the Apple GPU (through uv) where it can, then the CPU. */
function speechHelpersHere(gpu: boolean | undefined): SpeechHelper[] {
  const uv = findExecutable('uv');
  return speechHelpers({ platform: process.platform, arch: process.arch, uv: uv !== undefined, gpu }).map((on) =>
    on === 'gpu' && uv ? gpuKokoro(uv) : cpuKokoro,
  );
}

/**
 * Local dictation with whisper.cpp: finds `whisper-cli` and its model, transcribes WAV recordings with them, and
 * downloads the model. Audio never leaves the machine. In demo mode it's always ready and transcribes to a fixed line.
 * The crew's voices (Kokoro, in `speech`) are local too, and real in demo mode as well.
 */
export class Voice {
  private download?: VoiceDownload;
  private readonly speech = new Speech(() => this.refresh(), () => speechHelpersHere(this.settings().speechGpu));
  /** Whether Kokoro may use the GPU, as it was last loaded or told: a change loads it again (`settingsChanged`). */
  private gpu: boolean;

  constructor(
    private readonly hub: Hub,
    private readonly demo: boolean,
    private readonly settings: () => VoiceSettings = () => ({}),
  ) {
    this.gpu = settings().speechGpu !== false;
  }

  /** Settings moved: every browser hears where whisper is now, and Kokoro moves onto or off the GPU if it's loaded. */
  settingsChanged(): void {
    this.refresh();
    const gpu = this.settings().speechGpu !== false;
    if (gpu === this.gpu) return;
    this.gpu = gpu;
    if (!this.demo) this.speech.reload();
  }

  status(): VoiceStatus {
    const speech = this.speech.status();
    const whisper = whisperFor(this.settings());
    if (this.demo) return { whisper: { found: true, command: whisper.bin }, model: { present: true, path: whisper.model }, speech };
    const found = findExecutable(whisper.bin);
    return {
      whisper: { found: found !== undefined, command: found ?? whisper.bin },
      model: { present: existsSync(whisper.model), path: whisper.model },
      download: this.download,
      speech,
    };
  }

  /** Gets Kokoro ready to speak: downloads it the first time, then loads it. Progress goes out as `voice` events. */
  loadSpeech(): VoiceStatus {
    this.speech.load();
    return this.status();
  }

  /**
   * Loads Kokoro as Focus starts, if it's downloaded, so the first line anyone says is in a crew voice rather than
   * waiting on the model. Not in the demo ship: there may be many of those at once, and each would load its own.
   */
  warmSpeech(): void {
    if (!this.demo && this.speech.status().downloaded) this.speech.load();
  }

  speak(text: string, voice: KokoroVoice, urgency?: LineUrgency, signal?: AbortSignal): Promise<Buffer> {
    return this.speech.speak(text, voice, urgency, signal);
  }

  /** Stops Kokoro's process, if it's running, as Focus closes. */
  close(): void {
    this.speech.close();
  }

  /** Looks for whisper-cli and the model again (after a brew install, say) and tells every browser. */
  refresh(): VoiceStatus {
    const status = this.status();
    this.hub.send({ type: 'voice', voice: status });
    return status;
  }

  async transcribe(wav: Buffer): Promise<string> {
    if (this.demo) return DEMO_TRANSCRIPT;
    const status = this.status();
    const missing = voiceMissing(status);
    if (missing) throw new Error(missing);
    const file = path.join(os.tmpdir(), `${newId('focus-dictation')}.wav`);
    await writeFile(file, wav);
    try {
      const stdout = await run(status.whisper.command, ['-m', status.model.path, '-f', file, '-l', 'en', '-nt', '-np'], { timeoutMs: 2 * 60_000 });
      return cleanTranscript(stdout);
    } finally {
      await rm(file, { force: true });
    }
  }

  /** Starts downloading the model unless it's already there or on its way. Progress goes out as `voice` events. */
  startDownload(): VoiceStatus {
    if (this.download?.state !== 'running' && !this.status().model.present) {
      this.download = { state: 'running', bytes: 0 };
      this.refresh();
      void this.fetchModel().then(
        () => (this.download = undefined),
        (err) => (this.download = { state: 'failed', error: `Couldn't download the model: ${errorMessage(err)}` }),
      ).finally(() => this.refresh());
    }
    return this.status();
  }

  /** Streams to `<model>.partial` and renames it into place only once it's complete, so a broken download never looks like a model. */
  private async fetchModel(): Promise<void> {
    const model = whisperFor(this.settings()).model;
    const partial = `${model}.partial`;
    await mkdir(path.dirname(model), { recursive: true });
    try {
      const res = await fetch(whisper.modelUrl);
      if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
      const total = Number(res.headers.get('content-length')) || undefined;
      let bytes = 0;
      let sentAt = 0;
      const progress = new Transform({
        transform: (chunk: Buffer, _encoding, done) => {
          bytes += chunk.length;
          this.download = { state: 'running', bytes, total };
          if (Date.now() - sentAt > PROGRESS_EVERY_MS) {
            sentAt = Date.now();
            this.refresh();
          }
          done(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>), progress, createWriteStream(partial));
      if (total !== undefined && bytes !== total) throw new Error(`got ${bytes} of ${total} bytes`);
      await rename(partial, model);
    } catch (err) {
      await rm(partial, { force: true });
      throw err;
    }
  }
}
