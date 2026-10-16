import { type BriefingBeats, type BriefingSpot, firstChangedBeat } from '../../../shared/artifacts';
import { type CrewVoice, forSpeech } from '../../../shared/voice';
import { api } from '../net/api';
import { bestBrowserVoice, kokoroReady } from './crewVoice';
import { voicePrefs } from './voiceMode';

/** What an explainer's player asks of the screen around it (see `KIT_PLAYER` in server/agents/explainer.ts). */
type FromPlayer =
  | { kit: 'lines'; lines: string[]; titles?: string[] }
  | { kit: 'voice'; on: boolean }
  | { kit: 'say'; beat: number }
  | { kit: 'beat'; beat: number; title: string }
  | { kit: 'pause' | 'resume' | 'hush' };

/** The player's message, if it's one: anything else a page posts is ignored. */
function fromPlayer(data: unknown): FromPlayer | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const m = data as Record<string, unknown>;
  switch (m.kit) {
    case 'lines':
      return Array.isArray(m.lines)
        ? { kit: 'lines', lines: m.lines.slice(0, 8).map((l) => forSpeech(String(l)).slice(0, 1000)), titles: Array.isArray(m.titles) ? m.titles.slice(0, 8).map((t) => String(t).slice(0, 200)) : undefined }
        : undefined;
    case 'voice':
      return { kit: 'voice', on: m.on === true };
    case 'say':
      return typeof m.beat === 'number' ? { kit: 'say', beat: m.beat } : undefined;
    case 'beat':
      return typeof m.beat === 'number' ? { kit: 'beat', beat: m.beat, title: String(m.title ?? '').slice(0, 200) } : undefined;
    case 'pause':
    case 'resume':
    case 'hush':
      return { kit: m.kit };
    default:
      return undefined;
  }
}

/**
 * How many beats ahead of the one being said the narrator fetches lines. Only a little: Kokoro says one line at a time,
 * and a whole briefing's lines fetched at once would hold up an answer, or another briefing, behind them.
 */
const LOOKAHEAD = 1;

/** A line being said: Kokoro's audio, or the browser's voice if Kokoro has failed. */
interface Saying {
  stop: () => void;
  pause: () => void;
  resume: () => void;
}

/**
 * An explainer's voice-over, up close. Its player runs in a sandbox of its own and can't reach the office, so it posts
 * its beats' lines here and asks for each to be said, paused or hushed; the narrator says them in the lead's voice and
 * tells the player when a line is done, so its beat can move on. The first beats' audio is fetched as soon as the voice
 * is on, and each beat's next as it plays (`LOOKAHEAD`), so the next is there by the time it's needed. A beat whose line isn't ready holds until it is
 * (the player holds a beat until its line is said): only once Kokoro has failed does the browser's voice say it.
 */
export class Narrator {
  private lines: string[] = [];
  private audio = new Map<number, Promise<Blob | null>>();
  private saying: Saying | undefined;
  private on = false;
  private readonly fetching = new AbortController();
  /** The beat the player's on, once it's said (an explainer shown before players said so never does). */
  spot: BriefingSpot | undefined;
  /** Its beats as the player said them, to tell what the next version of it changed. */
  beats: BriefingBeats | undefined;

  /**
   * `before`: the beats of the version this one replaces, if it does; `updated` hears which beat the new version changed
   * first (-1 when none reads differently), and the player shows that beat, waiting at its start.
   */
  constructor(
    private readonly frame: HTMLIFrameElement,
    private readonly voice: CrewVoice,
    private readonly before?: { beats: BriefingBeats | undefined; updated: (beat: number) => void },
  ) {}

  /** Handles a message posted to the window, if it came from this narrator's player. */
  heard(e: MessageEvent): void {
    if (e.source !== this.frame.contentWindow) return;
    const m = fromPlayer(e.data);
    if (!m) return;
    switch (m.kit) {
      case 'lines':
        this.lines = m.lines;
        this.beats = { lines: m.lines, titles: m.titles };
        this.switched(voicePrefs.explainerVoice);
        if (this.before) {
          const changed = firstChangedBeat(this.before.beats, this.beats);
          if (changed >= 0) this.tell({ kit: 'show', beat: changed });
          this.before.updated(changed);
        }
        break;
      case 'voice':
        voicePrefs.explainerVoice = m.on;
        this.switched(m.on);
        break;
      case 'say':
        this.say(m.beat);
        break;
      case 'beat':
        this.spot = { beat: m.beat, title: m.title };
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

  /** Pauses the player, and the line being said with it (the player says so): Play picks both up again. */
  pause(): void {
    this.tell({ kit: 'pause' });
  }

  /** Stops the voice and any line still being fetched: the panel's closed, or shows something else. */
  end(): void {
    this.hush();
    this.fetching.abort();
  }

  private tell(message: { kit: 'voice'; on: boolean } | { kit: 'said'; beat: number } | { kit: 'pause' } | { kit: 'show'; beat: number }): void {
    this.frame.contentWindow?.postMessage(message, '*');
  }

  private switched(on: boolean): void {
    this.on = on;
    this.tell({ kit: 'voice', on });
    if (!on) return this.hush();
    this.prefetch();
  }

  /** The first beats' lines, so the first is ready when Play is pressed. */
  private prefetch(): void {
    if (!this.on) return;
    for (let beat = 0; beat < LOOKAHEAD + 1; beat++) void this.fetch(beat, 'ahead');
  }

  /**
   * Kokoro's audio for a line, waiting for Kokoro to load if it must (it loads the first time a voice is used, and as
   * the office starts once it's downloaded); null if it's failed, or failed on this line, so the browser's voice says it.
   */
  private fetch(beat: number, urgency: 'now' | 'ahead' = 'now'): Promise<Blob | null> {
    const cached = this.audio.get(beat);
    if (cached) return cached;
    const text = this.lines[beat];
    if (!text) return Promise.resolve(null);
    const { signal } = this.fetching;
    const audio = kokoroReady(signal)
      .then((ready) => (ready ? api.speak(text, this.voice.kokoro, signal, urgency) : null))
      .catch(() => {
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
    for (let next = beat + 1; next <= beat + LOOKAHEAD; next++) void this.fetch(next, 'ahead');
    void this.fetch(beat).then((blob) => {
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
  utterance.voice = bestBrowserVoice(speechSynthesis.getVoices(), voice.lang);
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
