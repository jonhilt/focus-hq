import { voiceMissing } from '../../../shared/voice';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { micError, type Recording, startRecording } from './dictation';
import { h } from './dom';

// Talking to the studio's computer hands free (docs/studio.md): hold V in the studio, say what you want to see, and let
// go. The recording is transcribed on this machine as dictation is (docs/voice-input.md) and sent straight to the
// computer, as if typed in its chat; a pill over the bottom of the screen says what it's doing and what it heard.

type Phase = 'idle' | 'listening' | 'transcribing';

export class StudioVoice {
  private readonly pill = h('div', { class: 'studio-voice' });
  private phase: Phase = 'idle';
  private recording: Promise<Recording> | null = null;
  private hide: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly ui: Ui) {
    document.body.append(this.pill);
  }

  /** V went down: start listening, unless voice input isn't set up or the computer's still on the last thing. */
  down(): void {
    if (this.phase !== 'idle') return;
    const missing = voiceMissing(state.voice);
    if (missing) return this.ui.error(missing);
    if (state.studio?.status === 'thinking') return this.say('The computer’s still on the last thing you said', 2500);
    const pending = startRecording();
    this.recording = pending;
    this.phase = 'listening';
    this.say('<b>Listening</b> let go of V to send');
    pending.catch((err: unknown) => {
      if (this.recording !== pending) return;
      this.reset();
      this.ui.error(`Voice: ${micError(err)}`);
    });
  }

  /** V came up: send what was said. */
  async up(): Promise<void> {
    const pending = this.recording;
    if (this.phase !== 'listening' || !pending) return;
    this.recording = null;
    this.phase = 'transcribing';
    this.say('<b>Transcribing…</b>');
    try {
      const { text } = await api.transcribe(await (await pending).stop());
      if (!text.trim()) {
        this.reset();
        return this.say('Didn’t catch any words, so nothing was sent', 2500);
      }
      await api.studioSay(text.trim());
      this.reset();
      this.say(`<b>Sent</b> ${escape(text.trim())}`, 4000);
    } catch (err) {
      this.reset();
      this.ui.error(`Voice: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Stops listening without sending (you left the studio, or the window lost focus). */
  cancel(): void {
    const pending = this.recording;
    if (!pending) return;
    this.reset();
    void pending.then((r) => r.cancel(), () => undefined);
    this.pill.classList.remove('up');
  }

  private reset(): void {
    this.recording = null;
    this.phase = 'idle';
  }

  /** Shows `html` in the pill, for `ms` if given, or until it's next changed. */
  private say(html: string, ms?: number): void {
    clearTimeout(this.hide);
    this.pill.innerHTML = html;
    this.pill.classList.add('up');
    if (ms) this.hide = setTimeout(() => this.pill.classList.remove('up'), ms);
  }
}

const escape = (text: string) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
