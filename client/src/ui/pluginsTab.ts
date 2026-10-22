// The ready room's Plugins tab: every plugin of Focus's own, picked from a list, with what it adds, what it costs in
// tokens, and, for one that works per project, its switch and settings for each project.
import { pluginOn } from '../../../shared/projectPlugins';
import { isHidden } from '../../../shared/hidden';
import type { Project } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { COST_BADGE, type PluginEntry, pluginEntries } from '../pluginList';
import { everyPlugin, projectSettings } from '../plugins';
import type { Ui } from './context';
import { h } from './dom';
import { Switch } from './panels';

/** The Plugins tab, with plugin `selected` open (the first listed when it's none, or gone). */
export function pluginsTab(ui: Ui, selected: string | undefined, pick: (id: string) => void): HTMLElement {
  const entries = pluginEntries(everyPlugin(), state.info?.plugins ?? []);
  const open = entries.find((e) => e.plugin.id === selected) ?? entries[0];
  if (!open) return h('div', { class: 'empty' }, 'Focus has no plugins.');
  const list = h('nav', { class: 'project-list plugin-list' },
    ...entries.map((e) =>
      h('button', { class: `project-pick${e === open ? ' on' : ''}${e.on ? '' : ' plugin-off'}`, onclick: () => pick(e.plugin.id) },
        h('span', { class: `dot cost-dot ${e.on && e.about.cost ? COST_BADGE[e.about.cost].tone : 'off'}` }),
        h('span', { class: 'grow' }, e.about.name, h('small', null, e.on ? costLabel(e) : 'Off')),
      ),
    ),
  );
  return h('div', { class: 'projects' }, list, pluginCard(ui, open));
}

const costLabel = (e: PluginEntry): string => (e.about.cost ? COST_BADGE[e.about.cost].label : 'Cost unknown');

function costChip(e: PluginEntry): HTMLElement {
  const badge = e.about.cost ? COST_BADGE[e.about.cost] : null;
  return h('span', { class: `chip ${badge?.tone ?? 'off'}` }, badge?.label ?? 'Cost unknown');
}

function pluginCard(ui: Ui, e: PluginEntry): HTMLElement {
  const { about } = e;
  return h('div', { class: 'card plugin-card' },
    h('div', { class: 'row' },
      h('strong', { class: 'grow plugin-name' }, about.name),
      e.on ? h('span', { class: 'chip ok' }, 'On') : h('span', { class: 'chip off' }, 'Off'),
    ),
    about.summary ? h('p', null, about.summary) : null,
    h('div', { class: 'plugin-cost' }, h('div', { class: 'row' }, h('span', { class: 'label' }, 'Cost'), costChip(e)), h('p', { class: 'muted' }, about.costDetail)),
    about.adds.length ? [h('div', { class: 'label' }, 'Adds'), h('ul', { class: 'plugin-adds' }, ...about.adds.map((a) => h('li', null, a)))] : null,
    e.on ? whereItWorks(ui, e) : h('p', { class: 'muted' },
      'Off for the whole ship. To switch it on, add ', h('code', null, e.plugin.id), ' to FOCUS_PLUGINS where Focus starts, and restart Focus.'),
  );
}

/** A per-project plugin's switch and settings for each project shown; or that it works for the whole ship. */
function whereItWorks(ui: Ui, e: PluginEntry): HTMLElement[] {
  const plugin = e.plugin;
  if (!plugin.project) return [h('p', { class: 'muted' }, 'Works for the whole ship.')];
  const projects = state.projects.filter((p) => !isHidden(p));
  return [
    h('div', { class: 'label' }, 'Projects'),
    h('p', { class: 'muted' }, 'Off in each project until you switch it on there.'),
    ...(projects.length ? projects.map((p) => projectRow(ui, plugin, p)) : [h('p', { class: 'muted' }, 'No projects yet.')]),
  ];
}

function projectRow(ui: Ui, plugin: PluginEntry['plugin'], p: Project): HTMLElement {
  const toggle = new Switch(p.name, pluginOn(p, plugin.id), {
    changed: (on) => void api.updateProject(p.id, { plugin: { id: plugin.id, on } }).catch((err: Error) => {
      toggle.on = !on;
      ui.error(err.message);
    }),
  });
  return h('div', { class: 'row plugin-project', style: `border-left: 6px solid ${p.color}` }, toggle.el, ...projectSettings(plugin, p, ui));
}
