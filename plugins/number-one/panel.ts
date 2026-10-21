// Number One's chat in the browser: the panel in the ready room, with voice mode and the call strip.
import { callView } from './callView';
import { chatNow, NUMBER_ONE, NUMBER_ONE_VOICE, numberOne, type NumberOneChat, type NumberOneMessage, type NumberOneState, type WorkSuggestion } from './shared';
import { chatPanel, type ChatPanel } from './view';
import { busy, callPlugin, confirmDialog, fill, h, handOffControl, LCARS, linesToSpeak, type MicMode, focus, onPluginState, plannerFor, pluginState, type Ui, voicePrefs, VoiceSession, voiceToggle, withMic } from '../../plugin-api/client';

/** The chat as it stands this moment: none until the plugin's state arrives. */
export const currentChat = (): NumberOneChat | null => chatNow(pluginState<NumberOneState>(NUMBER_ONE));
const say = (text: string) => callPlugin<NumberOneChat>(NUMBER_ONE, '/say', { text });

let open = false;
/** Whether the Number One panel is showing (so Focus doesn't toast a reply you can already see). */
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
  const micMode = (): MicMode =>
    voice ? { kind: 'talk', mic: voice.mic, started: () => voice?.speaker.hush(), send: (text) => say(text).then(() => undefined) } : { kind: 'dictate' };
  const inputBox = withMic(ui, input, micMode);
  // what was in the log when the panel opened has been said: only replies after it are spoken
  let heard = currentChat()?.messages.length ?? 0;
  const speak = (chat: NumberOneChat) => {
    // a new conversation starts the log again
    const lines = linesToSpeak(chat.messages, heard <= chat.messages.length ? heard : 0);
    heard = chat.messages.length;
    for (const line of lines) voice?.speaker.say(line.text, NUMBER_ONE_VOICE);
  };
  const send = h('button', { class: 'btn primary' }, 'Send');
  const sendNow = () => {
    if (!input.value.trim() || send.disabled) return;
    const text = input.value;
    // busy hands the button back enabled: render again so it stays off while Number One thinks
    void busy(send, async () => {
      await say(text);
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
    const chat = currentChat();
    if (chat) speak(chat);
    const wording = chatPanel(chat, !!voice);
    const { messages } = wording;
    send.disabled = wording.thinking;
    input.placeholder = wording.placeholder;
    const log = chatLog(ui, wording);

    const fresh = h('button', { class: 'btn small', title: `${one.name} forgets this conversation and starts afresh, even mid-thought` }, 'New conversation');
    fresh.disabled = !wording.canStartAfresh;
    fresh.onclick = () =>
      void busy(fresh, async () => {
        voice?.speaker.hush();
        await callPlugin(NUMBER_ONE, '/new');
      }, ui.error);
    const cost = h('small', { class: 'muted' }, wording.cost);

    fill(body,
      callView(ui.error, render),
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

  ui.panels.open({ title: `${one.name} · First officer`, body, accent: LCARS.lilac, wide: true });
  open = true;
  ui.panels.own(() => (open = false));
  ui.panels.own(() => voice?.end());
  // the chat and the call are both the plugin's state
  ui.panels.own(onPluginState(NUMBER_ONE, render));
  ui.panels.own(focus.onProjects(render));
  render();
}

/** The chat's messages, with what the chat is for before anything's been said, Number One typing, or a failed turn. */
function chatLog(ui: Ui, wording: ChatPanel): HTMLElement {
  const name = numberOne().name;
  return h('div', { class: 'briefing-log' },
    wording.intro ? h('div', { class: 'briefing-note' }, wording.intro) : null,
    ...wording.messages.map((m) => message(ui, m, name)),
    wording.typing === null ? null : h('div', { class: 'briefing-msg number-one typing' }, h('strong', null, name), h('p', null, wording.typing)),
    wording.failed ? h('div', { class: 'briefing-note error' }, wording.failed) : null,
  );
}

/** One message: who said it, its paragraphs, and on Number One's, what it suggests doing and what it jotted in your log. */
function message(ui: Ui, m: NumberOneMessage, name: string): HTMLElement {
  const theirs = m.from === 'number-one';
  return h('div', { class: `briefing-msg ${m.from}` },
    h('strong', null, theirs ? name : 'You'),
    ...m.text.split(/\n{2,}/).map((p) => h('p', null, p)),
    ...(theirs ? replyExtras(ui, m) : []),
  );
}

/** Under Number One's reply: what it suggests doing, and what it jotted in your personal log. */
function replyExtras(ui: Ui, m: NumberOneMessage): (HTMLElement | null)[] {
  return [
    m.suggest ? suggestion(ui, m.suggest) : null,
    m.logged ? h('div', { class: 'row logged' }, h('small', { class: 'muted' }, `Jotted in your personal log: “${m.logged}”`)) : null,
  ];
}

/** What a reply suggests doing: a draft at the project's Ops station, or a goal with a lead of its own. */
function suggestion(ui: Ui, { projectId, idea }: WorkSuggestion): HTMLElement {
  const name = focus.project(projectId)?.name ?? 'the project';
  const officer = plannerFor(projectId).name;
  const draft = h('button', { class: 'btn small', title: `${officer} writes it up as one issue at ${name}’s Ops station` }, 'Draft at Ops');
  draft.onclick = async () => {
    const waiting = focus.draft(projectId);
    if (waiting?.status === 'ready' && !await confirmDialog({ title: 'Replace draft', message: `${officer} has a draft waiting at ${name}’s Ops station${waiting.title ? ` (“${waiting.title}”)` : ''}. Replace it?`, confirmLabel: 'Replace it' })) return;
    void busy(draft, async () => {
      await focus.draftIssue(projectId, idea);
      ui.openNewIssue(projectId);
    }, ui.error);
  };
  const lead = handOffControl(ui, projectId, () => idea, 'Number One', `Start it as a goal in ${name}, where a lead of its own talks it through with you and builds it a slice at a time, or hand it to a goal under way`, true);
  return h('div', { class: 'row suggest' }, h('small', { class: 'muted' }, `For ${name}:`), draft, lead);
}
