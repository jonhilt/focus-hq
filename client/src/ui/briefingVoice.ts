import type { CrewVoice } from '../../../shared/voice';
import { api } from '../net/api';
import { state } from '../net/state';
import { cancelDictation, keptOpenMic, type Microphone, micPerRecording } from './dictation';

/** Voice mode's two switches, remembered per browser. Both start off. */
export const voicePrefs = {
  get voiceMode(): boolean {
    return localStorage.getItem('focus.briefing.voice') === '1';
  },
  set voiceMode(on: boolean) {
    localStorage.setItem('focus.briefing.voice', on ? '1' : '0');
  },
  get keepMicOpen(): boolean {
    return localStorage.getItem('focus.briefing.keepMicOpen') === '1';
  },
  set keepMicOpen(on: boolean) {
    localStorage.setItem('focus.briefing.keepMicOpen', on ? '1' : '0');
  },
};

interface Queued {
  text: string;
  voice: CrewVoice;
  /** Kokoro's WAV, fetched as soon as the line is queued; null means the browser's own voice says it. */
  audio: Promise<Blob | null>;
  /** Hushing aborts it, whether it's waiting, being fetched or being said. */
  abort: AbortController;
}

/**
 * Says the crew's lines one at a time, in the order they're queued, so voices never overlap. Kokoro speaks them once
 * it's ready on the server; until then, or if it fails, the browser's built-in voice does.
 */
export class CrewSpeaker {
  private queue: Queued[] = [];
  private current: Queued | undefined;

  say(text: string, voice: CrewVoice): void {
    const abort = new AbortController();
    const audio = state.voice?.speech.engine.state === 'ready' ? api.speak(text, voice.kokoro, abort.signal).catch(() => null) : Promise.resolve(null);
    this.queue.push({ text, voice, audio, abort });
    void this.next();
  }

  /** Stops whoever is speaking and drops the lines still waiting. */
  hush(): void {
    for (const line of [this.current, ...this.queue]) line?.abort.abort();
    this.queue = [];
  }

  private async next(): Promise<void> {
    if (this.current) return;
    const line = this.queue.shift();
    if (!line) return;
    this.current = line;
    await play(line);
    this.current = undefined;
    await this.next();
  }
}

async function play(line: Queued): Promise<void> {
  const blob = await line.audio;
  const { signal } = line.abort;
  if (signal.aborted) return;
  await new Promise<void>((done) => {
    signal.addEventListener('abort', () => done());
    if (blob) {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const end = () => {
        audio.pause();
        URL.revokeObjectURL(url);
        done();
      };
      audio.onended = audio.onerror = end;
      signal.addEventListener('abort', end);
      audio.play().catch(end);
    } else if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(line.text);
      utterance.lang = line.voice.lang;
      utterance.pitch = line.voice.pitch;
      utterance.voice = speechSynthesis.getVoices().find((v) => v.lang === line.voice.lang) ?? null;
      utterance.onend = utterance.onerror = () => done();
      signal.addEventListener('abort', () => speechSynthesis.cancel());
      speechSynthesis.speak(utterance);
    } else done();
  });
}

/**
 * Voice mode while the briefing panel is open: the crew speaking, and the mic you answer on. The mic opens for each
 * recording, or once for the whole session with "keep the mic open". Ending it stops everything and lets go of the mic.
 */
export class VoiceSession {
  readonly speaker = new CrewSpeaker();
  private microphone: Microphone;

  constructor(keepMicOpen: boolean) {
    this.microphone = keepMicOpen ? keptOpenMic() : micPerRecording;
    // Kokoro downloads the first time voice mode is used; the browser's voice speaks until it's ready
    void api.loadSpeech().catch(() => undefined);
  }

  get mic(): Microphone {
    return this.microphone;
  }

  keepMicOpen(on: boolean): void {
    cancelDictation();
    this.microphone.release();
    this.microphone = on ? keptOpenMic() : micPerRecording;
  }

  end(): void {
    cancelDictation();
    this.speaker.hush();
    this.microphone.release();
  }
}
