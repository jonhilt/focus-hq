import { contextLevel, statusLine } from '../../../shared/agentStatus';
import { UNIFORM } from '../../../shared/crew';
import { goalTitle } from '../../../shared/goalTitle';
import { leftOn } from '../../../shared/goalLog';
import { type Agent, type GoalRecord, type QueuedGoal, TEAM_STATIONS } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { clientPlugin, goalTags } from '../plugins';
import { LCARS_STATUS } from '../world/starship';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h, timeAgo } from './dom';
import { CONTEXT_TONE, closeGoal, goalStarted, leadEffortPicker, noteView, prLink, reviewing } from './goals';
import { type NavItem, readout, shownView, SideNav } from './panels';
import { openClosedGoalChart, openGoalChart } from './chartPanel';
import { openClosedGoalShown } from './screenPanel';

/** The goals panel's views: the goals under way (and any waiting for a station), a new one, and the closed ones. */
type GoalsView = 'goals' | 'new' | 'log';

/** What the lead says it's doing, from the task list Claude keeps for itself. */
const doing = (lead: Agent) => {
  const t = lead.tasks?.find((x) => x.status === 'in_progress');
  return t ? t.activeForm || t.subject : '';
};

/** One goal under way: its station, its lead and how they're getting on, their note and its pull requests. */
function goalCard(ui: Ui, lead: Agent): HTMLElement {
  const work = lead.lead;
  const station = (work?.station ?? 0) + 1;
  const tasks = lead.tasks ?? [];
  const close = h('button', { class: `btn small${work?.closing ? ' go' : ''}`, title: 'File the goal in the room’s log and send its lead home, which frees the station' }, 'Close goal');
  close.onclick = () => void busy(close, () => closeGoal(lead), ui.error);
  return h('div', { class: 'goal-card', style: `--tone:${UNIFORM[lead.avatar.division]}` },
    h('div', { class: 'goal-station', title: `Team station ${station}` }, String(station).padStart(2, '0')),
    h('div', { class: 'goal-main' },
      h('div', { class: 'row' },
        h('strong', { class: 'grow goal-title' }, work?.title ?? lead.issue.title),
        h('button', { class: 'btn small', title: 'The goal’s star chart: its slices as waypoints on the way to what done looks like', onclick: () => openGoalChart(ui, lead.id) }, 'Chart'),
        close,
        h('button', { class: 'btn small primary', onclick: () => ui.openAgent(lead.id) }, 'Talk'),
      ),
      h('div', { class: 'readouts' },
        readout('Lead', lead.name),
        readout('Status', lead.status, { tone: LCARS_STATUS[lead.status] }),
        ...goalTags(lead, 'card').map((tag) => readout(tag.label, tag.el)),
        readout('Activity', statusLine(lead), { grow: true }),
        readout('Slice', String(work?.slice ?? 1)),
        readout('Effort', lead.effort ?? 'default'),
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

/** A goal waiting for a station: the first one starts with a press once a station is free, edits and all. */
function queuedCard(ui: Ui, projectId: string, goal: QueuedGoal, place: number, total: number, free: boolean, station?: number): HTMLElement {
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
    h('small', { class: 'muted' }, `${goal.from ? `from ${goal.from} · ` : ''}${goal.effort ?? state.info?.settings.leadEffort ?? 'high'} effort · ${timeAgo(goal.at)}`),
  );
  const words = goal.text.trim();
  const brief = words !== title ? h('p', { class: 'goal-queued-text', title: 'Show it all, or fold it away' }, words) : null;
  if (brief) brief.onclick = () => brief.classList.toggle('open');
  if (place !== 0 || !free) return h('div', { class: 'card goal-queued' }, head, brief);
  // a station is free: the first goal in line starts with a press, as it stands or as the captain edits it
  const text = h('textarea', { class: 'planner-input', value: goal.text });
  const effort = leadEffortPicker(goal.effort ?? state.info?.settings.leadEffort);
  const start = h('button', { class: 'btn primary' }, 'Start it');
  start.onclick = () =>
    void busy(start, async () => {
      const lead = await api.startQueued(projectId, goal.id, { text: text.value, effort: effort.picked(), station });
      ui.openAgent(lead.id);
    }, ui.error);
  return h('div', { class: 'card planner goal-queued' }, head, h('p', null, 'A team station is free. Start it as it is, or change it first:'), withMic(ui, text), h('div', { class: 'row' }, start, effort.el));
}

/** A closed goal in the room's log: reopened, with a free station, on its branch and with its lead's conversation. */
function recordRow(ui: Ui, projectId: string, goal: GoalRecord, free: boolean): HTMLElement {
  const kept = !!goal.branch && !!goal.repos?.length;
  const reopen = kept
    ? h('button', {
      class: 'btn small',
      disabled: !free,
      title: free ? `Bring ${goal.leadName} back to a free team station, ${leftOn(goal)?.replace(/^Left on/, 'on') ?? ''}, as it was left, to carry on the conversation` : 'Every team station has a goal: close one first',
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
 * The room's goals: one per team station, each with a lead of its own (the captain's own Claude Code session for it,
 * across the project's repos). Talk to a goal's lead, close it, or start another; with every station taken, new goals
 * wait in line until one is free and the captain starts them. The sidebar picks between the goals under way, a new
 * one and the closed ones.
 */
export function openGoalsPanel(ui: Ui, projectId: string, station?: number): void {
  const project = state.project(projectId);
  if (!project) return;
  const list = h('div', { class: 'cards' });
  const queue = h('div', { class: 'cards', style: 'margin-top:14px' });
  const log = h('div', { class: 'cards' });
  const free = h('div', { class: 'readouts' });
  const text = h('textarea', { class: 'planner-input', placeholder: 'What are we working on? e.g. shoppers can save items for later and find them again on any device' });
  const effort = leadEffortPicker(state.info?.settings.leadEffort);
  const start = h('button', { class: 'btn primary' }, 'Start the goal');
  // with goals in line and a station free, a new one can still go ahead of them, at the first free station
  const jump = h('button', { class: 'btn', title: 'Start it at the first free team station, ahead of the goals in line' }, 'Start it now');
  const intro = h('p', { style: 'margin-top:0' });
  const hint = h('small', { class: 'muted' });
  const views: Record<GoalsView, HTMLElement> = {
    goals: h('div', null, list, queue),
    new: h('div', null, free, intro, withMic(ui, text), h('div', { class: 'row', style: 'margin-top:8px' }, start, jump, effort.el, hint)),
    log,
  };

  // the free station the captain walked up to opens on a new goal; otherwise the goals under way, if there are any
  let picked: GoalsView | undefined = station !== undefined ? 'new' : undefined;
  const nav = new SideNav<GoalsView>((view) => {
    picked = view;
    render();
    if (view === 'new') text.focus();
  });

  const submit = (button: HTMLButtonElement, at: () => number | undefined) =>
    void busy(button, async () => {
      const started = await api.startGoal(projectId, text.value, { effort: effort.picked(), station: at() });
      text.value = '';
      if ('agent' in started) {
        ui.openAgent(started.agent.id);
        return goalStarted(ui, started.agent);
      }
      picked = 'goals'; // it's waiting in line: show it there
      render();
    }, ui.error);
  start.onclick = () => submit(start, here);
  jump.onclick = () => submit(jump, firstFree);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start.click();
  });

  // the station the captain walked up to, while it's still free: a goal written there starts there, even with goals
  // waiting in line (those wait for the captain to start them, and the captain's chosen this station for this one)
  const here = () => (station !== undefined && !state.leadsIn(projectId).some((a) => a.lead?.station === station) ? station : undefined);
  const firstFree = () => {
    const taken = state.leadsIn(projectId).map((a) => a.lead?.station ?? 0);
    return Array.from({ length: TEAM_STATIONS }, (_, i) => i).find((i) => !taken.includes(i));
  };

  const render = () => {
    const p = state.project(projectId);
    if (!p) return ui.panels.close();
    const leads = state.leadsIn(projectId);
    const waiting = p.goalQueue ?? [];
    const done = p.goals ?? [];
    const open = TEAM_STATIONS - leads.length;
    const startsNow = here() !== undefined || (open > 0 && !waiting.length);
    const items: NavItem<GoalsView>[] = [
      { key: 'goals', label: 'Under way', readout: `${leads.length}/${TEAM_STATIONS}${waiting.length ? ` +${waiting.length}` : ''}`, standby: !leads.length && !waiting.length },
      { key: 'new', label: 'New goal', readout: startsNow ? `${open} free` : 'Queue' },
      { key: 'log', label: 'Closed', readout: done.length ? String(done.length) : '', standby: !done.length },
    ];
    const view = shownView(items, picked) ?? 'new';
    nav.show(items, view);
    for (const [key, el] of Object.entries(views)) el.hidden = key !== view;

    fill(list, ...leads.map((lead) => goalCard(ui, lead)));
    fill(queue, ...(waiting.length ? [h('h3', null, `Waiting for a team station (${waiting.length})`), ...waiting.map((g, i) => queuedCard(ui, projectId, g, i, waiting.length, open > 0, station))] : []));
    fill(free,
      readout('Team stations free', `${open} of ${TEAM_STATIONS}`),
      here() !== undefined ? readout('Starts at', `Team station ${here()! + 1}`) : null,
      waiting.length ? readout('Waiting', String(waiting.length), { tone: LCARS_STATUS.waiting }) : null,
    );
    intro.textContent = startsNow
      ? `A lead of its own takes a free team station, with ${p.repos.length === 1 ? p.repos[0] : `all ${p.repos.length} of ${p.name}'s repos`} checked out side by side: your own Claude Code session for the goal. Talk it through, then let them build it a slice at a time. Each slice ships as a pull request per repo it touches, QA reviews it, and you merge it.`
      : open > 0
        ? `Goals are waiting in line, and ${open === 1 ? 'a team station is' : `${open} team stations are`} free: add this one to the end of the line, or start it now, ahead of them.`
        : 'Every team station has a goal: this one joins the line, and you start it once a station is free.';
    start.textContent = startsNow ? 'Start the goal' : 'Add it to the line';
    jump.hidden = startsNow || open <= 0;
    hint.textContent = startsNow ? 'Ctrl+Enter starts' : 'Ctrl+Enter adds it to the line';
    fill(log, ...done.map((g) => recordRow(ui, projectId, g, open > 0)));
  };
  // back out to every goal on the ship, and whoever's waiting on you
  const comms = h('button', { class: 'btn small', title: 'Comms: who’s waiting on you, and every goal under way on the ship (C)', onclick: () => ui.openComms() }, '◂ Comms');
  ui.panels.open({ title: `${project.name} · goals`, body: h('div', null, ...Object.values(views)), nav, accent: project.color, headerExtra: [comms] });
  render();
  if (!views.new.hidden) text.focus();
  ui.panels.own(state.on('agent', (a) => a.projectId === projectId && (a.task === 'lead' || !!a.reviewFor) && render()));
  ui.panels.own(state.on('agent-removed', (a) => a.projectId === projectId && render()));
  ui.panels.own(state.on('projects', render));
  // the plugins' words on each goal follow their state
  ui.panels.own(state.on('plugin', (id) => !!clientPlugin(id)?.goal && render()));
}
