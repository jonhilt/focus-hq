import { voiceMissing } from '../../../shared/voice';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { h } from './dom';
import { encodeWav, insertTranscript, toMono16k } from './speech';

type Field = HTMLInputElement | HTMLTextAreaElement;
type Phase = 'idle' | 'listening' | 'transcribing';

interface Recording {
  /** Ends the recording and hands back the audio as a 16 kHz WAV. */
  stop(): Promise<ArrayBuffer>;
  cancel(): void;
}

const READY_TITLE = 'Dictate (Ctrl+M). Transcribed on this machine; nothing is sent until you send it.';
const BADGE: Record<Phase, string> = { idle: '', listening: '● Listening… 🎤 or Ctrl+M to stop', transcribing: 'Transcribing…' };

/** Only one mic records at a time: starting another cancels this one. */
let cancelActive: (() => void) | undefined;

function paint(mic: HTMLButtonElement): void {
  const phase = mic.dataset.phase as Phase;
  const missing = voiceMissing(state.voice);
  mic.disabled = phase === 'transcribing' || (phase === 'idle' && missing !== undefined);
  mic.title = phase === 'listening' ? 'Stop and transcribe (Ctrl+M)' : phase === 'transcribing' ? 'Transcribing…' : (missing ?? READY_TITLE);
}

// whisper-cli or its model turning up enables every mic on screen, without a reload
state.on('voice', () => document.querySelectorAll<HTMLButtonElement>('button.mic').forEach(paint));

/**
 * Wraps a text box with a 🎤 button: click it (or press Ctrl+M in the box) to record, again to stop. The server
 * transcribes the recording locally and the text lands at the cursor. Nothing is sent: the manager reviews it and
 * sends it as usual. Put the returned element where the field would have gone.
 */
export function withMic(ui: Ui, field: Field): HTMLElement {
  const mic = h('button', { type: 'button', class: 'mic' }, '🎤');
  const badge = h('span', { class: 'dictate-badge' });
  const wrap = h('div', { class: 'dictate' }, field, mic, badge);
  let phase: Phase = 'idle';
  let session: Promise<Recording> | undefined;

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
    const pending = record();
    session = pending;
    show('listening');
    pending.catch((err: unknown) => {
      if (session !== pending) return;
      session = undefined;
      fail(micError(err));
    });
  };

  const stop = async () => {
    const pending = session;
    if (!pending) return;
    session = undefined;
    if (cancelActive === cancel) cancelActive = undefined;
    show('transcribing');
    try {
      const { text } = await api.transcribe(await (await pending).stop());
      show('idle');
      if (!field.isConnected) return;
      if (!text.trim()) return ui.hud.toast('info', 'Dictation: didn’t catch any words.');
      const { value, cursor } = insertTranscript(field.value, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, text);
      field.value = value;
      field.focus();
      field.setSelectionRange(cursor, cursor);
      // let the panel's own listeners see the change (the QA brief saves on change)
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  const toggle = () => {
    if (phase === 'idle') start();
    else if (phase === 'listening') void stop();
  };
  mic.addEventListener('click', toggle);
  field.addEventListener('keydown', (e) => {
    if (!(e instanceof KeyboardEvent) || !e.ctrlKey || e.metaKey || e.altKey || e.code !== 'KeyM') return;
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });
  show('idle');
  return wrap;
}

async function record(): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This page can’t use the microphone. Open the office on localhost or over https.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const release = () => stream.getTracks().forEach((t) => t.stop());
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

function micError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'microphone access was denied. Allow it for this site in the browser and try again.';
  if (name === 'NotFoundError') return 'no microphone found.';
  if (name === 'NotReadableError') return 'the microphone is in use by another app.';
  return `couldn’t record: ${err instanceof Error ? err.message : String(err)}`;
}
