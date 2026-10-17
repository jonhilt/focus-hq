import { type PersonalEntry, personalLogView, snoozeUntil } from '../../../shared/personalLog';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, h, timeAgo } from './dom';

/**
 * The ready room's personal log: a box to jot a thought down in (Enter logs it), and what's in the log: what's on your
 * mind, what you've put aside till later, and what you've done or dropped.
 */
export function personalLogTab(ui: Ui): HTMLElement {
  const text = h('textarea', { class: 'personal-jot', placeholder: 'An idea, something to come back to… (Enter logs it, Shift+Enter for a new line)', rows: 3 });
  const log = h('button', { class: 'btn primary' }, 'Log it');
  const save = () => {
    if (!text.value.trim()) return;
    void busy(log, async () => {
      await api.notePersonal(text.value);
      text.value = '';
      text.focus();
    }, ui.error);
  };
  log.onclick = save;
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      save();
    }
  });
  queueMicrotask(() => text.focus());

  return h('div', { class: 'personal-log' },
    h('div', { class: 'field' }, withMic(ui, text)),
    h('div', { class: 'row', style: 'margin-bottom:14px' }, log),
    h('div', { class: 'personal-entries' }, personalEntries(ui)),
  );
}

/** What's in the log, under the jot box: drawn again on its own as the log changes, so what's being typed stays put. */
export function personalEntries(ui: Ui): HTMLElement[] {
  const view = personalLogView(state.personalLog, Date.now());
  const section = (title: string, entries: PersonalEntry[], empty?: string) =>
    entries.length || empty
      ? [h('div', { class: 'personal-section' }, h('h3', null, title, ' ', h('span', { class: 'chip' }, String(entries.length))),
          entries.length ? entries.map((e) => entryCard(ui, e)) : h('p', { class: 'muted' }, empty))]
      : [];
  return [
    ...section('On your mind', view.open, 'Nothing yet. Press I anywhere aboard to jot a thought down.'),
    ...section('Put aside', view.later),
    ...section('Done and dropped', view.closed),
  ];
}

function entryCard(ui: Ui, e: PersonalEntry): HTMLElement {
  const act = (label: string, body: Parameters<typeof api.markPersonal>[1]) => {
    const button = h('button', { class: 'btn small' }, label);
    button.onclick = () => void busy(button, () => api.markPersonal(e.id, body), ui.error);
    return button;
  };
  const when = [timeAgo(e.at), e.from === 'remote' ? 'from off the ship' : undefined, e.via ? `via ${e.via}` : undefined, e.until && e.status === 'open' ? `back ${new Date(e.until).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : undefined, e.status === 'done' ? 'done' : e.status === 'dropped' ? 'dropped' : undefined];
  const actions = e.status === 'open'
    ? [act('Done', { kind: 'done' }), act('Tomorrow', { kind: 'snoozed', until: snoozeUntil(new Date(), 'tomorrow') }), act('Next week', { kind: 'snoozed', until: snoozeUntil(new Date(), 'week') }), act('Drop', { kind: 'dropped' })]
    : [act('Reopen', { kind: 'reopened' })];
  if (e.status === 'open' && e.until) actions.splice(1, 2, act('Back now', { kind: 'reopened' }));
  return h('div', { class: `card personal-entry${e.status === 'open' ? '' : ' closed'}` },
    h('p', { class: 'personal-text' }, e.text),
    h('div', { class: 'row' }, h('small', { class: 'muted grow' }, when.filter(Boolean).join(' · ')), ...actions),
  );
}
