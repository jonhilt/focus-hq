import { statusIcon, statusLine } from '../../../shared/agentStatus';
import { UNIFORM } from '../../../shared/crew';
import { type Agent, type GoalRecord, type QueuedGoal, TEAM_STATIONS } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h, timeAgo } from './dom';
import { closeGoal, leadEffortPicker, noteView } from './goals';

/** A pull request a goal's lead shipped, as a link that says what became of it. */
const prLink = (p: { repo: string; number: number; url: string; outcome?: string }) =>
  h('a', { class: `btn small${p.outcome ? '' : ' go'}`, href: p.url, target: '_blank', rel: 'noreferrer', title: p.outcome ?? 'open' },
    `${p.outcome === 'merged' ? '✔ ' : p.outcome === 'closed' ? '✕ ' : ''}${p.repo.split('/')[1]} #${p.number} ↗`);

/** One goal under way: its lead, what they're doing, their note and its pull requests. */
function goalCard(ui: Ui, lead: Agent): HTMLElement {
  const work = lead.lead;
  const close = h('button', { class: `btn small${work?.closing ? ' go' : ''}`, title: 'File the goal in the room’s log and send its lead home, which frees the station' }, '🏁 Close goal');
  close.onclick = () => void busy(close, () => closeGoal(lead), ui.error);
  return h('div', { class: 'card', style: `border-left-color:${UNIFORM[lead.avatar.division]}` },
    h('div', { class: 'planner-head' },
      h('span', { class: 'planner-badge', style: `background:${UNIFORM[lead.avatar.division]}` }, String((work?.station ?? 0) + 1)),
      h('div', { class: 'grow' },
        h('strong', null, work?.title ?? lead.issue.title),
        h('small', null, `${lead.name} · team station ${(work?.station ?? 0) + 1} · slice ${work?.slice ?? 1} · 🧠 ${lead.effort ?? 'default'}`),
      ),
      close,
      h('button', { class: 'btn small primary', onclick: () => ui.openAgent(lead.id) }, '🖖 Talk'),
    ),
    work?.closing ? h('p', { class: 'goal-closing' }, `🏁 Ready to wrap up: ${work.closing.reason}`) : null,
    noteView(work?.note, true),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('span', { class: 'chip' }, `${statusIcon(lead)} ${lead.status}`),
      h('small', { class: 'grow muted' }, statusLine(lead)),
      ...(work?.prs ?? []).map(prLink),
    ),
  );
}

/** A goal waiting for a station: the first one starts with a press once a station is free, edits and all. */
function queuedCard(ui: Ui, projectId: string, goal: QueuedGoal, place: number, total: number, free: boolean): HTMLElement {
  const up = h('button', { class: 'btn small', title: 'Sooner', disabled: place === 0 }, '▲');
  const down = h('button', { class: 'btn small', title: 'Later', disabled: place === total - 1 }, '▼');
  const drop = h('button', { class: 'btn small', title: 'Take it out of the line' }, '✕');
  up.onclick = () => void busy(up, () => api.moveQueued(projectId, goal.id, -1), ui.error);
  down.onclick = () => void busy(down, () => api.moveQueued(projectId, goal.id, 1), ui.error);
  drop.onclick = () => void busy(drop, () => api.dropQueued(projectId, goal.id), ui.error);
  const head = h('div', { class: 'row' },
    h('strong', { class: 'grow' }, `${place === 0 ? 'Next up: ' : `${place + 1}. `}${goal.text.split('\n')[0]}`),
    h('small', { class: 'muted' }, `${goal.from ? `from ${goal.from} · ` : ''}🧠 ${goal.effort ?? state.info?.settings.leadEffort ?? 'high'} · ${timeAgo(goal.at)}`),
    up, down, drop,
  );
  if (place !== 0 || !free) return h('div', { class: 'card goal-queued' }, head);
  // a station is free: the first goal in line starts with a press, as it stands or as the captain edits it
  const text = h('textarea', { class: 'planner-input', value: goal.text });
  const effort = leadEffortPicker(goal.effort ?? state.info?.settings.leadEffort);
  const start = h('button', { class: 'btn primary' }, '🖖 Start it');
  start.onclick = () =>
    void busy(start, async () => {
      const lead = await api.startQueued(projectId, goal.id, { text: text.value, effort: effort.picked() });
      ui.openAgent(lead.id);
    }, ui.error);
  return h('div', { class: 'card planner goal-queued' }, head, h('p', null, 'A team station is free. Start it as it is, or change it first:'), withMic(ui, text), h('div', { class: 'row' }, start, effort.el));
}

/** A closed goal in the room's log. */
function recordRow(goal: GoalRecord): HTMLElement {
  return h('div', { class: 'card goal-record' },
    h('div', { class: 'row' },
      h('strong', { class: 'grow' }, goal.title),
      h('small', { class: 'muted' }, `${goal.leadName} · ${goal.slices} slice${goal.slices === 1 ? '' : 's'} · closed ${timeAgo(goal.closedAt)}`),
    ),
    goal.note?.learned.length ? h('ul', { class: 'goal-list' }, ...goal.note.learned.map((l) => h('li', null, l))) : null,
    goal.prs.length ? h('div', { class: 'row' }, ...goal.prs.map(prLink)) : null,
  );
}

/**
 * The room's goals: one per team station, each with a lead of its own (the captain's own Claude Code session for it,
 * across the project's repos). Talk to a goal's lead, close it, or start another; with every station taken, new goals
 * wait in line until one is free and the captain starts them.
 */
export function openGoalsPanel(ui: Ui, projectId: string): void {
  const project = state.project(projectId);
  if (!project) return;
  const list = h('div', { class: 'cards', style: 'margin-bottom:14px' });
  const queue = h('div', { class: 'cards', style: 'margin-bottom:14px' });
  const log = h('div', { class: 'cards' });
  const free = h('small', { class: 'muted' });
  const text = h('textarea', { class: 'planner-input', placeholder: 'What are we working on? e.g. shoppers can save items for later and find them again on any device', autofocus: true });
  const effort = leadEffortPicker(state.info?.settings.leadEffort);
  const start = h('button', { class: 'btn primary' }, '🖖 Start the goal');
  start.onclick = () =>
    void busy(start, async () => {
      const started = await api.startGoal(projectId, text.value, { effort: effort.picked() });
      text.value = '';
      if ('agent' in started) ui.openAgent(started.agent.id);
    }, ui.error);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start.click();
  });
  const intro = h('p');
  const form = h('div', { class: 'card planner', style: 'margin-bottom:14px' },
    h('div', { class: 'planner-head' },
      h('span', { class: 'planner-badge', style: `background:${UNIFORM.command}` }, '🧭'),
      h('div', { class: 'grow' }, h('strong', null, 'Start a goal'), free),
    ),
    intro,
    withMic(ui, text),
    h('div', { class: 'row' }, start, effort.el),
  );
  const body = h('div', null, list, queue, form, log);

  const render = () => {
    const p = state.project(projectId);
    if (!p) return ui.panels.close();
    const leads = state.leadsIn(projectId);
    const open = TEAM_STATIONS - leads.length;
    fill(list, ...(leads.length ? leads.map((lead) => goalCard(ui, lead)) : [h('div', { class: 'empty' }, 'No goals under way yet.')]));
    const waiting = p.goalQueue ?? [];
    fill(queue, ...(waiting.length ? [h('h3', null, `Waiting for a team station (${waiting.length})`), ...waiting.map((g, i) => queuedCard(ui, projectId, g, i, waiting.length, open > 0))] : []));
    free.textContent = `${open} of ${TEAM_STATIONS} team stations free · Ctrl+Enter starts`;
    intro.textContent = open > 0 && !waiting.length
      ? `A lead of its own takes a free team station, with ${p.repos.length === 1 ? p.repos[0] : `all ${p.repos.length} of ${p.name}'s repos`} checked out side by side: your own Claude Code session for the goal. Talk it through, then let them build it a slice at a time. Each slice ships as a pull request per repo it touches, QA reviews it, and you merge it.`
      : 'Every team station has a goal, or goals are waiting for one: this one joins the line, and you start it once a station is free.';
    start.textContent = open > 0 && !waiting.length ? '🖖 Start the goal' : '🧭 Add it to the line';
    const done = p.goals ?? [];
    fill(log, ...(done.length ? [h('h3', null, `Closed goals (${done.length})`), ...done.map(recordRow)] : []));
  };
  ui.panels.open({ title: `🧭 ${project.name} – goals`, body, accent: project.color });
  render();
  ui.panels.own(state.on('agent', (a) => a.projectId === projectId && a.task === 'lead' && render()));
  ui.panels.own(state.on('agent-removed', (a) => a.projectId === projectId && render()));
  ui.panels.own(state.on('projects', render));
}
