import type { CrewVoice } from '../../../shared/voice';
import { api } from '../net/api';
import { state } from '../net/state';
import { cancelDictation, keptOpenMic, type Microphone, micPerRecording } from './dictation';
import { h } from './dom';
import { Switch } from './panels';

/** Voice mode's two switches, and explainers' voice-over, remembered per browser (voice mode under the keys from when briefings had it too). All start off. */
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
  /** Whether explainers up close are narrated. Off until switched on. */
  get explainerVoice(): boolean {
    return localStorage.getItem('focus.explainer.voice') === '1';
  },
  set explainerVoice(on: boolean) {
    localStorage.setItem('focus.explainer.voice', on ? '1' : '0');
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
 * Voice mode while a crew member's chat is open (a plugin's): them speaking, and the mic you answer on. The mic opens for each
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

/**
 * Voice mode's switch, with "keep the mic open" while it's on. Flipping it ends `voice`, remembers the choice and
 * hands `switched` the session to carry on with (null when it's now off).
 */
export function voiceToggle(voice: VoiceSession | null, switched: (voice: VoiceSession | null) => void): HTMLElement {
  const toggle = new Switch('Voice', !!voice, {
    title: voice ? 'Voice mode is on: the crew speak, and Mic sends what you say. Click to turn it off.' : 'Voice mode: the crew say their lines aloud, and you answer by talking',
    changed: (on) => {
      voice?.end();
      voicePrefs.voiceMode = on;
      switched(on ? new VoiceSession(voicePrefs.keepMicOpen) : null);
    },
  });
  const keep = new Switch('Keep the mic open', voicePrefs.keepMicOpen, {
    title: 'Keeps it open between turns. For speakers: saves the glitch each time the mic opens and closes. Leave it off with Bluetooth earphones.',
    changed: (on) => {
      voicePrefs.keepMicOpen = on;
      voice?.keepMicOpen(on);
    },
  });
  return h('div', { class: 'row voice-controls' }, toggle.el, voice ? keep.el : null);
}
