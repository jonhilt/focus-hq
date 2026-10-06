import { statusIcon, statusLine } from '../../../shared/agentStatus';
import { cloudSessionUrl } from '../../../shared/cloud';
import { showsBrowser } from '../../../shared/browserView';
import { helperFor, UNIFORM } from '../../../shared/crew';
import type { Agent, BrowserFrame, Effort, TermLine } from '../../../shared/types';
import { EFFORT_LEVELS } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { drawMockPage } from '../world/screen';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h, timeAgo } from './dom';
import { closeGoal, EFFORT_HINT, noteView, screenToggles, tasksView } from './goals';

const FINISHED = ['done', 'error', 'stopped'];

/** Full-size view of an agent's laptop: terminal, browser, approvals and a chat box. */
let shown: string | null = null;
/** Whether this agent's panel is showing (so the office doesn't toast what you can already see). */
export const agentPanelOpen = (id: string) => shown === id;

export function openAgentPanel(ui: Ui, id: string): void {
  const agent = state.agents.get(id);
  if (!agent) return;

  const terminal = h('div', { class: 'terminal' });
  const browserBar = h('div', { class: 'browser-bar' });
  const browserImg = h('img', { alt: 'Agent browser' });
  const browserCanvas = h('canvas', { width: 640, height: 420 });
  const browser = h('div', { class: 'browser-view' }, browserBar, browserImg, browserCanvas);
  const grid = h('div', { class: 'agent-grid single' }, terminal, browser);
  const ask = h('div');
  const info = h('div', { class: 'row', style: 'margin-bottom:12px' });
  // what they're keeping track of: the goal as a lead keeps it (and whether they think it's done), and the task list
  // Claude keeps for itself
  const goal = h('div', { class: 'goal-panel' });
  const toggles = screenToggles(() => undefined);
  const body = h('div', { style: 'display:flex;flex-direction:column;height:100%;min-height:0' }, ask, info, goal, grid);

  const input = h('input', { type: 'text', placeholder: `Message ${agent.name}… (they'll read it at their next step)`, autofocus: true });
  const send = h('button', { class: 'btn primary' }, 'Send');
  const stop = h('button', { class: 'btn danger' }, '■ Stop');
  const lead = agent.task === 'lead';
  const dismiss = h('button', { class: 'btn', title: lead ? 'File the goal in the room’s log and send its lead home, which frees the station' : undefined }, lead ? '🏁 Close goal' : '👋 Send home');
  const footer = h('div', { class: 'compose' }, withMic(ui, input), send, stop, dismiss);

  const title = h('h2');
  ui.panels.open({ title, body, footer, wide: true, accent: UNIFORM[agent.avatar.division] });
  shown = id;
  ui.panels.own(() => (shown = null));

  const sendMessage = () => {
    const text = input.value.trim();
    if (!text) return;
    void busy(send, async () => {
      await api.message(id, text);
      input.value = '';
    }, ui.error);
  };
  send.onclick = sendMessage;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  stop.onclick = () => void busy(stop, () => api.stop(id), ui.error);
  dismiss.onclick = () => {
    const a = state.agents.get(id);
    if (a?.task === 'lead') return void busy(dismiss, () => closeGoal(a), ui.error);
    if (a && !FINISHED.includes(a.status) && !confirm(`${a.name} is still working. Stop and send them home?`)) return;
    void busy(dismiss, async () => {
      await api.dismiss(id);
      ui.panels.close();
    }, ui.error);
  };

  const appendLines = (lines: TermLine[]) => {
    const nearBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 60;
    for (const line of lines) terminal.append(h('div', { class: line.kind }, line.text || ' '));
    while (terminal.childElementCount > 3000) terminal.firstElementChild?.remove();
    if (nearBottom) terminal.scrollTop = terminal.scrollHeight;
  };

  const renderHeader = (a: Agent) => {
    title.replaceChildren(
      h('span', { class: 'dot', style: `background:${UNIFORM[a.avatar.division]};margin-right:8px;vertical-align:middle` }),
      `${a.name} · `,
      h('span', { class: 'muted', style: 'font-weight:500' }, a.task === 'lead' ? `${a.lead?.title ?? 'Goal'} · team station ${(a.lead?.station ?? 0) + 1} · slice ${a.lead?.slice ?? 1}` : `#${a.issue.number} ${a.issue.title}`),
    );
    fill(
      info,
      h('span', { class: 'chip' }, `${statusIcon(a)} ${a.status}`),
      h('span', { class: 'grow muted' }, statusLine(a)),
      a.costUsd > 0 ? h('span', { class: 'chip', title: 'Estimated usage (on a subscription this is not billed)' }, `~$${a.costUsd.toFixed(2)}`) : null,
      a.task === 'lead' ? leadEffortChip(a) : h('span', { class: 'chip', title: 'How hard Claude thinks on this task' }, `🧠 ${a.effort ?? 'default'} effort`),
      a.cloud ? h('span', { class: 'chip', title: 'Works in a Claude Code cloud session and pushes their own branch' }, '☁ cloud') : null,
      h('span', { class: 'chip' }, `⏱ ${timeAgo(a.startedAt)}`),
      toggles,
      cloudLink(a),
      a.task === 'issue' ? h('a', { class: 'btn small', href: a.issue.url, target: '_blank', rel: 'noreferrer' }, 'Issue ↗') : null,
      a.task === 'review' ? h('a', { class: 'btn small go', href: a.issue.url, target: '_blank', rel: 'noreferrer' }, `PR #${a.issue.number} ↗`) : null,
      a.task === 'review' ? h('button', { class: 'btn small', onclick: () => ui.openQa(a.projectId) }, '🔍 QA reports') : null,
      a.pr ? h('a', { class: 'btn small go', href: a.pr.url, target: '_blank', rel: 'noreferrer' }, `PR #${a.pr.number} ↗`) : null,
      ...(a.lead?.prs ?? []).map((p) =>
        h('a', { class: `btn small${p.outcome ? '' : ' go'}`, href: p.url, target: '_blank', rel: 'noreferrer', title: p.outcome ?? 'open' },
          `${p.outcome === 'merged' ? '✔ ' : p.outcome === 'closed' ? '✕ ' : ''}${p.repo.split('/')[1]} #${p.number} ↗`)),
      ...(a.helpers ?? []).map((x) =>
        h('span', { class: 'chip', title: `${x.description}\n${x.activity}` }, `${x.status === 'working' ? '🧑‍🚀' : x.status === 'done' ? '✔' : '✘'} ${helperFor(x.id).name}: ${x.description}`)),
      a.task === 'lead' ? h('button', { class: 'btn small', onclick: () => ui.openBoard(a.projectId, 'prs') }, '📋 Board') : null,
      a.pr && a.status === 'done'
        ? h('button', { class: 'btn small', title: 'Run the PR on your machine and open it in your browser', onclick: () => ui.previewPr(a.projectId, a.repo, a.pr!.number) }, '▶ Preview')
        : null,
    );
    const note = noteView(a.lead?.note);
    const tasks = tasksView(a.tasks);
    fill(goal,
      a.lead?.closing ? h('p', { class: 'goal-closing' }, `🏁 ${a.name} thinks this goal is ready to wrap up: ${a.lead.closing.reason}. Close it, or tell them what's next.`) : null,
      note || tasks ? h('div', { class: 'progress-columns' }, note, tasks) : null,
    );
    if (a.permission) {
      const req = a.permission;
      const approve = h('button', { class: 'btn go' }, '✔ Approve');
      const decline = h('button', { class: 'btn danger' }, '✘ Decline');
      approve.onclick = () => void busy(approve, () => api.permission(id, req.id, true), ui.error);
      decline.onclick = () => void busy(decline, () => api.permission(id, req.id, false), ui.error);
      ask.replaceChildren(
        h('div', { class: 'ask' }, h('strong', null, `✋ ${a.name} wants to run`), h('code', { class: 'grow' }, req.summary), approve, decline),
      );
    } else {
      ask.replaceChildren();
    }
    stop.disabled = FINISHED.includes(a.status);
    input.placeholder = FINISHED.includes(a.status)
      ? a.task === 'lead'
        ? `Talk to ${a.name}`
        : a.task === 'review'
        ? `Ask ${a.name} to look at something else on PR #${a.issue.number}`
        : a.status === 'done'
        ? `Ask ${a.name} for changes – they'll update the PR`
        : `Tell ${a.name} what to do next to pick the work back up`
      : `Message ${a.name}… (they'll read it at their next step)`;
  };

  const renderBrowser = (frame: BrowserFrame | undefined) => {
    const shown = showsBrowser(frame);
    grid.classList.toggle('single', !shown);
    browser.style.display = shown ? '' : 'none';
    if (!shown) return;
    browserBar.textContent = `🔒 ${frame.url}${frame.title ? ` — ${frame.title}` : ''}`;
    if (frame.image) {
      browserImg.style.display = '';
      browserCanvas.style.display = 'none';
      if (browserImg.src !== frame.image) browserImg.src = frame.image;
    } else if (frame.mock) {
      browserImg.style.display = 'none';
      browserCanvas.style.display = '';
      const ctx = browserCanvas.getContext('2d')!;
      drawMockPage(ctx, frame.mock, 0, 0, browserCanvas.width, browserCanvas.height);
    }
  };

  /** A lead's effort, changeable any time: from their next request if they're working, else their next turn. */
  const leadEffortChip = (a: Agent) => {
    const select = h('select', { class: 'effort', title: `How hard ${a.name} thinks. A change applies from their next request, and costs a little (the prompt cache starts over).` },
      ...EFFORT_LEVELS.map((e) => h('option', { value: e, selected: e === a.effort, title: EFFORT_HINT[e] }, `🧠 ${e} effort`)),
    );
    select.onchange = () => {
      const level = EFFORT_LEVELS.find((e) => e === select.value);
      if (level) void api.setEffort(id, level).catch((e: Error) => ui.error(e.message));
    };
    return select;
  };

  renderHeader(agent);
  renderBrowser(state.browser.get(id));
  appendLines(state.lines.get(id) ?? []);
  terminal.scrollTop = terminal.scrollHeight;
  // load the full history in the background
  void api.lines(id).then((lines) => {
    terminal.replaceChildren();
    appendLines(lines);
    terminal.scrollTop = terminal.scrollHeight;
  }).catch(() => undefined);

  ui.panels.own(state.on('lines', (e) => e.id === id && appendLines(e.lines)));
  ui.panels.own(state.on('agent', (a) => a.id === id && renderHeader(a)));
  ui.panels.own(state.on('browser', (agentId) => agentId === id && renderBrowser(state.browser.get(id))));
  ui.panels.own(state.on('agent-removed', (a) => {
    if (a.id === id) {
      ui.panels.close();
      ui.hud.toast('info', `${a.name} has gone off duty`);
    }
  }));
}

/** Picks the effort an agent is hired at. The empty value leaves it to the model's default. */
export function effortPicker(value?: Effort): HTMLSelectElement {
  return h('select', { class: 'effort', title: 'How hard Claude thinks on this task' },
    h('option', { value: '', selected: !value }, '🧠 default'),
    ...EFFORT_LEVELS.map((e) => h('option', { value: e, selected: e === value }, `🧠 ${e}`)),
  );
}

export const pickedEffort = (picker: HTMLSelectElement): Effort | undefined => EFFORT_LEVELS.find((e) => e === picker.value);

/** Picks where an agent works: on this machine, or in a Claude Code cloud session. */
export function wherePicker(cloud = false): HTMLSelectElement {
  return h('select', { class: 'effort', title: "Where the agent works: on this machine, or in a Claude Code cloud session (claude.ai/code). If Claude Code won't start a cloud session, the agent carries on locally" },
    h('option', { value: '', selected: !cloud }, '💻 local'),
    h('option', { value: 'cloud', selected: cloud }, '☁ cloud'),
  );
}

export const pickedCloud = (picker: HTMLSelectElement): boolean => picker.value === 'cloud';

/** Opens a cloud agent's session on claude.ai, once Claude Code has reported it. */
export function cloudLink(a: Agent): HTMLElement | null {
  const url = cloudSessionUrl(a);
  return url ? h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noreferrer', title: 'Watch or steer the session on claude.ai' }, 'Cloud session ↗') : null;
}
