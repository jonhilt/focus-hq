import { EFFORT_LEVELS } from '../../../shared/types';
import { currentTake } from '../../../shared/takeScript';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h } from './dom';
import { readout } from './panels';

/** The models the captain can put the computer on; the empty one leaves it to the office's `model` setting. */
const MODELS: [id: string, name: string][] = [
  ['', 'Ship’s model'],
  ['claude-fable-5-1', 'Fable 5.1'],
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
];

/**
 * The studio holodeck's chat with its computer (docs/studio.md), docked down the right so the room stays in view:
 * describe something to see, and watch it built in the middle of the hall. Its head says which model it's on and how
 * hard it thinks (both the captain's to change). Click the room (or Esc) to walk about again; Enter or E on the far
 * wall's hologram brings the chat back.
 */
export function openStudioChat(ui: Ui): void {
  const body = h('div', { class: 'briefing-chat studio-chat' });

  // the pickers, the tabs and the message box outlive re-renders, so a reply arriving doesn't close a picker or wipe what you're typing
  const model = h('select', { class: 'effort', title: 'The model the computer thinks with, from its next turn' },
    ...MODELS.map(([id, name]) => h('option', { value: id }, name)));
  const effort = h('select', { class: 'effort', title: 'How hard the computer thinks, from its next turn: lower is quicker for small tweaks' },
    h('option', { value: '' }, 'default'),
    ...EFFORT_LEVELS.map((e) => h('option', { value: e }, e)));
  const tune = () => void api.studioTune(model.value, EFFORT_LEVELS.find((e) => e === effort.value)).catch((e: Error) => ui.error(e.message));
  model.onchange = tune;
  effort.onchange = tune;
  const ranOn = h('b');
  const cost = h('b');
  const head = h('div', { class: 'readouts studio-head' },
    readout('Model', model),
    readout('Effort', effort),
    h('div', { class: 'readout', title: 'The model its last turn ran on, as Claude Code reported it' }, h('small', null, 'Ran on'), ranOn),
    h('div', { class: 'readout' }, h('small', null, 'Spent'), cost),
  );

  const input = h('textarea', { class: 'briefing-input' });
  input.placeholder = 'Describe what you want to see, or what to change (“slower”, “make the agents bigger”)… Enter to send';
  const inputBox = withMic(ui, input);
  const send = h('button', { class: 'btn primary' }, 'Send');
  const say = (text: string, clear: boolean) => {
    if (!text.trim() || send.disabled) return;
    void busy(send, async () => {
      await api.studioSay(text);
      if (clear) input.value = '';
    }, ui.error).then(render);
  };
  const sendNow = () => say(input.value, true);
  send.onclick = sendNow;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendNow();
    }
  });
  const fresh = h('button', { class: 'btn small', title: 'Clear the studio: its scenes go, and the computer starts afresh, even mid-thought' }, 'Start over');
  fresh.onclick = () => void busy(fresh, () => api.studioNew(), ui.error);
  let shownMessages = -1;

  function render(): void {
    const session = state.studio;
    const messages = session?.messages ?? [];
    const thinking = session?.status === 'thinking';
    if (document.activeElement !== model) model.value = session?.model ?? '';
    if (document.activeElement !== effort) effort.value = session?.effort ?? '';
    ranOn.textContent = modelName(session?.ranOn);
    cost.textContent = `$${(session?.costUsd ?? 0).toFixed(2)}`;
    send.disabled = thinking;
    fresh.disabled = !messages.length && !thinking && !session?.takes.length;
    const bar = h('div', { class: 'row studio-tabs' }, h('span', { class: 'grow' }), fresh);

    const log = h('div', { class: 'briefing-log' },
      messages.length || thinking
        ? null
        : h('div', { class: 'briefing-note' }, 'Describe something you want to see: a mechanism, a process, a metaphor for one. The computer builds it in the middle of the room, moving. Walk round it, spin it (Q / R), pause it (P), scrub it ([ / ]) and change its speed (− / =); say what to change and it swaps in.'),
      ...messages.map((m) =>
        h('div', { class: `briefing-msg ${m.from}` },
          h('strong', null, m.from === 'captain' ? 'You' : 'Computer'),
          ...m.text.split(/\n{2,}/).map((p) => h('p', null, ...bold(p))),
        ),
      ),
      thinking ? h('div', { class: 'briefing-msg computer typing' }, h('strong', null, 'Computer'), h('p', null, session.activity)) : null,
      session?.status === 'failed' ? h('div', { class: 'briefing-note error' }, `${session.error ?? 'Something went wrong'}. Say something to carry on.`) : null,
    );
    const takes = session?.takes ?? [];
    const shown = currentTake(takes);
    const onFloor = shown
      ? h('div', { class: 'studio-takes' }, `In the hall: ${shown.label} (${shown.id})${shown.error ? ', stopped' : ''}${takes.length > 1 ? ` · also kept: ${takes.filter((t) => t !== shown).map((t) => t.id).join(', ')}` : ''}`)
      : null;
    fill(body, head, bar, log, onFloor, h('div', null, inputBox, h('div', { class: 'row' }, send)));
    if (messages.length !== shownMessages) {
      shownMessages = messages.length;
      requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    } else {
      log.scrollTop = log.scrollHeight;
    }
    if (document.activeElement !== input && document.activeElement !== model && document.activeElement !== effort) input.focus();
  }

  ui.panels.open({ title: 'Studio · Holodeck computer', body, accent: LCARS.gold, docked: true });
  ui.panels.own(state.on('studio', render));
  render();
}

/** A model's short name, as the picker has it, or its id without the `claude-`. */
function modelName(id?: string): string {
  if (!id) return '—';
  return MODELS.find(([m]) => m && id.startsWith(m))?.[1] ?? id.replace(/^claude-/, '');
}

/** A paragraph with its **bold** runs bold, as the computer writes scene ids. */
function bold(text: string): (string | HTMLElement)[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? h('b', null, part) : part));
}
