import { type CrewVoice, forSpeech } from '../../../shared/voice';
import { api } from '../net/api';
import { state } from '../net/state';
import { voicePrefs } from './voiceMode';

/** What an explainer's player asks of the screen around it (see `KIT_PLAYER` in server/agents/explainer.ts). */
type FromPlayer =
  | { kit: 'lines'; lines: string[] }
  | { kit: 'voice'; on: boolean }
  | { kit: 'say'; beat: number }
  | { kit: 'pause' | 'resume' | 'hush' };

/** The player's message, if it's one: anything else a page posts is ignored. */
function fromPlayer(data: unknown): FromPlayer | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const m = data as Record<string, unknown>;
  switch (m.kit) {
    case 'lines':
      return Array.isArray(m.lines) ? { kit: 'lines', lines: m.lines.slice(0, 8).map((l) => forSpeech(String(l)).slice(0, 1000)) } : undefined;
    case 'voice':
      return { kit: 'voice', on: m.on === true };
    case 'say':
      return typeof m.beat === 'number' ? { kit: 'say', beat: m.beat } : undefined;
    case 'pause':
    case 'resume':
    case 'hush':
      return { kit: m.kit };
    default:
      return undefined;
  }
}

/** How long a beat waits for Kokoro to say its line before the browser's voice says it instead, so a beat never sits silent while Kokoro loads or catches up. */
const KOKORO_WAIT_MS = 2500;

/** A line being said: Kokoro's audio, or the browser's voice while Kokoro isn't ready. */
interface Saying {
  stop: () => void;
  pause: () => void;
  resume: () => void;
}

/**
 * An explainer's voice-over, up close. Its player runs in a sandbox of its own and can't reach the office, so it posts
 * its beats' lines here and asks for each to be said, paused or hushed; the narrator says them in the lead's voice and
 * tells the player when a line is done, so its beat can move on. Kokoro's audio is fetched for every line as soon as
 * the voice is on (or Kokoro's ready), so the next beat's is there by the time it plays; a line it's slow with is said in
 * the browser's voice instead.
 */
export class Narrator {
  private lines: string[] = [];
  private audio = new Map<number, Promise<Blob | null>>();
  private saying: Saying | undefined;
  private on = false;
  private readonly fetching = new AbortController();
  // Kokoro may only be ready once the voice is on: fetch the lines then
  private readonly unsubscribe = state.on('voice', () => this.prefetch());

  constructor(private readonly frame: HTMLIFrameElement, private readonly voice: CrewVoice) {}

  /** Handles a message posted to the window, if it came from this narrator's player. */
  heard(e: MessageEvent): void {
    if (e.source !== this.frame.contentWindow) return;
    const m = fromPlayer(e.data);
    if (!m) return;
    switch (m.kit) {
      case 'lines':
        this.lines = m.lines;
        this.switched(voicePrefs.explainerVoice);
        break;
      case 'voice':
        voicePrefs.explainerVoice = m.on;
        this.switched(m.on);
        break;
      case 'say':
        this.say(m.beat);
        break;
      case 'pause':
        this.saying?.pause();
        break;
      case 'resume':
        this.saying?.resume();
        break;
      case 'hush':
        this.hush();
        break;
    }
  }

  /** Stops the voice and any line still being fetched: the panel's closed, or shows something else. */
  end(): void {
    this.hush();
    this.fetching.abort();
    this.unsubscribe();
  }

  private tell(message: { kit: 'voice'; on: boolean } | { kit: 'said'; beat: number }): void {
    this.frame.contentWindow?.postMessage(message, '*');
  }

  private switched(on: boolean): void {
    this.on = on;
    this.tell({ kit: 'voice', on });
    if (!on) return this.hush();
    // Kokoro downloads the first time a voice is used; the browser's voice speaks until it's ready
    void api.loadSpeech().catch(() => undefined);
    this.prefetch();
  }

  private prefetch(): void {
    if (this.on) this.lines.forEach((_, i) => void this.fetch(i));
  }

  /** Kokoro's audio for a line, once it's ready on the server; null while it isn't, so the browser's voice says it. */
  private fetch(beat: number): Promise<Blob | null> {
    const cached = this.audio.get(beat);
    if (cached) return cached;
    const text = this.lines[beat];
    if (!text || state.voice?.speech.engine.state !== 'ready') return Promise.resolve(null);
    const audio = api.speak(text, this.voice.kokoro, this.fetching.signal).catch(() => {
      this.audio.delete(beat);
      return null;
    });
    this.audio.set(beat, audio);
    return audio;
  }

  private hush(): void {
    this.saying?.stop();
    this.saying = undefined;
  }

  /**
   * Says a beat's line, cutting off whatever was being said, and tells the player when it's done. Paused before its
   * audio arrives, it waits to start until it's resumed.
   */
  private say(beat: number): void {
    this.hush();
    const text = this.lines[beat];
    let stopped = false;
    let paused = false;
    // what pausing, resuming and stopping do once it's started
    let started: Saying | undefined;
    let start: (() => void) | undefined;
    const saying: Saying = {
      stop: () => {
        stopped = true;
        started?.stop();
      },
      pause: () => {
        paused = true;
        started?.pause();
      },
      resume: () => {
        paused = false;
        if (started) started.resume();
        else start?.();
      },
    };
    this.saying = saying;
    const done = () => {
      if (stopped) return;
      stopped = true;
      if (this.saying === saying) this.saying = undefined;
      this.tell({ kit: 'said', beat });
    };
    if (!text) return done();
    const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), KOKORO_WAIT_MS));
    void Promise.race([this.fetch(beat), late]).then((blob) => {
      start = () => {
        if (stopped || started) return;
        started = blob ? playAudio(blob, done) : speakAloud(text, this.voice, done);
      };
      if (!paused) start();
    });
  }
}

/** Plays Kokoro's WAV, calling `done` when it ends (or can't play). */
function playAudio(blob: Blob, done: () => void): Saying {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const finish = () => {
    URL.revokeObjectURL(url);
    done();
  };
  audio.onended = audio.onerror = finish;
  audio.play().catch(finish);
  return {
    stop: () => {
      audio.pause();
      URL.revokeObjectURL(url);
    },
    pause: () => audio.pause(),
    resume: () => void audio.play().catch(finish),
  };
}

/** Says the line in the browser's own voice, calling `done` when it's said (or straight away, if there's no voice). */
function speakAloud(text: string, voice: CrewVoice, done: () => void): Saying {
  if (!('speechSynthesis' in window)) {
    done();
    return { stop: () => undefined, pause: () => undefined, resume: () => undefined };
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice.lang;
  utterance.pitch = voice.pitch;
  utterance.voice = speechSynthesis.getVoices().find((v) => v.lang === voice.lang) ?? null;
  // some browsers never say when they've finished (or never start), and a beat waiting on its line would hold forever:
  // allow about as long as the line takes to say, and a little more, while it isn't paused
  let left = (text.length / 12 + 3) * 1000;
  let since = Date.now();
  let timer = setTimeout(finish, left);
  function finish() {
    clearTimeout(timer);
    done();
  }
  utterance.onend = utterance.onerror = finish;
  speechSynthesis.speak(utterance);
  return {
    stop: () => {
      clearTimeout(timer);
      speechSynthesis.cancel();
    },
    pause: () => {
      clearTimeout(timer);
      left -= Date.now() - since;
      speechSynthesis.pause();
    },
    resume: () => {
      since = Date.now();
      timer = setTimeout(finish, Math.max(0, left));
      speechSynthesis.resume();
    },
  };
}
