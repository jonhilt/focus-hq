import { contextLevel, runLine, statusLine } from '../../../shared/agentStatus';
import { AUTONOMY_LABEL, AUTONOMY_MODES, effectiveAutonomy } from '../../../shared/autonomy';
import { cloudSessionUrl } from '../../../shared/cloud';
import { showsBrowser } from '../../../shared/browserView';
import { helperFor, UNIFORM } from '../../../shared/crew';
import type { Agent, Autonomy, BackgroundTask, BrowserFrame, Effort, Helper, TermLine, Workflow, WorkflowAgent } from '../../../shared/types';
import { EFFORT_LEVELS } from '../../../shared/types';
import { api } from '../net/api';
import { markRead } from '../net/attention';
import { state } from '../net/state';
import { runningFor } from '../world/probeSlots';
import { drawMockPage } from '../world/screen';
import { LCARS, LCARS_STATUS } from '../world/starship';
import type { Ui } from './context';
import { confirmDialog } from './confirmDialog';
import { withMic } from './dictation';
import { busy, fill, h, timeAgo } from './dom';
import { closeGoal, CONTEXT_TONE, EFFORT_HINT, noteView, prLink, reviewing, tasksView } from './goals';
import { type NavItem, readout, shownView, SideNav } from './panels';
import { messageAgent } from './resume';
import { RunReplay } from './runReplay';
import { TermView } from './terminal';

const AUTONOMY_HINT: Record<Autonomy, string> = {
  ask: 'Edits and common dev commands run freely; anything else and they raise their hand.',
  auto: "Claude Code's auto-mode classifier approves safe actions; they raise their hand only when it can't decide.",
  full: 'No permission checks at all: they can run any command on this machine, as you, without asking.',
};

const FINISHED = ['done', 'error', 'stopped'];

/** What the right of an agent's panel can show beside their terminal, picked from its sidebar. */
export type AgentView = 'browser' | 'goal' | 'tasks' | 'crew' | 'run';
type View = AgentView;

const HELPER_TONE: Record<Helper['status'], string> = { working: LCARS.sky, done: LCARS_STATUS.done, failed: LCARS.red };
const BACKGROUND_TONE: Record<BackgroundTask['status'], string> = { running: LCARS.sky, done: LCARS_STATUS.done, failed: LCARS.red, stopped: LCARS_STATUS.stopped };
const WORKFLOW_TONE: Record<Workflow['status'], string> = { running: LCARS.lilac, done: LCARS_STATUS.done, failed: LCARS.red };
const AGENT_MARK: Record<WorkflowAgent['status'], string> = { queued: '·', working: '▸', done: '✓', failed: '✕' };

/** The sidebar's views for this agent: a goal and a crew only for a lead, each on standby while there's nothing in it. */
function views(a: Agent, frame: BrowserFrame | undefined): NavItem<View>[] {
  const browsing = showsBrowser(frame);
  const tasks = a.tasks ?? [];
  const crew = (a.helpers ?? []).length + (a.workflows ?? []).length + (a.background ?? []).length;
  const lead = a.task === 'lead';
  const items: (NavItem<View> | false)[] = [
    { key: 'browser', label: 'Browser', readout: browsing ? 'Live' : '', standby: !browsing },
    lead && { key: 'goal', label: 'Goal', readout: '' },
    { key: 'tasks', label: 'Tasks', readout: tasks.length ? `${tasks.filter((t) => t.status === 'completed').length}/${tasks.length}` : '', standby: !tasks.length },
    lead && { key: 'crew', label: 'Crew', readout: crew ? String(crew) : '', standby: !crew },
    // the run's journal, replayed: there whenever it has one, shown once picked
    { key: 'run', label: 'Run', readout: a.run ? `#${a.run.seq}` : '', standby: !a.run, onDemand: true },
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
  const replay = new RunReplay(id);
  const grid = h('div', { class: 'agent-grid' }, terminal, browser, info, replay.el);
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
  // a lead's Close goal is up with the links, out of the way of Send; anyone else's Send home stays here
  const lead = agent.task === 'lead';
  const dismiss = lead ? null : h('button', { class: 'btn' }, 'Send home');
  const footer = h('div', { class: 'compose' }, withMic(ui, input), send, stop, dismiss);
  // made once and put back on every redraw of the header, so it keeps its busy state while the goal closes
  const close = lead ? h('button', { class: 'btn small', title: 'File the goal in the room’s log and send its lead home, which frees the station' }, 'Close goal') : null;
  if (close) close.onclick = () => {
    const a = state.agents.get(id);
    if (a) void busy(close, () => closeGoal(a), ui.error);
  };

  // made once, so it keeps its busy state while their work goes onto GitHub
  const moveToCloud = h('button', { class: 'btn small', title: 'Carry on in a Claude Code cloud session: their work so far goes onto their branch on GitHub, and you start the session' }, '☁ Move to cloud');
  moveToCloud.onclick = async () => {
    const a = state.agents.get(id);
    if (!a) return;
    const working = !FINISHED.includes(a.status);
    if (!await confirmDialog({
      title: 'Move to cloud',
      message: `${working ? `${a.name} stops what they're doing, and their` : `${a.name}'s`} work so far is committed and pushed to ${a.branch}. Then you start a cloud session for them to carry on in: Focus can open a terminal that starts it.`,
      confirmLabel: 'Move to cloud',
    })) return;
    void busy(moveToCloud, () => api.moveToCloud(id), ui.error);
  };
  let handoverKey = '';
  /** Starting the cloud session a waiting agent carries on in: a terminal that starts it, or a link to one. */
  const handoverAsk = (a: Agent) => {
    const watching = !!a.handover?.terminalAt;
    const start = h('button', { class: 'btn go', title: 'Opens a terminal on this machine running claude --cloud in their worktree. Claude Code starts a new cloud session only from a terminal; Focus picks it up from there' }, watching ? '▶ Open another terminal' : '▶ Start in a terminal');
    start.onclick = () => void busy(start, () => api.cloudTerminal(id), ui.error);
    const link = h('input', { type: 'text', placeholder: '…or paste a claude.ai/code session link', style: 'flex:1;min-width:220px' });
    const attach = h('button', { class: 'btn' }, 'Use it');
    const attachLink = () => {
      if (link.value.trim()) void busy(attach, () => api.attachCloud(id, link.value.trim()), ui.error);
    };
    attach.onclick = attachLink;
    link.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') attachLink();
    });
    const stay = h('button', { class: 'btn', title: 'Keep them on this machine instead' }, 'Keep local');
    stay.onclick = () => void busy(stay, () => api.stayLocal(id), ui.error);
    return h('div', { class: 'ask' },
      h('strong', null, '☁ Cloud session'),
      h('span', { class: 'muted' }, watching ? 'Waiting for the terminal to start it…' : `${a.name} is waiting for one`),
      start, link, attach, stay,
    );
  };

  const title = h('h2');
  ui.panels.open({ title, body, footer, nav, wide: true, accent: UNIFORM[agent.avatar.division] });
  shown = id;
  ui.panels.own(() => (shown = null));
  // reading a lead's turn here answers their hail, on every screen, whether or not you reply; coming back to this
  // window with their panel open counts too
  markRead(agent);
  const readAgain = () => {
    const a = state.agents.get(id);
    if (a) markRead(a);
  };
  window.addEventListener('focus', readAgain);
  ui.panels.own(() => window.removeEventListener('focus', readAgain));

  const sendMessage = () => {
    const text = input.value.trim();
    if (!text) return;
    void busy(send, async () => {
      if (await messageAgent(id, state.agents.get(id)?.name ?? 'They', text)) input.value = '';
    }, ui.error);
  };
  send.onclick = sendMessage;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  stop.onclick = () => void busy(stop, () => api.stop(id), ui.error);
  if (dismiss) dismiss.onclick = async () => {
    const a = state.agents.get(id);
    if (a && !FINISHED.includes(a.status) && !await confirmDialog({ title: 'Send home', message: `${a.name} is still working. Stop and send them home?`, confirmLabel: 'Send home', danger: true })) return;
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
    // a bar coming or going above the terminal (a hand up, a cloud session to start) leaves it scrolled to the end
    const atEnd = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 60;
    title.replaceChildren(a.name, h('span', { class: 'muted' }, ` · ${a.task === 'lead' ? a.lead?.title ?? 'Goal' : a.brief ? `${a.brief.label}: ${a.issue.title}` : `#${a.issue.number} ${a.issue.title}`}`));
    fill(
      readouts,
      readout('Status', a.status, { tone: LCARS_STATUS[a.status] }),
      readout('Activity', statusLine(a), { grow: true }),
      a.run ? readout('Run', runLine(a.run), { title: `Where their run is, as its journal tells it (fact #${a.run.seq})` }) : null,
      a.task === 'lead' ? readout('Station', String((a.lead?.station ?? 0) + 1)) : null,
      a.task === 'lead' ? readout('Slice', String(a.lead?.slice ?? 1)) : null,
      readout('Effort', a.task === 'lead' ? leadEffortPicker(a) : a.effort ?? 'default'),
      readout('Autonomy', autonomyPicker(a)),
      contextReadout(a),
      readout('Started', timeAgo(a.startedAt)),
      a.costUsd > 0 ? readout('Usage', `~$${a.costUsd.toFixed(2)}`, { title: 'Estimated usage (on a subscription this is not billed)' }) : null,
      !a.cloud ? readout('Signs in with', a.onKey ? '🔑 API key' : 'Your plan', { title: 'What this session signs in to Claude with (main engineering shows your plan’s usage)' }) : null,
      a.cloud ? readout('Works in', 'Cloud', { title: 'Works in a Claude Code cloud session and pushes their own branch' }) : null,
      h('div', { class: 'links' },
        cloudLink(a),
        a.task === 'issue' ? h('a', { class: 'btn small', href: a.issue.url, target: '_blank', rel: 'noreferrer' }, 'Issue ↗') : null,
        a.task === 'review' ? h('a', { class: 'btn small go', href: a.issue.url, target: '_blank', rel: 'noreferrer' }, `PR #${a.issue.number} ↗`) : null,
        a.task === 'review' ? h('button', { class: 'btn small', onclick: () => ui.openQa(a.projectId) }, 'QA reports') : null,
        a.pr ? h('a', { class: 'btn small go', href: a.pr.url, target: '_blank', rel: 'noreferrer' }, `PR #${a.pr.number} ↗`) : null,
        a.task === 'lead' ? h('button', { class: 'btn small', onclick: () => ui.openBoard(a.projectId, 'prs') }, 'Board') : null,
        close,
        a.pr && a.status === 'done'
          ? h('button', { class: 'btn small', title: 'Run the PR on your machine and open it in your browser', onclick: () => ui.previewPr(a.projectId, a.repo, a.pr!.number) }, 'Preview')
          : null,
        movable(a) ? moveToCloud : null,
      ),
    );
    fill(closing, a.lead?.closing ? h('p', { class: 'goal-closing' }, `${a.name} thinks this goal is ready to wrap up: ${a.lead.closing.reason}. Close it, or tell them what's next.`) : null);
    if (a.handover) {
      // drawn again only when the hand-over changes, so a link half pasted isn't lost
      const key = `${a.handover.since}:${a.handover.terminalAt ?? ''}`;
      if (key !== handoverKey) {
        handoverKey = key;
        ask.replaceChildren(handoverAsk(a));
      }
    } else if (a.permission) {
      handoverKey = '';
      const req = a.permission;
      const approve = h('button', { class: 'btn go' }, 'Approve');
      const decline = h('button', { class: 'btn danger' }, 'Decline');
      approve.onclick = () => void busy(approve, () => api.permission(id, req.id, true), ui.error);
      decline.onclick = () => void busy(decline, () => api.permission(id, req.id, false), ui.error);
      ask.replaceChildren(
        h('div', { class: 'ask' }, h('strong', null, `${a.name} wants to run`), h('code', { class: 'grow' }, req.summary), approve, decline),
      );
    } else {
      handoverKey = '';
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
    if (atEnd) terminal.scrollTop = terminal.scrollHeight;
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
    replay.el.style.display = view === 'run' ? '' : 'none';
    info.style.display = view && view !== 'browser' && view !== 'run' ? '' : 'none';
    // the replay keeps its place on the scrubber: it reads the journal again only when there's more of it
    if (view === 'run') replay.show(a.run?.seq ?? 0, ui.error);
    if (!view || view === 'browser' || view === 'run') return;
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

  /** A workflow the lead ran: how many of each phase's agents are queued, working, done and failed, and who's at work. */
  const workflowView = (w: Workflow) =>
    h('div', { class: 'crew-member', style: `--tone:${WORKFLOW_TONE[w.status]}` },
      h('h4', { style: 'margin:0' }, `Workflow ${w.name} · ${w.status}`),
      w.description ? h('p', null, w.description) : null,
      ...w.phases.map((p) => {
        const counts = [p.working && `${p.working} working`, p.queued && `${p.queued} queued`, p.done && `${p.done} done`, p.failed && `${p.failed} failed`].filter(Boolean).join(' · ');
        const working = w.agents.filter((x) => x.phase === p.index && x.status === 'working');
        return h('div', null,
          h('p', { style: 'margin-bottom:0' }, `${p.title || 'Before any phase'}: ${counts || 'nothing yet'}`),
          ...working.map((x) => h('p', { class: 'muted', style: 'margin:0 0 0 1em' }, `${AGENT_MARK[x.status]} ${x.label}: ${x.activity}`)),
        );
      }),
    );

  /**
   * The helpers a lead has handed work to: what each was asked, and what it's doing or how it got on (click one for its
   * transcript); then the workflows it's running, and what it has running in the background (click one for its output).
   */
  const crewView = (a: Agent) =>
    h('div', { class: 'crew' },
      ...(a.helpers ?? []).map((x) =>
        h('div', { class: 'crew-member', style: `--tone:${HELPER_TONE[x.status]}`, title: 'Open their transcript', onclick: () => ui.openHelper(a.id, x.id) },
          h('h4', { style: 'margin:0' }, `${helperFor(x.id).name}${x.parent ? ` · for ${helperFor(x.parent).name}` : ''} · ${x.status}`),
          h('p', null, x.description),
          x.activity ? h('p', { class: 'muted' }, x.activity) : null,
        )),
      ...(a.workflows ?? []).map(workflowView),
      ...(a.background ?? []).map((t) =>
        h('div', { class: 'crew-member', style: `--tone:${BACKGROUND_TONE[t.status]}`, title: 'Open its output', onclick: () => ui.openBackground(a.id, t.id) },
          h('h4', { style: 'margin:0' }, `${t.kind === 'monitor' ? 'Monitor' : 'Background command'} · ${t.status}`),
          h('p', { style: 'font-family:var(--mono);font-size:13px' }, t.description),
          h('p', { class: 'muted' }, t.status === 'running' ? `running for ${runningFor(t, Date.now())}` : (t.summary ?? `ran for ${runningFor(t, Date.now())}`)),
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

  /**
   * What the agent may do without asking, changeable any time for them alone: at once if they're working on this
   * machine, else from their next turn. Shows the office's setting until the captain picks one for them.
   */
  const autonomyPicker = (a: Agent) => {
    const office = state.info?.settings.autonomy ?? 'ask';
    const mode = effectiveAutonomy(a, { autonomy: office });
    const select = h('select', {
      class: 'effort',
      style: mode === 'full' ? 'color:var(--lcars-red)' : undefined,
      title: `${AUTONOMY_HINT[mode]}\n\n${a.autonomy ? `Chosen for ${a.name} alone` : 'The office setting'}: a change applies to ${a.name} only, at once if they're working on this machine.`,
    },
      ...AUTONOMY_MODES.map((m) => h('option', { value: m, selected: m === mode, title: AUTONOMY_HINT[m] }, AUTONOMY_LABEL[m])),
    );
    select.onchange = () => {
      const picked = AUTONOMY_MODES.find((m) => m === select.value);
      if (picked) void api.setAutonomy(id, picked).catch((e: Error) => ui.error(e.message));
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
    markRead(a);
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

/** A local agent the captain can move to the cloud (the office says why not, if it won't). */
const movable = (a: Agent) => (a.task === 'issue' || a.task === 'fix') && !a.cloud && !a.handover;

/** Picks where an agent works: on this machine, or in a Claude Code cloud session. */
export function wherePicker(cloud = false): HTMLSelectElement {
  return h('select', { class: 'effort', title: "Where the agent works: on this machine, or in a Claude Code cloud session (claude.ai/code). If Claude Code won't start the cloud session by itself, the agent waits for you to start it (Focus can open a terminal that does)" },
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
