import { statusIcon, statusLine } from '../../../shared/agentStatus';
import { UNIFORM } from '../../../shared/crew';
import type { Agent, PermissionRequest, TermLine } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { h } from '../ui/dom';
import { type Actions, morph } from './actions';
import { workLabel } from './home';

export interface View {
  el: HTMLElement;
  update(): void;
  dispose(): void;
}

type Tab = 'terminal' | 'browser';

const FINISHED = ['done', 'error', 'stopped'];
/** Within this many pixels of the bottom, the terminal follows new lines. */
const FOLLOW_SLACK = 60;

/** The agent's laptop on a phone: terminal or browser, a pinned approval when they raise a hand, and a message box. */
export function agentView(id: string, actions: Actions, back: () => void): View {
  const scope = `agent:${id}`;
  let tab: Tab = 'terminal';
  let follow = true;

  const head = h('div');
  const tabs = h('nav', { class: 'tabs' });
  const terminal = h('div', { class: 'terminal' });
  const browser = h('div', { class: 'browser' });
  const errors = h('div');
  const input = h('input', { type: 'text', enterKeyHint: 'send', autocomplete: 'off' });
  const sendSlot = h('span');
  const compose = h('form', { class: 'compose' }, input, sendSlot);
  const el = h('div', { class: 'drill' },
    h('header', { class: 'top' }, h('a', { class: 'back', href: '#', onclick: (e) => {
      e.preventDefault();
      back();
    } }, '‹ Back'), h('span', { class: 'bar-fill' }, state.project(state.agents.get(id)?.projectId ?? '')?.name ?? '')),
    head, tabs, terminal, browser, errors, compose,
  );

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    void actions.run(`${scope}:message`, () => api.message(id, text)).then((ok) => {
      if (ok && input.value.trim() === text) input.value = '';
    });
  };
  compose.onsubmit = (e) => {
    e.preventDefault();
    send();
  };

  const append = (lines: TermLine[]) => {
    terminal.append(...lines.map((line) => h('div', { class: line.kind }, line.text || ' ')));
    while (terminal.childElementCount > 3000) terminal.firstElementChild?.remove();
    if (follow) terminal.scrollTop = terminal.scrollHeight;
  };
  terminal.onscroll = () => {
    if (tab === 'terminal') follow = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < FOLLOW_SLACK;
  };
  const backfill = () =>
    api.lines(id).then((lines) => {
      terminal.replaceChildren();
      append(lines);
    }).catch(() => undefined);

  const renderHead = (a: Agent) =>
    h('div', null,
      h('section', { class: 'agent-head', style: `--accent:${UNIFORM[a.avatar.division]}` },
        h('h1', null, h('span', { class: 'dot', style: `background:${UNIFORM[a.avatar.division]}` }), a.name, a.task === 'review' ? h('small', null, ' · QA') : null),
        h('div', { class: 'title' }, workLabel(a)),
        h('div', { class: 'pills' },
          h('span', { class: `pill status ${a.status}` }, `${statusIcon(a)} ${a.status}`),
          a.task === 'issue' ? h('a', { class: 'pill link', href: a.issue.url, target: '_blank', rel: 'noreferrer' }, `Issue #${a.issue.number} ↗`) : null,
          a.task !== 'issue' && a.task !== 'lead' ? h('a', { class: 'pill link', href: a.issue.url, target: '_blank', rel: 'noreferrer' }, `PR #${a.issue.number} ↗`) : null,
          a.pr ? h('a', { class: 'pill link go', href: a.pr.url, target: '_blank', rel: 'noreferrer' }, `PR #${a.pr.number} ↗`) : null,
          FINISHED.includes(a.status) ? null : actions.button(`${scope}:stop`, '■ Stop', () => api.stop(id), { class: 'danger small' }),
        ),
        h('div', { class: 'activity' }, statusLine(a)),
        a.status === 'error' && a.error ? h('div', { class: 'error-text' }, a.error) : null,
      ),
      a.permission ? askFor(a, a.permission) : null,
    );

  const askFor = (a: Agent, req: PermissionRequest) =>
    h('section', { class: 'ask', attrs: { 'data-key': req.id } },
      h('strong', null, `✋ ${a.name} wants to run`),
      h('code', null, req.summary),
      h('div', { class: 'actions' },
        actions.button(`${scope}:approve`, '✔ Approve', () => api.permission(id, req.id, true), { class: 'go' }),
        actions.button(`${scope}:decline`, '✘ Decline', () => api.permission(id, req.id, false), { class: 'danger' }),
      ),
    );

  const renderBrowser = (a: Agent) => {
    const frame = state.browser.get(id);
    if (frame?.image) {
      return h('div', null,
        h('div', { class: 'url' }, `🔒 ${frame.url}`),
        h('img', { src: frame.image, alt: frame.title ?? `${a.name}'s browser` }),
      );
    }
    return h('div', null,
      frame ? h('div', { class: 'url' }, `🔒 ${frame.url}`) : null,
      h('p', { class: 'placeholder' }, frame?.mock
        ? `🧪 Demo mode: ${a.name} is looking at “${frame.mock.heading}”. Real agents send a screenshot here.`
        : `No browser yet. When ${a.name} opens a page, the latest screenshot shows up here.`),
    );
  };

  const update = () => {
    const a = state.agents.get(id);
    if (!a) return;
    const next = renderHead(a);
    if (!head.firstElementChild) head.append(next);
    else morph(head.firstElementChild, next);
    morph(tabs, h('nav', null,
      h('button', { type: 'button', class: tab === 'terminal' ? 'on' : '', onclick: () => showTab('terminal') }, 'Terminal'),
      h('button', { type: 'button', class: tab === 'browser' ? 'on' : '', onclick: () => showTab('browser') }, '📷 Browser', state.browser.has(id) ? h('span', { class: 'live' }, ' ●') : null),
    ));
    terminal.hidden = tab !== 'terminal';
    browser.hidden = tab !== 'browser';
    if (tab === 'browser') morph(browser, h('div', null, renderBrowser(a)));
    morph(errors, h('div', null, actions.errors(scope)));
    const sending = actions.pending(`${scope}:message`);
    morph(sendSlot, h('span', null, h('button', { type: 'submit', class: 'btn primary', disabled: sending }, sending ? '…' : 'Send')));
    input.placeholder = FINISHED.includes(a.status)
      ? a.task === 'review'
        ? `Ask ${a.name} to look at something else`
        : a.status === 'done' ? `Ask ${a.name} for changes` : `Tell ${a.name} what to do next`
      : `Message ${a.name}…`;
  };

  const showTab = (next: Tab) => {
    tab = next;
    update();
    if (tab === 'terminal' && follow) terminal.scrollTop = terminal.scrollHeight;
  };

  const offs = [
    state.on('lines', (e) => e.id === id && append(e.lines)),
    // a fresh socket (after the phone slept) brings a snapshot: catch up on the lines missed meanwhile
    state.on('snapshot', () => void backfill()),
  ];

  append(state.lines.get(id) ?? []);
  void backfill();
  update();
  return { el, update, dispose: () => offs.forEach((off) => off()) };
}
