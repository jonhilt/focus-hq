// The scheduler in the browser: its panel (from the pause panel) lists every lead's schedules, when each runs next
// and how its latest runs went, and stops one for the captain. Toasts of runs late, missed or held come from its server part.
import { callPlugin, type ClientPlugin, fill, h, onPluginState, pluginState, type Ui } from '../../plugin-api/client';
import { freshScheduler, SCHEDULER, type SchedulerState } from './shared';
import { panelGroups } from './view';
import './scheduler.css';

const now = (): SchedulerState => pluginState<SchedulerState>(SCHEDULER) ?? freshScheduler();

function openSchedules(ui: Ui): void {
  const body = h('div', { class: 'scheduler-panel' });
  const render = () => {
    const groups = panelGroups(now(), Date.now());
    fill(body, ...(groups.length ? groups.flatMap((g) => [
      h('h3', null, g.leadName),
      ...g.rows.map((r) => h('div', { class: 'scheduler-row' },
        h('div', { class: 'scheduler-head' },
          h('code', null, r.id),
          h('span', { class: 'grow' }, r.times),
          h('span', { class: 'muted' }, `next ${r.next}`),
          h('button', { class: 'btn small', onclick: () => void callPlugin(SCHEDULER, '/unschedule', { id: r.id }) }, 'Stop')),
        h('div', null, r.what),
        r.runs.length ? h('div', { class: 'scheduler-runs' }, ...r.runs.map((c) => h('span', { class: `chip scheduler-${c.unanswered ? 'unanswered' : c.outcome}` }, c.label))) : null)),
    ]) : [h('p', { class: 'muted' }, 'No lead has a schedule. A lead makes one with its schedule tool.')]));
  };
  render();
  ui.panels.open({ title: 'Schedules', body, wide: true });
  ui.panels.own(onPluginState(SCHEDULER, render));
}

const scheduler: ClientPlugin = {
  id: SCHEDULER,
  about: {
    name: 'Scheduler',
    summary: 'Leads can ask to be woken at set times, once or regularly, through Focus restarting.',
    adds: [
      'Lead tools: schedule, schedules and unschedule, and alert, to reach you directly',
      'The Schedules panel, from the pause panel',
      'A toast when a scheduled run is late, missed or held',
      'An alert (toast, ledger, the bot’s webhook) when a lead doesn’t answer a run within 20 minutes',
    ],
    cost: 'per-turn',
    costDetail: 'Its three lead tools are read on every turn of every lead in the projects it’s on for, and each scheduled run is a turn of the lead’s.',
  },
  project: { label: 'Scheduler', about: 'Leads can ask to be woken at set times, once or regularly, and you hear when a run is late or missed.' },
  panel: { label: 'Schedules', open: openSchedules },
};

export default scheduler;
