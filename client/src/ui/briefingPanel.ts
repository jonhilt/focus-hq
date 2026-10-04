import { plannerFor } from '../../../shared/crew';
import type { Brief } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { busy, fill, h } from './dom';

let open = false;
/** Whether the briefing panel is showing (so the office doesn't toast what you can already see). */
export const briefingPanelOpen = () => open;

/**
 * The observation lounge's briefing: the conversation with the project's operations officer on the left, the brief
 * they keep on the wall screen on the right. With no briefing in session, a form to call one.
 */
export function openBriefingPanel(ui: Ui, projectId?: string): void {
  const body = h('div', { class: 'briefing' });
  const title = h('h2');
  // the message box outlives re-renders, so a reply arriving doesn't wipe what you're typing
  const input = h('textarea', { class: 'briefing-input', placeholder: 'Your answer… (Enter to send, Shift+Enter for a new line)' });
  const send = h('button', { class: 'btn primary' }, 'Send');
  const sendNow = () => {
    if (!input.value.trim() || send.disabled) return;
    const text = input.value;
    void busy(send, async () => {
      await api.briefingSay(text);
      input.value = '';
    }, ui.error);
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
    const briefing = state.briefing;
    if (!briefing) {
      shownMessages = -1;
      title.textContent = '🖖 Observation lounge';
      fill(body, callForm(ui, projectId));
      return;
    }
    const officer = plannerFor(briefing.projectId);
    const project = state.project(briefing.projectId);
    title.textContent = `🖖 Briefing: ${project?.name ?? 'a project'}`;
    const yourTurn = briefing.status === 'waiting' || briefing.status === 'failed';
    input.disabled = !yourTurn;
    send.disabled = !yourTurn;

    const log = h('div', { class: 'briefing-log' },
      ...briefing.messages.map((m) =>
        m.from === 'system'
          ? h('div', { class: 'briefing-note' }, m.text)
          : h('div', { class: `briefing-msg ${m.from}` },
              h('strong', null, m.from === 'manager' ? 'You' : officer.name),
              ...m.text.split(/\n{2,}/).map((p) => h('p', null, p)),
            ),
      ),
      briefing.status === 'thinking' || briefing.status === 'wrapping-up'
        ? h('div', { class: 'briefing-msg officer typing' }, h('strong', null, officer.name), h('p', null, `✻ ${briefing.activity}`))
        : null,
      briefing.status === 'failed' ? h('div', { class: 'briefing-note error' }, `⚠ ${briefing.error ?? 'Something went wrong'}. Say something to carry on.`) : null,
    );

    const wrap = h('button', { class: 'btn', title: `${officer.name} writes it up as one issue at the stand` }, '📋 Wrap up');
    wrap.disabled = !yourTurn || briefing.messages.length < 2;
    wrap.onclick = () => void busy(wrap, () => api.briefingWrapUp(), ui.error);
    const end = h('button', { class: 'btn small' }, briefing.status === 'done' ? '✕ End briefing' : '✕ End without an issue');
    end.onclick = () => {
      if (briefing.status === 'done' || confirm(`End the briefing? ${officer.name} won't write anything up.`)) void api.briefingEnd().catch((e: Error) => ui.error(e.message));
    };

    const controls = briefing.status === 'done'
      ? h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => ui.openNewIssue(briefing.projectId) }, '📝 Open the draft'),
          h('span', { class: 'grow' }),
          end,
        )
      : h('div', null,
          input,
          h('div', { class: 'row' }, send, wrap, h('small', { class: 'muted' }, briefing.costUsd ? `$${briefing.costUsd.toFixed(2)} so far` : ''), h('span', { class: 'grow' }), end),
        );

    fill(body,
      h('div', { class: 'briefing-chat' }, log, controls),
      h('aside', { class: 'briefing-brief' }, briefView(briefing.brief, briefing.idea)),
    );
    if (briefing.messages.length !== shownMessages) {
      shownMessages = briefing.messages.length;
      requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    } else {
      log.scrollTop = log.scrollHeight;
    }
    if (yourTurn && document.activeElement !== input) input.focus();
  };

  ui.panels.open({ title, body, accent: '#e5dbff', wide: true });
  open = true;
  ui.panels.own(() => (open = false));
  ui.panels.own(state.on('briefing', render));
  ui.panels.own(state.on('projects', render));
  render();
}

function callForm(ui: Ui, projectId?: string): HTMLElement {
  const projects = state.projects.filter((p) => p.repos.length);
  if (!projects.length) return h('div', { class: 'empty' }, 'Connect a repository to a project first: the officer reads its code during the briefing.');
  const project = h('select', null, ...projects.map((p) => h('option', { value: p.id, selected: p.id === projectId }, p.name)));
  const officer = h('p', { class: 'muted' });
  const showOfficer = () => (officer.textContent = `${plannerFor(project.value).name}, ${state.project(project.value)?.name}'s operations officer, will join you.`);
  project.addEventListener('change', showOfficer);
  showOfficer();
  const idea = h('textarea', { placeholder: 'What do you want to talk through? e.g. a wishlist that follows shoppers across devices', autofocus: true });
  const go = h('button', { class: 'btn primary' }, '📣 Call the briefing');
  go.onclick = () => void busy(go, () => api.callBriefing(project.value, idea.value), ui.error);
  return h('div', { class: 'briefing-call' },
    h('p', null, 'For anything bigger or fuzzier than a one-line issue. The officer reads the code, asks you questions one at a time and keeps a brief on the wall screen. When you wrap up, they write one issue to the project’s stand.'),
    h('div', { class: 'field' }, h('label', null, 'Project'), project),
    officer,
    h('div', { class: 'field' }, h('label', null, 'Topic'), idea),
    go,
  );
}

function briefView(brief: Brief, idea: string): HTMLElement {
  const section = (label: string, entries: string[], cls = '') =>
    h('div', { class: `brief-section ${cls}` },
      h('h4', null, label),
      entries.length ? h('ul', null, ...entries.map((e) => h('li', null, e))) : h('p', { class: 'muted' }, '—'),
    );
  return h('div', null,
    h('h3', null, brief.summary || idea),
    section('Why', brief.why ? [brief.why] : [], 'why'),
    section('Who for', brief.who ? [brief.who] : [], 'who'),
    section('Scope', brief.scope, 'scope'),
    section('Out of scope', brief.outOfScope, 'out'),
    section('Acceptance criteria', brief.acceptance, 'acceptance'),
    section('Open questions', brief.openQuestions, 'open'),
  );
}
