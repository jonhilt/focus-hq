import { crewVoice, numberOne, plannerFor } from '../../../shared/crew';
import type { NumberOneChat, WorkSuggestion } from '../../../shared/types';
import { linesToSpeak } from '../../../shared/voice';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { voicePrefs, VoiceSession, voiceToggle } from './voiceMode';
import { type MicMode, withMic } from './dictation';
import { busy, fill, h } from './dom';
import { handOffControl } from './goals';

let open = false;
/** Whether the Number One panel is showing (so the office doesn't toast a reply you can already see). */
export const numberOnePanelOpen = () => open;

/**
 * The ready room's chat with Number One: ask about any project's code or what's going on aboard, or think an idea
 * through. Nothing said here turns into work by itself: a reply that suggests some offers to send it to the project's
 * stand, or to start it as a goal.
 */
export function openNumberOnePanel(ui: Ui): void {
  const one = numberOne();
  const body = h('div', { class: 'briefing-chat number-one' });
  // the message box outlives re-renders, so a reply arriving doesn't wipe what you're typing
  const input = h('textarea', { class: 'briefing-input' });
  // in voice mode Number One speaks their replies, and Mic / Ctrl+M sends what you say
  let voice = voicePrefs.voiceMode ? new VoiceSession(voicePrefs.keepMicOpen) : null;
  ui.panels.own(() => voice?.end());
  const micMode = (): MicMode =>
    voice ? { kind: 'talk', mic: voice.mic, started: () => voice?.speaker.hush(), send: (text) => api.numberOneSay(text).then(() => undefined) } : { kind: 'dictate' };
  const inputBox = withMic(ui, input, micMode);
  // what was in the log when the panel opened has been said: only replies after it are spoken
  let heard = state.numberOne?.messages.length ?? 0;
  const speak = (chat: NumberOneChat) => {
    // a new conversation starts the log again
    const lines = linesToSpeak(chat.messages, heard <= chat.messages.length ? heard : 0);
    heard = chat.messages.length;
    for (const line of lines) voice?.speaker.say(line.text, crewVoice(line.speaker, ''));
  };
  const send = h('button', { class: 'btn primary' }, 'Send');
  const sendNow = () => {
    if (!input.value.trim() || send.disabled) return;
    const text = input.value;
    // busy hands the button back enabled: render again so it stays off while Number One thinks
    void busy(send, async () => {
      await api.numberOneSay(text);
      input.value = '';
    }, ui.error).then(render);
  };
  send.onclick = sendNow;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendNow();
    }
  });
  let shownMessages = -1;

  const render = () => {
    const chat = state.numberOne;
    if (chat) speak(chat);
    const messages = chat?.messages ?? [];
    const thinking = chat?.status === 'thinking';
    send.disabled = thinking;
    input.placeholder = voice
      ? 'Press Mic or Ctrl+M and talk, then press again (or hold it and let go): it goes as soon as it’s transcribed. Or type it.'
      : `Ask ${one.name} anything… (Enter to send, Shift+Enter for a new line)`;

    const log = h('div', { class: 'briefing-log' },
      messages.length || thinking
        ? null
        : h('div', { class: 'briefing-note' }, 'Ask how something works in any project, what’s going on aboard, or think an idea through. Nothing you say here turns into work unless you send it on.'),
      ...messages.map((m) =>
        h('div', { class: `briefing-msg ${m.from}` },
          h('strong', null, m.from === 'manager' ? 'You' : one.name),
          ...m.text.split(/\n{2,}/).map((p) => h('p', null, p)),
          m.from === 'number-one' && m.suggest ? suggestion(ui, m.suggest) : null,
        ),
      ),
      thinking ? h('div', { class: 'briefing-msg number-one typing' }, h('strong', null, one.name), h('p', null, `✻ ${chat.activity}`)) : null,
      chat?.status === 'failed' ? h('div', { class: 'briefing-note error' }, `⚠ ${chat.error ?? 'Something went wrong'}. Say something to carry on.`) : null,
    );

    const fresh = h('button', { class: 'btn small', title: `${one.name} forgets this conversation and starts afresh, even mid-thought` }, '🧹 New conversation');
    fresh.disabled = !messages.length && !thinking;
    fresh.onclick = () =>
      void busy(fresh, async () => {
        voice?.speaker.hush();
        await api.numberOneNew();
      }, ui.error);
    const cost = h('small', { class: 'muted' }, chat?.costUsd ? `$${chat.costUsd.toFixed(2)} so far` : '');

    fill(body,
      log,
      h('div', null,
        voiceToggle(voice, (next) => {
          voice = next;
          render();
        }),
        inputBox,
        h('div', { class: 'row' }, send, cost, h('span', { class: 'grow' }), fresh),
      ),
    );
    if (messages.length !== shownMessages) {
      shownMessages = messages.length;
      requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    } else {
      log.scrollTop = log.scrollHeight;
    }
    if (document.activeElement !== input) input.focus();
  };

  ui.panels.open({ title: h('h2', null, `🖖 ${one.name} · First officer`), body, accent: LCARS.lilac, wide: true });
  open = true;
  ui.panels.own(() => (open = false));
  ui.panels.own(state.on('number-one', render));
  ui.panels.own(state.on('projects', render));
  render();
}

/** What a reply suggests doing: a draft at the project's stand, or a goal with a lead of its own. */
function suggestion(ui: Ui, { projectId, idea }: WorkSuggestion): HTMLElement {
  const name = state.project(projectId)?.name ?? 'the project';
  const officer = plannerFor(projectId).name;
  const draft = h('button', { class: 'btn small', title: `${officer} writes it up as one issue at ${name}’s New issue stand` }, '✨ Draft at the stand');
  draft.onclick = () => {
    const waiting = state.drafts.get(projectId);
    if (waiting?.status === 'ready' && !confirm(`${officer} has a draft waiting at ${name}’s stand${waiting.title ? ` (“${waiting.title}”)` : ''}. Replace it?`)) return;
    void busy(draft, async () => {
      await api.draftIssue(projectId, idea);
      ui.openNewIssue(projectId);
    }, ui.error);
  };
  const lead = handOffControl(ui, projectId, () => idea, 'Number One', `Start it as a goal in ${name}, where a lead of its own talks it through with you and builds it a slice at a time, or hand it to a goal under way`, true);
  return h('div', { class: 'row suggest' }, h('small', { class: 'muted' }, `For ${name}:`), draft, lead);
}
