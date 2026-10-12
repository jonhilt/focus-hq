import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h } from './dom';

/**
 * The studio holodeck's chat with its computer (docs/studio.md), docked down the right so the room stays in view:
 * describe a video, and watch the premise, beats, threads and takes appear as it builds them. Click the room (or Esc)
 * to walk about again; Enter or E on the premise brings the chat back.
 */
export function openStudioChat(ui: Ui): void {
  const body = h('div', { class: 'briefing-chat studio-chat' });
  // the message box outlives re-renders, so a reply arriving doesn't wipe what you're typing
  const input = h('textarea', { class: 'briefing-input' });
  input.placeholder = 'Describe the video, or say what to change (“make b slower”)… Enter to send';
  const inputBox = withMic(ui, input);
  const send = h('button', { class: 'btn primary' }, 'Send');
  const sendNow = () => {
    if (!input.value.trim() || send.disabled) return;
    const text = input.value;
    void busy(send, async () => {
      await api.studioSay(text);
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

  function render(): void {
    const session = state.studio;
    const messages = session?.messages ?? [];
    const thinking = session?.status === 'thinking';
    send.disabled = thinking;
    const log = h('div', { class: 'briefing-log' },
      messages.length || thinking
        ? null
        : h('div', { class: 'briefing-note' }, 'Say what the video’s about. The computer puts the premise on the far wall, the beats under it, loose threads in the air, and tries ways of showing things on the floor. Say what to change and it swaps them in.'),
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
    const onFloor = takes.length
      ? h('div', { class: 'studio-takes' }, `On the floor: ${takes.slice(-3).map((t) => `${t.id.toUpperCase()} ${t.label}${t.error ? ' (stopped)' : ''}`).join(' · ')}`)
      : null;
    const fresh = h('button', { class: 'btn small', title: 'Clear the studio for a new video: the computer starts afresh, even mid-thought' }, 'New video');
    fresh.disabled = !messages.length && !thinking && !session?.video;
    fresh.onclick = () => void busy(fresh, () => api.studioNew(), ui.error);
    const cost = h('small', { class: 'muted' }, session?.costUsd ? `$${session.costUsd.toFixed(2)} so far` : '');
    fill(body, log, onFloor, h('div', null, inputBox, h('div', { class: 'row' }, send, cost, h('span', { class: 'grow' }), fresh)));
    if (messages.length !== shownMessages) {
      shownMessages = messages.length;
      requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    } else {
      log.scrollTop = log.scrollHeight;
    }
    if (document.activeElement !== input) input.focus();
  }

  ui.panels.open({ title: 'Studio · Holodeck computer', body, accent: LCARS.gold, docked: true });
  ui.panels.own(state.on('studio', render));
  render();
}

/** A paragraph with its **bold** runs bold, as the computer writes take ids. */
function bold(text: string): (string | HTMLElement)[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? h('b', null, part) : part));
}
