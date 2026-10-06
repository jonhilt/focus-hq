import { statusIcon, statusLine } from '../../../shared/agentStatus';
import { UNIFORM } from '../../../shared/crew';
import { type Agent, EFFORT_LEVELS, type Effort, TEAM_STATIONS } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h } from './dom';

/** What each effort level means for a lead, from Anthropic's guidance for the current models. */
const EFFORT_HINT: Record<Effort, string> = {
  low: 'Quick and cheap, but more likely to stop and check in partway through a slice.',
  medium: 'Quicker and cheaper than high, but more likely to stop and check in partway through a slice.',
  high: 'Right for most slices.',
  xhigh: 'For hard slices: takes longer and costs more, and may run its own review rounds.',
  max: 'For the hardest slices: takes longest and costs most, and may run its own review rounds.',
};

/** Picks a lead's effort: every level, starting at `value` (the office's default for leads). */
function leadEffortPicker(value: Effort = 'high'): { el: HTMLElement; picked: () => Effort } {
  const select = h('select', { class: 'effort', title: 'How hard the lead thinks' },
    ...EFFORT_LEVELS.map((e) => h('option', { value: e, selected: e === value }, `🧠 ${e}`)),
  );
  const picked = () => EFFORT_LEVELS.find((e) => e === select.value) ?? value;
  const hint = h('small', { class: 'muted' }, EFFORT_HINT[picked()]);
  select.addEventListener('change', () => (hint.textContent = EFFORT_HINT[picked()]));
  return { el: h('span', { class: 'row' }, select, hint), picked };
}

/** One goal: its lead, what they're doing, and its pull requests. */
function goalCard(ui: Ui, lead: Agent): HTMLElement {
  const work = lead.lead;
  return h('div', { class: 'card', style: `border-left-color:${UNIFORM[lead.avatar.division]}` },
    h('div', { class: 'planner-head' },
      h('span', { class: 'planner-badge', style: `background:${UNIFORM[lead.avatar.division]}` }, String((work?.station ?? 0) + 1)),
      h('div', { class: 'grow' },
        h('strong', null, work?.title ?? lead.issue.title),
        h('small', null, `${lead.name} · team station ${(work?.station ?? 0) + 1} · slice ${work?.slice ?? 1} · 🧠 ${lead.effort ?? 'default'}`),
      ),
      h('button', { class: 'btn small primary', onclick: () => ui.openAgent(lead.id) }, '🖖 Talk'),
    ),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('span', { class: 'chip' }, `${statusIcon(lead)} ${lead.status}`),
      h('small', { class: 'grow muted' }, statusLine(lead)),
      ...(work?.prs ?? []).map((p) =>
        h('a', { class: `btn small${p.outcome ? '' : ' go'}`, href: p.url, target: '_blank', rel: 'noreferrer', title: p.outcome ?? 'open' },
          `${p.outcome === 'merged' ? '✔ ' : p.outcome === 'closed' ? '✕ ' : ''}${p.repo.split('/')[1]} #${p.number} ↗`)),
    ),
  );
}

/**
 * The room's goals: one per team station, each with a lead of its own (the captain's own Claude Code session for it,
 * across the project's repos). Talk to a goal's lead, or start another goal at a free station.
 */
export function openGoalsPanel(ui: Ui, projectId: string): void {
  const project = state.project(projectId);
  if (!project) return;
  const list = h('div', { class: 'cards', style: 'margin-bottom:14px' });
  const free = h('small', { class: 'muted' });
  const text = h('textarea', { class: 'planner-input', placeholder: 'What are we working on? e.g. shoppers can save items for later and find them again on any device', autofocus: true });
  const effort = leadEffortPicker(state.info?.settings.leadEffort);
  const start = h('button', { class: 'btn primary' }, '🖖 Start the goal');
  start.onclick = () =>
    void busy(start, async () => {
      const lead = await api.startGoal(projectId, text.value, { effort: effort.picked() });
      ui.openAgent(lead.id);
    }, ui.error);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start.click();
  });
  const form = h('div', { class: 'card planner' },
    h('div', { class: 'planner-head' },
      h('span', { class: 'planner-badge', style: `background:${UNIFORM.command}` }, '🧭'),
      h('div', { class: 'grow' }, h('strong', null, 'Start a goal'), free),
    ),
    h('p', null, `A lead of its own takes a free team station, with ${project.repos.length === 1 ? project.repos[0] : `all ${project.repos.length} of ${project.name}'s repos`} checked out side by side: your own Claude Code session for the goal. Talk it through, then let them build it a slice at a time. Each slice ships as a pull request per repo it touches, QA reviews it, and you merge it.`),
    withMic(ui, text),
    h('div', { class: 'row' }, start, effort.el),
  );
  const full = h('p', { class: 'empty' }, `Every team station has a goal. Send one of their leads home to free a station.`);
  const body = h('div', null, list, form, full);

  const render = () => {
    if (!state.project(projectId)) return ui.panels.close();
    const leads = state.leadsIn(projectId);
    fill(list, ...(leads.length ? leads.map((lead) => goalCard(ui, lead)) : [h('div', { class: 'empty' }, 'No goals under way yet.')]));
    const open = TEAM_STATIONS - leads.length;
    free.textContent = `${open} of ${TEAM_STATIONS} team stations free · Ctrl+Enter starts`;
    form.hidden = open <= 0;
    full.hidden = open > 0;
  };
  ui.panels.open({ title: `🧭 ${project.name} – goals`, body, accent: project.color });
  render();
  ui.panels.own(state.on('agent', (a) => a.projectId === projectId && a.task === 'lead' && render()));
  ui.panels.own(state.on('agent-removed', (a) => a.projectId === projectId && render()));
}
