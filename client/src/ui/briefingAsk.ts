import { leadVoice, quickVoice } from '../../../shared/crew';
import type { GoalArtifact } from '../../../shared/types';
import type { CrewVoice } from '../../../shared/voice';
import { repliesToSpeak, sentences } from '../../../shared/voice';
import { state } from '../net/state';
import type { Ui } from './context';
import { micPerRecording, withMic } from './dictation';
import { h } from './dom';
import type { Narrator } from './narrator';
import { askAboutBriefing } from './resume';
import { CrewSpeaker, voicePrefs } from './voiceMode';

/** How long after a question the lead's replies still count as its answer, and are said aloud. */
const ANSWER_WINDOW_MS = 5 * 60_000;

/**
 * Asking a lead about their briefing, up close: type it, or press Mic and say it (sent as soon as it's transcribed).
 * Asking pauses the briefing, and the question goes with the beat you were on. Between their turns the lead answers it:
 * what they write back while answering shows under it, and is said in their voice (always, if you asked aloud; with
 * the briefing's Voice on, if you typed it). While they're busy the quick answerer does, in a voice of its own.
 * How long their first word took to come back is shown beside it, the wait a conversation lives or dies by. It outlives
 * a new version of the briefing, so an answer the lead gives before explaining again carries on being said.
 */
export class BriefingAsk {
  readonly el: HTMLElement;
  private readonly speaker = new CrewSpeaker();
  private readonly answer = h('div', { class: 'briefing-answer' });
  private readonly input = h('input', { class: 'grow', type: 'text' });
  /** Counts the questions asked, so an answer to one that's since been asked over is never shown or said. */
  private asked = 0;
  /** Stops hearing the answer to the last question: a new one's asked, or the briefing's gone. */
  private stopHearing: (() => void) | undefined;

  constructor(
    private readonly ui: Ui,
    private readonly leadId: string,
    private readonly briefing: Pick<GoalArtifact, 'id' | 'title'>,
    /** The briefing's voice-over: a new version of the briefing (the lead explaining again) brings a new one. */
    public narrator: Narrator,
  ) {
    const name = state.agents.get(leadId)?.name ?? 'the lead';
    this.input.placeholder = `Ask ${name} about this briefing…`;
    this.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      void this.ask(this.input.value, voicePrefs.explainerVoice);
    });
    const ask = h('button', { class: 'btn small', onclick: () => void this.ask(this.input.value, voicePrefs.explainerVoice) }, 'Ask');
    const mic = withMic(ui, this.input, () => ({
      kind: 'talk',
      mic: micPerRecording,
      started: () => this.quiet(),
      send: (text) => this.ask(text, true),
    }));
    this.el = h('div', { class: 'briefing-ask' }, h('div', { class: 'row' }, mic, ask), this.answer);
  }

  end(): void {
    this.asked++;
    this.stopHearing?.();
    this.speaker.hush();
  }

  /** Says it a sentence at a time, so the first plays while the rest are being made. */
  private say(text: string, voice: CrewVoice): void {
    for (const sentence of sentences(text)) this.speaker.say(sentence, voice);
  }

  /** Pauses the briefing and stops whoever's speaking, so you can be heard. */
  private quiet(): void {
    this.narrator.pause();
    this.speaker.hush();
  }

  private async ask(text: string, aloud: boolean): Promise<void> {
    const question = text.trim();
    if (!question) return;
    this.quiet();
    this.stopHearing?.();
    this.input.value = '';
    const asking = ++this.asked;
    const name = state.agents.get(this.leadId)?.name ?? 'the lead';
    const waiting = h('small', { class: 'muted' }, `Asking ${name}…`);
    this.answer.replaceChildren(h('p', { class: 'asked' }, h('b', null, 'You: '), question), waiting);
    const askedAt = performance.now();
    const after = () => `${((performance.now() - askedAt) / 1000).toFixed(1)} s`;
    try {
      const reply = await askAboutBriefing(this.leadId, this.briefing.id, this.narrator.spot, question);
      // asked again (or closed) meanwhile: that question's answer is the one that counts
      if (asking !== this.asked) return;
      if (!reply) {
        waiting.textContent = 'Not sent.';
      } else if (reply.by === 'quick') {
        waiting.before(h('p', { class: 'quick' }, h('b', null, 'Quick answer: '), reply.text));
        waiting.textContent = `Answered after ${after()}, while ${name} works: they've heard it too, and will put it right if it's wrong.`;
        if (aloud) this.say(reply.text, quickVoice(this.leadId));
      } else {
        waiting.textContent = `Waiting for ${name}…`;
        this.hearLead(waiting, aloud, after);
      }
    } catch (e) {
      if (asking !== this.asked) return;
      waiting.textContent = 'Not sent.';
      this.ui.error((e as Error).message);
    }
  }

  /** Shows (and says, if `aloud`) what the lead writes back while answering, for a while after asking. */
  private hearLead(waiting: HTMLElement, aloud: boolean, after: () => string): void {
    let replied = false;
    const unsubscribe = state.on('lines', ({ id, lines }) => {
      if (id !== this.leadId) return;
      for (const reply of repliesToSpeak(lines)) {
        if (!replied) {
          replied = true;
          waiting.textContent = `First reply after ${after()}`;
        }
        waiting.before(h('p', null, reply));
        if (aloud) this.say(reply, leadVoice(this.leadId));
      }
    });
    const timer = setTimeout(() => this.stopHearing?.(), ANSWER_WINDOW_MS);
    const stop = () => {
      unsubscribe();
      clearTimeout(timer);
      if (this.stopHearing === stop) this.stopHearing = undefined;
    };
    this.stopHearing = stop;
  }
}
