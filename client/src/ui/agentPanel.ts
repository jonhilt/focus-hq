import { contextLevel, statusLine } from '../../../shared/agentStatus';
import { cloudSessionUrl } from '../../../shared/cloud';
import { showsBrowser } from '../../../shared/browserView';
import { helperFor, UNIFORM } from '../../../shared/crew';
import type { Agent, BrowserFrame, Effort, Helper, TermLine } from '../../../shared/types';
import { EFFORT_LEVELS } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { drawMockPage } from '../world/screen';
import { LCARS, LCARS_STATUS } from '../world/starship';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h, timeAgo } from './dom';
import { closeGoal, CONTEXT_TONE, EFFORT_HINT, noteView, prLink, reviewing, tasksView } from './goals';
import { type NavItem, readout, shownView, SideNav } from './panels';
import { TermView } from './terminal';

const FINISHED = ['done', 'error', 'stopped'];

/** What the right of an agent's panel can show beside their terminal, picked from its sidebar. */
export type AgentView = 'browser' | 'goal' | 'tasks' | 'crew';
type View = AgentView;

const HELPER_TONE: Record<Helper['status'], string> = { working: LCARS.sky, done: LCARS_STATUS.done, failed: LCARS.red };

/** The sidebar's views for this agent: a goal and a crew only for a lead, each on standby while there's nothing in it. */
function views(a: Agent, frame: BrowserFrame | undefined): NavItem<View>[] {
  const browsing = showsBrowser(frame);
  const tasks = a.tasks ?? [];
  const slice = a.lead?.note?.slice ?? [];
  const helpers = a.helpers ?? [];
  const lead = a.task === 'lead';
  const items: (NavItem<View> | false)[] = [
    { key: 'browser', label: 'Browser', readout: browsing ? 'Live' : '', standby: !browsing },
    lead && { key: 'goal', label: 'Goal', readout: slice.length ? `${slice.filter((i) => i.done).length}/${slice.length}` : '' },
    { key: 'tasks', label: 'Tasks', readout: tasks.length ? `${tasks.filter((t) => t.status === 'completed').length}/${tasks.length}` : '', standby: !tasks.length },
    lead && { key: 'crew', label: 'Crew', readout: helpers.length ? String(helpers.length) : '', standby: !helpers.length },
  ];
  return items.filter((i) => i !== false);
}

/** Full-size view of an agent's laptop: terminal on the left, their browser (or a lead's goal, tasks, crew) on the right. */
let shown: string | null = null;
/** Whether this agent's panel is showing (so the office doesn't toast what you can already see). */
export const agentPanelOpen = (id: string) => shown === id;

/** Opens an agent's panel, on `view` if given. */
export function openAgentPanel(ui: Ui, id: string, view?: AgentView): void {
  const agent = state.agents.get(id);
  if (!agent) return;

  const term = new TermView();
  const terminal = term.el;
  const browserBar = h('div', { class: 'browser-bar' });
  const browserImg = h('img', { alt: 'Agent browser' });
  const browserCanvas = h('canvas', { width: 640, height: 420 });
  const browser = h('div', { class: 'pane browser-view' }, browserBar, browserImg, browserCanvas);
  const info = h('div', { class: 'pane' });
  const grid = h('div', { class: 'agent-grid' }, terminal, browser, info);
  const ask = h('div');
  const readouts = h('div', { class: 'readouts' });
  const closing = h('div');
  const body = h('div', { class: 'agent-body' }, ask, readouts, closing, grid);

  // the view you picked (or opened it on) stays put; until you pick one, it's the first with something in it
  let picked: View | undefined = view;
  const nav = new SideNav<View>((view) => {
    picked = view;
    renderViews();
  });

  const input = h('input', { type: 'text', placeholder: `Message ${agent.name}… (they'll read it at their next step)`, autofocus: true });
  const send = h('button', { class: 'btn primary' }, 'Send');
  const stop = h('button', { class: 'btn danger' }, 'Stop');
  const lead = agent.task === 'lead';
  const dismiss = h('button', { class: 'btn', title: lead ? 'File the goal in the room’s log and send its lead home, which frees the station' : undefined }, lead ? 'Close goal' : 'Send home');
  const footer = h('div', { class: 'compose' }, withMic(ui, input), send, stop, dismiss);

  const title = h('h2');
  ui.panels.open({ title, body, footer, nav, wide: true, accent: UNIFORM[agent.avatar.division] });
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
    term.append(lines);
    if (nearBottom) terminal.scrollTop = terminal.scrollHeight;
  };

  const renderHeader = (a: Agent) => {
    title.replaceChildren(a.name, h('span', { class: 'muted' }, ` · ${a.task === 'lead' ? a.lead?.title ?? 'Goal' : `#${a.issue.number} ${a.issue.title}`}`));
    fill(
      readouts,
      readout('Status', a.status, { tone: LCARS_STATUS[a.status] }),
      readout('Activity', statusLine(a), { grow: true }),
      a.task === 'lead' ? readout('Station', String((a.lead?.station ?? 0) + 1)) : null,
      a.task === 'lead' ? readout('Slice', String(a.lead?.slice ?? 1)) : null,
      readout('Effort', a.task === 'lead' ? leadEffortPicker(a) : a.effort ?? 'default'),
      contextReadout(a),
      readout('Started', timeAgo(a.startedAt)),
      a.costUsd > 0 ? readout('Usage', `~$${a.costUsd.toFixed(2)}`, { title: 'Estimated usage (on a subscription this is not billed)' }) : null,
      a.cloud ? readout('Works in', 'Cloud', { title: 'Works in a Claude Code cloud session and pushes their own branch' }) : null,
      h('div', { class: 'links' },
        cloudLink(a),
        a.task === 'issue' ? h('a', { class: 'btn small', href: a.issue.url, target: '_blank', rel: 'noreferrer' }, 'Issue ↗') : null,
        a.task === 'review' ? h('a', { class: 'btn small go', href: a.issue.url, target: '_blank', rel: 'noreferrer' }, `PR #${a.issue.number} ↗`) : null,
        a.task === 'review' ? h('button', { class: 'btn small', onclick: () => ui.openQa(a.projectId) }, 'QA reports') : null,
        a.pr ? h('a', { class: 'btn small go', href: a.pr.url, target: '_blank', rel: 'noreferrer' }, `PR #${a.pr.number} ↗`) : null,
        a.task === 'lead' ? h('button', { class: 'btn small', onclick: () => ui.openBoard(a.projectId, 'prs') }, 'Board') : null,
        a.pr && a.status === 'done'
          ? h('button', { class: 'btn small', title: 'Run the PR on your machine and open it in your browser', onclick: () => ui.previewPr(a.projectId, a.repo, a.pr!.number) }, 'Preview')
          : null,
      ),
    );
    fill(closing, a.lead?.closing ? h('p', { class: 'goal-closing' }, `${a.name} thinks this goal is ready to wrap up: ${a.lead.closing.reason}. Close it, or tell them what's next.`) : null);
    if (a.permission) {
      const req = a.permission;
      const approve = h('button', { class: 'btn go' }, 'Approve');
      const decline = h('button', { class: 'btn danger' }, 'Decline');
      approve.onclick = () => void busy(approve, () => api.permission(id, req.id, true), ui.error);
      decline.onclick = () => void busy(decline, () => api.permission(id, req.id, false), ui.error);
      ask.replaceChildren(
        h('div', { class: 'ask' }, h('strong', null, `${a.name} wants to run`), h('code', { class: 'grow' }, req.summary), approve, decline),
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

  /** The sidebar, and whichever view it has picked beside the terminal (none: the terminal takes the width). */
  const renderViews = () => {
    const a = state.agents.get(id);
    if (!a) return;
    const items = views(a, state.browser.get(id));
    const view = shownView(items, picked);
    nav.show(items, view);
    grid.classList.toggle('single', !view);
    browser.style.display = view === 'browser' ? '' : 'none';
    info.style.display = view && view !== 'browser' ? '' : 'none';
    if (!view || view === 'browser') return;
    const next = view === 'goal' ? goalView(a) : view === 'tasks' ? tasksView(a.tasks) : crewView(a);
    // what hasn't changed stays put, so a click on it isn't lost to a redraw
    if (info.childElementCount === 1 && info.firstElementChild?.isEqualNode(next)) return;
    const top = info.scrollTop;
    fill(info, next);
    info.scrollTop = top;
  };

  const renderBrowser = (frame: BrowserFrame | undefined) => {
    if (!showsBrowser(frame)) return;
    browserBar.textContent = `${frame.url}${frame.title ? ` — ${frame.title}` : ''}`;
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

  /** What the goal is, its note as the lead keeps it, and the pull requests it's shipped. */
  const goalView = (a: Agent) => {
    const prs = a.lead?.prs ?? [];
    return h('div', { class: 'goal-note' },
      h('div', null, h('h4', null, 'Goal'), a.lead?.title ?? a.issue.title),
      noteView(a.lead?.note),
      prs.length || reviewing(a) ? h('div', null, h('h4', null, 'Pull requests'), h('div', { class: 'row' }, ...prs.map(prLink)), reviewing(a)) : null,
    );
  };

  /** The helpers a lead has handed work to: what each was asked, and what it's doing or how it got on. Click one for its transcript. */
  const crewView = (a: Agent) =>
    h('div', { class: 'crew' },
      ...(a.helpers ?? []).map((x) =>
        h('div', { class: 'crew-member', style: `--tone:${HELPER_TONE[x.status]}`, title: 'Open their transcript', onclick: () => ui.openHelper(a.id, x.id) },
          h('h4', { style: 'margin:0' }, `${helperFor(x.id).name} · ${x.status}`),
          h('p', null, x.description),
          x.activity ? h('p', { class: 'muted' }, x.activity) : null,
        )),
    );

  /** How full their context is, and (between turns) a button to compact it. */
  const contextReadout = (a: Agent) => {
    if (!a.context) return null;
    const canCompact = a.task !== 'review' && !a.cloud && !!a.sessionId && FINISHED.includes(a.status);
    const compact = canCompact ? h('button', { class: 'btn small', style: 'margin-left:8px', title: 'Summarise the conversation now, keeping what the work needs, so the next turn starts lighter' }, 'Compact') : null;
    if (compact) compact.onclick = () => void busy(compact, () => api.compact(id), ui.error);
    return readout('Context', h('span', null, `${a.context.percent}%`, compact), {
      tone: CONTEXT_TONE[contextLevel(a.context.percent)],
      title: `${a.context.tokens.toLocaleString()} of ${a.context.max.toLocaleString()} tokens in ${a.name}'s context. Claude Code compacts it by itself when it fills up.`,
    });
  };

  /** A lead's effort, changeable any time: from their next request if they're working, else their next turn. */
  const leadEffortPicker = (a: Agent) => {
    const select = h('select', { class: 'effort', title: `How hard ${a.name} thinks. A change applies from their next request, and costs a little (the prompt cache starts over).` },
      ...EFFORT_LEVELS.map((e) => h('option', { value: e, selected: e === a.effort, title: EFFORT_HINT[e] }, e)),
    );
    select.onchange = () => {
      const level = EFFORT_LEVELS.find((e) => e === select.value);
      if (level) void api.setEffort(id, level).catch((e: Error) => ui.error(e.message));
    };
    return select;
  };

  renderHeader(agent);
  renderBrowser(state.browser.get(id));
  renderViews();
  appendLines(state.lines.get(id) ?? []);
  terminal.scrollTop = terminal.scrollHeight;
  // load the full history in the background
  void api.lines(id).then((lines) => {
    term.clear();
    appendLines(lines);
    terminal.scrollTop = terminal.scrollHeight;
  }).catch(() => undefined);

  ui.panels.own(state.on('lines', (e) => e.id === id && appendLines(e.lines)));
  ui.panels.own(state.on('agent', (a) => {
    if (a.id !== id) return;
    renderHeader(a);
    renderViews();
  }));
  ui.panels.own(state.on('browser', (agentId) => {
    if (agentId !== id) return;
    renderBrowser(state.browser.get(id));
    renderViews();
  }));
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
    h('option', { value: '', selected: !value }, 'default effort'),
    ...EFFORT_LEVELS.map((e) => h('option', { value: e, selected: e === value }, `${e} effort`)),
  );
}

export const pickedEffort = (picker: HTMLSelectElement): Effort | undefined => EFFORT_LEVELS.find((e) => e === picker.value);

/** Picks where an agent works: on this machine, or in a Claude Code cloud session. */
export function wherePicker(cloud = false): HTMLSelectElement {
  return h('select', { class: 'effort', title: "Where the agent works: on this machine, or in a Claude Code cloud session (claude.ai/code). If Claude Code won't start a cloud session, the agent carries on locally" },
    h('option', { value: '', selected: !cloud }, 'local'),
    h('option', { value: 'cloud', selected: cloud }, 'cloud'),
  );
}

export const pickedCloud = (picker: HTMLSelectElement): boolean => picker.value === 'cloud';

/** Opens a cloud agent's session on claude.ai, once Claude Code has reported it. */
export function cloudLink(a: Agent): HTMLElement | null {
  const url = cloudSessionUrl(a);
  return url ? h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noreferrer', title: 'Watch or steer the session on claude.ai' }, 'Cloud session ↗') : null;
}
