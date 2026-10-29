import { contextLevel, statusLine } from '../../../shared/agentStatus';
import { UNIFORM } from '../../../shared/crew';
import { goalTitle } from '../../../shared/goalTitle';
import { leftOn } from '../../../shared/goalLog';
import type { Agent, GoalRecord, QueuedGoal } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { clientPlugin, everyGoalButtons, type GoalsPanelView, goalsPanelViews, goalTags } from '../plugins';
import { LCARS_STATUS } from '../world/starship';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h, timeAgo } from './dom';
import { CONTEXT_TONE, closeGoal, goalStarted, leadEffortPicker, noteView, prLink, reviewing, shapingToggle } from './goals';
import { type NavItem, readout, shownView, SideNav } from './panels';
import { openClosedGoalChart, openGoalChart } from './chartPanel';
import { openClosedGoalShown } from './screenPanel';

/** The goals panel's views: the goals under way (and any waiting in line), a new one, the closed ones, and the plugins'. */
type GoalsView = 'goals' | 'new' | 'log' | GoalsPanelView['key'];

/** What the lead says it's doing, from the task list Claude keeps for itself. */
const doing = (lead: Agent) => {
  const t = lead.tasks?.find((x) => x.status === 'in_progress');
  return t ? t.activeForm || t.subject : '';
};

/** One goal under way: its station if it has one, its lead and how they're getting on, their note and its pull requests. */
function goalCard(ui: Ui, lead: Agent): HTMLElement {
  const work = lead.lead;
  const station = work?.station === undefined ? undefined : work.station + 1;
  const tasks = lead.tasks ?? [];
  const close = h('button', { class: `btn small${work?.closing ? ' go' : ''}`, title: 'File the goal in the room’s log and send its lead home' }, 'Close goal');
  close.onclick = () => void busy(close, () => closeGoal(lead), ui.error);
  return h('div', { class: 'goal-card', style: `--tone:${UNIFORM[lead.avatar.division]}` },
    h('div', { class: 'goal-station', title: station === undefined ? undefined : `Team station ${station}` }, station === undefined ? '' : String(station).padStart(2, '0')),
    h('div', { class: 'goal-main' },
      h('strong', { class: 'goal-title' }, work?.title ?? lead.issue.title),
      // what the lead is on, in words, beside what you can do about it
      h('div', { class: 'row goal-doing' },
        h('p', { class: 'grow', title: doing(lead) ? `Now: ${doing(lead)}` : undefined }, statusLine(lead)),
        h('button', { class: 'btn small', title: 'The goal’s star chart: its slices as waypoints on the way to what done looks like', onclick: () => openGoalChart(ui, lead.id) }, 'Chart'),
        close,
        h('button', { class: 'btn small primary', onclick: () => ui.openAgent(lead.id) }, 'Talk'),
      ),
      h('div', { class: 'readouts' },
        readout('Lead', lead.name),
        readout('Status', lead.status, { tone: LCARS_STATUS[lead.status] }),
        ...goalTags(lead, 'card').map((tag) => readout(tag.label, tag.el)),
        readout('Slice', String(work?.slice ?? 1)),
        readout('Effort', lead.effort ?? 'default'),
        work?.shaping ? readout('Mode', 'Shaping first', { title: 'Started to be shaped with you before it’s built' }) : null,
        lead.context ? readout('Context', `${lead.context.percent}%`, { tone: CONTEXT_TONE[contextLevel(lead.context.percent)] }) : null,
        tasks.length ? readout('Tasks', `${tasks.filter((t) => t.status === 'completed').length}/${tasks.length}`, { title: doing(lead) ? `Now: ${doing(lead)}` : undefined }) : null,
      ),
      work?.closing ? h('p', { class: 'goal-closing' }, `Ready to wrap up: ${work.closing.reason}`) : null,
      noteView(work?.note, true),
      reviewing(lead),
      work?.prs.length ? h('div', { class: 'row', style: 'margin-top:8px' }, ...work.prs.map(prLink)) : null,
    ),
  );
}

/** A goal waiting in line: the first one starts with a press, edits and all. */
function queuedCard(ui: Ui, projectId: string, goal: QueuedGoal, place: number, total: number): HTMLElement {
  const up = h('button', { class: 'btn small', title: 'Start it before the one ahead', disabled: place === 0 }, 'Sooner');
  const down = h('button', { class: 'btn small', title: 'Start it after the one behind', disabled: place === total - 1 }, 'Later');
  const drop = h('button', { class: 'btn small danger', title: 'Take it out of the line' }, 'Remove');
  up.onclick = () => void busy(up, () => api.moveQueued(projectId, goal.id, -1), ui.error);
  down.onclick = () => void busy(down, () => api.moveQueued(projectId, goal.id, 1), ui.error);
  drop.onclick = () => void busy(drop, () => api.dropQueued(projectId, goal.id), ui.error);
  // titled as it will be once it starts, with the captain's words in full under it (a few lines, the rest on a click)
  const title = goalTitle(goal.text);
  const head = h('div', null,
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, `${place === 0 ? 'Next up: ' : `${place + 1}. `}${title}`), up, down, drop),
    h('small', { class: 'muted' }, `${goal.from ? `from ${goal.from} · ` : ''}${goal.effort ?? state.info?.settings.leadEffort ?? 'high'} effort${goal.shaping ? ' · shaped first' : ''} · ${timeAgo(goal.at)}`),
  );
  const words = goal.text.trim();
  const brief = words !== title ? h('p', { class: 'goal-queued-text', title: 'Show it all, or fold it away' }, words) : null;
  if (brief) brief.onclick = () => brief.classList.toggle('open');
  if (place !== 0) return h('div', { class: 'card goal-queued' }, head, brief);
  // the first goal in line starts with a press, as it stands or as the user edits it
  const text = h('textarea', { class: 'planner-input', value: goal.text });
  const effort = leadEffortPicker(goal.effort ?? state.info?.settings.leadEffort);
  const shaping = shapingToggle(goal.shaping);
  const start = h('button', { class: 'btn primary' }, 'Start it');
  start.onclick = () =>
    void busy(start, async () => {
      const lead = await api.startQueued(projectId, goal.id, { text: text.value, effort: effort.picked(), shaping: shaping.picked() });
      ui.openAgent(lead.id);
    }, ui.error);
  return h('div', { class: 'card planner goal-queued' }, head, h('p', null, 'Start it as it is, or change it first:'), withMic(ui, text), h('div', { class: 'row' }, start, effort.el, shaping.el));
}

/** A closed goal in the room's log: reopened on its branch and with its lead's conversation. */
function recordRow(ui: Ui, projectId: string, goal: GoalRecord): HTMLElement {
  const kept = !!goal.branch && !!goal.repos?.length;
  const reopen = kept
    ? h('button', {
      class: 'btn small',
      title: `Bring ${goal.leadName} back, ${leftOn(goal)?.replace(/^Left on/, 'on') ?? ''}, as it was left, to carry on the conversation`,
    }, 'Reopen')
    : null;
  if (reopen) {
    reopen.onclick = () =>
      void busy(reopen, async () => {
        const lead = await api.reopenGoal(projectId, goal.id);
        ui.openAgent(lead.id);
      }, ui.error);
  }
  // what its lead showed and asked with pictures, kept with the goal
  const count = (goal.artifacts?.length ?? 0) + (goal.questions?.length ?? 0);
  const shown = count
    ? h('button', { class: 'btn small', title: 'The diagrams and mockups its lead showed, and the questions they asked you, as they left them', onclick: () => openClosedGoalShown(ui, goal) }, `Shown (${count})`)
    : null;
  return h('div', { class: 'card goal-record' },
    h('div', { class: 'row' },
      h('strong', { class: 'grow' }, goal.title),
      h('small', { class: 'muted' }, `${goal.leadName} · ${goal.slices} slice${goal.slices === 1 ? '' : 's'} · closed ${timeAgo(goal.closedAt)}`),
      goal.waypoints?.length ? h('button', { class: 'btn small', title: 'Its star chart: the slices as waypoints on the way to what done looked like', onclick: () => openClosedGoalChart(ui, goal) }, 'Chart') : null,
      shown,
      reopen,
    ),
    leftOn(goal) ? h('small', { class: 'muted', style: 'display:block' }, leftOn(goal)) : null,
    goal.note?.learned.length ? h('ul', { class: 'goal-list' }, ...goal.note.learned.map((l) => h('li', null, l))) : null,
    goal.prs.length ? h('div', { class: 'goal-prs' }, ...goal.prs.map((p) => h('div', { class: 'row' }, prLink(p), p.branch ? h('small', { class: 'muted mono', title: p.branch }, p.branch) : null))) : null,
  );
}

/**
 * The room's goals, any number of them, each with a lead of its own (the user's own Claude Code session for it, across
 * the project's repos). Talk to a goal's lead, close it, or start another; goals left waiting in line (from when goals
 * waited for a free team station) start when the user starts them. The sidebar picks between the goals under way, a
 * new one and the closed ones. `station`, a free team station the user walked up to, opens it on a new goal.
 */
export function openGoalsPanel(ui: Ui, projectId: string, station?: number): void {
  const project = state.project(projectId);
  if (!project) return;
  // the goals under way side by side, as many abreast as the panel has room for
  const list = h('div', { class: 'cards goal-grid' });
  const queue = h('div', { class: 'cards', style: 'margin-top:14px' });
  const log = h('div', { class: 'cards' });
  const readouts = h('div', { class: 'readouts' });
  const text = h('textarea', { class: 'planner-input', placeholder: 'What are we working on? e.g. shoppers can save items for later and find them again on any device' });
  const effort = leadEffortPicker(state.info?.settings.leadEffort);
  const shaping = shapingToggle();
  const start = h('button', { class: 'btn primary' }, 'Start the goal');
  const intro = h('p', { style: 'margin-top:0' });
  const hint = h('small', { class: 'muted' }, 'Ctrl+Enter starts');
  const views = {
    goals: h('div', null, list, queue),
    new: h('div', { class: 'goal-new' }, readouts, intro, withMic(ui, text), h('div', { class: 'row', style: 'margin-top:8px' }, start, effort.el, shaping.el, hint)),
    log,
  };
  const body = h('div', null, ...Object.values(views));
  // the plugins' views (`goalsView`), each made the first time it's offered; only the one shown is drawn
  const pluginViews = new Map<GoalsPanelView['key'], HTMLElement>();
  const showPluginViews = (offered: GoalsPanelView[], view: GoalsView) => {
    for (const v of offered) if (!pluginViews.has(v.key)) pluginViews.set(v.key, body.appendChild(h('div', null)));
    for (const [key, el] of pluginViews) {
      const shown = key === view ? offered.find((v) => v.key === key) : undefined;
      el.hidden = !shown;
      if (shown) fill(el, shown.render());
    }
  };

  // a free station the user walked up to opens on a new goal; otherwise the goals under way, if there are any
  let picked: GoalsView | undefined = station !== undefined ? 'new' : undefined;
  const nav = new SideNav<GoalsView>((view) => {
    picked = view;
    render();
    if (view === 'new') text.focus();
  });

  start.onclick = () =>
    void busy(start, async () => {
      const { agent } = await api.startGoal(projectId, text.value, { effort: effort.picked(), shaping: shaping.picked() });
      text.value = '';
      ui.openAgent(agent.id);
      goalStarted(ui, agent);
    }, ui.error);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start.click();
  });

  const render = () => {
    const p = state.project(projectId);
    if (!p) return ui.panels.close();
    const leads = state.leadsIn(projectId);
    const waiting = p.goalQueue ?? [];
    const done = p.goals ?? [];
    const offered = goalsPanelViews(ui, p);
    const items: NavItem<GoalsView>[] = [
      { key: 'goals', label: 'Under way', readout: `${leads.length}${waiting.length ? ` +${waiting.length}` : ''}`, standby: !leads.length && !waiting.length },
      { key: 'new', label: 'New goal', readout: '' },
      { key: 'log', label: 'Closed', readout: done.length ? String(done.length) : '', standby: !done.length },
      ...offered.map((v) => {
        const count = v.readout();
        return { key: v.key, label: v.label, readout: count, standby: !count };
      }),
    ];
    const view = shownView(items, picked) ?? 'new';
    nav.show(items, view);
    for (const [key, el] of Object.entries(views)) el.hidden = key !== view;
    showPluginViews(offered, view);

    fill(list, ...leads.map((lead) => goalCard(ui, lead)));
    fill(queue, ...(waiting.length ? [h('h3', null, `Waiting in line (${waiting.length})`), ...waiting.map((g, i) => queuedCard(ui, projectId, g, i, waiting.length))] : []));
    fill(readouts,
      readout('Under way', String(leads.length)),
      waiting.length ? readout('Waiting', String(waiting.length), { tone: LCARS_STATUS.waiting }) : null,
    );
    intro.textContent = `A lead of its own takes it on, with ${p.repos.length === 1 ? p.repos[0] : `all ${p.repos.length} of ${p.name}'s repos`} checked out side by side: your own Claude Code session for the goal. Talk it through, then let them build it a slice at a time. Each slice ships as a pull request per repo it touches, QA reviews it, and you merge it.`;
    fill(log, ...done.map((g) => recordRow(ui, projectId, g)));
  };
  // back out to a plugin's view of every goal on the ship, when one offers it
  ui.panels.open({ title: `${project.name} · goals`, body, nav, wide: true, accent: project.color, headerExtra: everyGoalButtons(ui) });
  render();
  if (!views.new.hidden) text.focus();
  ui.panels.own(state.on('agent', (a) => a.projectId === projectId && (a.task === 'lead' || !!a.reviewFor) && render()));
  ui.panels.own(state.on('agent-removed', (a) => a.projectId === projectId && render()));
  ui.panels.own(state.on('projects', render));
  // the plugins' words on each goal, and their views, follow their state
  ui.panels.own(state.on('plugin', (id) => {
    const plugin = clientPlugin(id);
    if (plugin?.goal || plugin?.goalsView) render();
  }));
}
