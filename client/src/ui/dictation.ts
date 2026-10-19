import { voiceMissing } from '../../../shared/voice';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { h } from './dom';
import { encodeWav, insertTranscript, toMono16k } from './speech';

type Field = HTMLInputElement | HTMLTextAreaElement;
type Phase = 'idle' | 'listening' | 'transcribing';

export interface Recording {
  /** Ends the recording and hands back the audio as a 16 kHz WAV. */
  stop(): Promise<ArrayBuffer>;
  cancel(): void;
}

const READY_TITLE = 'Dictate (Ctrl+M). Transcribed on this machine; nothing is sent until you send it.';
const BADGE: Record<Phase, string> = { idle: '', listening: 'Listening · Mic or Ctrl+M to stop', transcribing: 'Transcribing…' };

/** Only one mic records at a time: starting another cancels this one. */
let cancelActive: (() => void) | undefined;

/** Stops whatever is recording, without transcribing it. */
export const cancelDictation = () => cancelActive?.();

/** Where recordings get their audio from. */
export interface Microphone {
  open(): Promise<MediaStream>;
  /** A recording is done with the stream. */
  done(stream: MediaStream): void;
  /** Lets go of the mic for good, so the browser's mic indicator goes off. */
  release(): void;
}

const stopTracks = (stream: MediaStream) => stream.getTracks().forEach((t) => t.stop());

function openStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('This page can’t use the microphone. Open the office on localhost or over https.'));
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
}

/** Opens the mic for each recording and closes it after. */
export const micPerRecording: Microphone = { open: openStream, done: stopTracks, release: () => undefined };

/** Opens the mic for the first recording and keeps it open until it's released: no glitch on speakers each time it opens. */
export function keptOpenMic(): Microphone {
  let stream: Promise<MediaStream> | undefined;
  return {
    open: () =>
      (stream ??= openStream().catch((err: unknown) => {
        stream = undefined;
        throw err;
      })),
    done: () => undefined,
    release: () => {
      void stream?.then(stopTracks, () => undefined);
      stream = undefined;
    },
  };
}

/** What a recording is for: dictating into the box (the words go in at the cursor), or talking (they're sent at once). */
export type MicMode =
  | { kind: 'dictate' }
  | { kind: 'talk'; mic: Microphone; started(): void; send(text: string): Promise<void> };

const DICTATE: MicMode = { kind: 'dictate' };
const micOf = (mode: MicMode) => (mode.kind === 'talk' ? mode.mic : micPerRecording);
/** Holding Mic or Ctrl+M longer than this records until you let go; a quick press records until you press again. */
const HOLD_MS = 400;

function paint(mic: HTMLButtonElement): void {
  const phase = mic.dataset.phase as Phase;
  const missing = voiceMissing(state.voice);
  mic.disabled = phase === 'transcribing' || (phase === 'idle' && missing !== undefined);
  mic.title = phase === 'listening' ? 'Stop and transcribe (Ctrl+M)' : phase === 'transcribing' ? 'Transcribing…' : (missing ?? READY_TITLE);
}

// whisper-cli or its model turning up enables every mic on screen, without a reload
state.on('voice', () => document.querySelectorAll<HTMLButtonElement>('button.mic').forEach(paint));

/**
 * Wraps a text box with a Mic button: click it (or press Ctrl+M in the box) to record, again to stop, or hold it and let
 * go. The server transcribes the recording locally. Dictating, the text lands at the cursor and nothing is sent: the
 * manager reviews it and sends it as usual. Talking, it's sent as soon as it's transcribed. `mode` is asked at the
 * start of each recording. Put the returned element where the field would have gone.
 */
export function withMic(ui: Ui, field: Field, mode: () => MicMode = () => DICTATE): HTMLElement {
  const mic = h('button', { type: 'button', class: 'mic' }, 'Mic');
  const badge = h('span', { class: 'dictate-badge' });
  const wrap = h('div', { class: 'dictate' }, field, mic, badge);
  let phase: Phase = 'idle';
  let session: Promise<Recording> | undefined;
  let recording: MicMode = DICTATE;
  /** When the press that started this recording began, while it's still held down. */
  let heldSince: number | undefined;

  const show = (next: Phase) => {
    phase = next;
    wrap.dataset.phase = mic.dataset.phase = next;
    badge.textContent = BADGE[next];
    paint(mic);
  };
  const fail = (message: string) => {
    show('idle');
    ui.error(`Dictation: ${message}`);
  };

  const cancel = () => {
    const pending = session;
    session = undefined;
    pending?.then((r) => r.cancel(), () => undefined);
    if (phase === 'listening') show('idle');
  };

  const start = () => {
    const missing = voiceMissing(state.voice);
    if (missing) return ui.error(missing);
    cancelActive?.();
    cancelActive = cancel;
    // the panel can close (Esc) mid-recording: don't leave the microphone on
    ui.panels.own(cancel);
    recording = mode();
    if (recording.kind === 'talk') recording.started();
    const pending = record(micOf(recording));
    session = pending;
    show('listening');
    pending.catch((err: unknown) => {
      if (session !== pending) return;
      session = undefined;
      fail(micError(err));
    });
  };

  const insert = (text: string) => {
    const { value, cursor } = insertTranscript(field.value, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, text);
    field.value = value;
    field.focus();
    field.setSelectionRange(cursor, cursor);
    // let the panel's own listeners see the change (the QA brief saves on change)
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const stop = async () => {
    const pending = session;
    if (!pending) return;
    session = undefined;
    if (cancelActive === cancel) cancelActive = undefined;
    show('transcribing');
    const finished = recording;
    try {
      const { text } = await api.transcribe(await (await pending).stop());
      show('idle');
      if (!field.isConnected) return;
      if (!text.trim()) return ui.hud.toast('info', `Dictation: didn’t catch any words${finished.kind === 'talk' ? ', so nothing was sent' : ''}.`);
      if (finished.kind === 'talk') {
        try {
          return await finished.send(text);
        } catch (err) {
          // keep the words: they go in the box to send again
          insert(text);
          throw err;
        }
      }
      insert(text);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  const press = () => {
    if (mic.disabled) return;
    if (phase === 'idle') {
      start();
      heldSince = performance.now();
    } else if (phase === 'listening') void stop();
  };
  const letGo = () => {
    if (heldSince !== undefined && performance.now() - heldSince > HOLD_MS && phase === 'listening') void stop();
    heldSince = undefined;
  };
  mic.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // keep the focus in the box, so Ctrl+M carries on working
    e.preventDefault();
    press();
  });
  mic.addEventListener('pointerup', letGo);
  mic.addEventListener('pointerleave', letGo);
  // Enter or Space on the focused button
  mic.addEventListener('click', (e) => e.detail === 0 && press());
  field.addEventListener('keydown', (e) => {
    if (!(e instanceof KeyboardEvent) || !e.ctrlKey || e.metaKey || e.altKey || e.code !== 'KeyM') return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) press();
  });
  field.addEventListener('keyup', (e) => {
    if (e instanceof KeyboardEvent && e.code === 'KeyM') letGo();
  });
  show('idle');
  return wrap;
}

export async function record(mic: Microphone): Promise<Recording> {
  const stream = await mic.open();
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const release = () => mic.done(stream);
  recorder.start();
  return {
    stop: () =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        recorder.onstop = () => {
          release();
          toWav(new Blob(chunks, { type: recorder.mimeType })).then(resolve, reject);
        };
        recorder.onerror = () => {
          release();
          reject(new Error('the recording failed'));
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

/** Decodes what MediaRecorder captured (WebM/Opus or MP4/AAC, depending on the browser) into a WAV for whisper.cpp. */
async function toWav(blob: Blob): Promise<ArrayBuffer> {
  if (!blob.size) throw new Error('nothing was recorded');
  const audio = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(await blob.arrayBuffer());
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  return encodeWav(toMono16k(channels, audio.sampleRate));
}

export function micError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'microphone access was denied. Allow it for this site in the browser and try again.';
  if (name === 'NotFoundError') return 'no microphone found.';
  if (name === 'NotReadableError') return 'the microphone is in use by another app.';
  return `couldn’t record: ${err instanceof Error ? err.message : String(err)}`;
}
