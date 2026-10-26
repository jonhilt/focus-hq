// The ready room's Plugins tab: every plugin of Focus's own, picked from a list, with its switch for the whole ship (from
// Focus's next start), what it adds, what it costs in tokens, and, for one that works per project, its switch and
// settings for each project.
import { pluginOn } from '../../../shared/projectPlugins';
import { isHidden } from '../../../shared/hidden';
import { restartPending, switchShipPlugin } from '../../../shared/shipPluginRules';
import type { PluginSecretStatus, Project, ServerInfo } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { COST_BADGE, type PluginEntry, pluginEntries, shipStatus } from '../pluginList';
import { everyPlugin, pluginSettings, projectSettings } from '../plugins';
import type { Ui } from './context';
import { busy, h } from './dom';
import { Switch } from './panels';

/** The Plugins tab, with plugin `selected` open (the first listed when it's none, or gone). */
export function pluginsTab(ui: Ui, selected: string | undefined, pick: (id: string) => void): HTMLElement {
  const info = state.info;
  if (!info) return h('div', { class: 'empty' }, 'Connecting…');
  const entries = pluginEntries(everyPlugin(), info.plugins, chosen(info));
  const open = entries.find((e) => e.plugin.id === selected) ?? entries[0];
  if (!open) return h('div', { class: 'empty' }, 'Focus has no plugins.');
  const list = h('nav', { class: 'project-list plugin-list' },
    ...entries.map((e) =>
      h('button', { class: `project-pick${e === open ? ' on' : ''}${e.on ? '' : ' plugin-off'}`, onclick: () => pick(e.plugin.id) },
        h('span', { class: `dot cost-dot ${e.on && e.about.cost ? COST_BADGE[e.about.cost].tone : 'off'}` }),
        h('span', { class: 'grow' }, e.about.name, h('small', null, e.on === e.chosen && e.on ? costLabel(e) : shipStatus(e))),
      ),
    ),
  );
  return h('div', null, banner(ui, info), h('div', { class: 'projects' }, list, pluginCard(ui, info, open, entries)));
}

/**
 * The plugins switched on for the ship from Focus's next start: what Focus started with while something else decides
 * (FOCUS_PLUGINS, the demo), else the captain's choice, or what Focus started with until they make one.
 */
const chosen = (info: ServerInfo): string[] => (info.shipPlugins.pinnedBy ? info.shipPlugins.startedWith : info.settings.plugins ?? info.shipPlugins.startedWith);

/** Above the list: that FOCUS_PLUGINS decides, or that the captain's switches wait on a restart, with the way to restart. */
function banner(ui: Ui, info: ServerInfo): HTMLElement | null {
  const ship = info.shipPlugins;
  if (ship.pinnedBy === 'FOCUS_PLUGINS') {
    return h('div', { class: 'card plugin-banner' },
      h('strong', null, 'FOCUS_PLUGINS decides which plugins are on. '),
      h('span', { class: 'muted' }, 'It’s set where Focus started, so the switches below are locked. Start Focus without it to switch plugins here; what it switches on now carries over.'));
  }
  if (ship.pinnedBy === 'demo') {
    return h('div', { class: 'card plugin-banner' },
      h('strong', null, 'The demo ship has every plugin on. '),
      h('span', { class: 'muted' }, 'It saves nothing across a restart, so the switches below are locked. Per-project switches still work.'));
  }
  if (!restartPending(ship.startedWith, info.settings.plugins, ship.available)) return null;
  const restart = h('button', { class: 'btn small primary' }, 'Restart Focus');
  restart.onclick = () => void busy(restart, () => api.restart(), ui.error);
  return h('div', { class: 'card plugin-banner row' },
    h('span', { class: 'grow' }, h('strong', null, 'Your plugin changes apply when Focus restarts. '),
      h('span', { class: 'muted' }, ship.canRestart ? 'Agents at work carry on from where they were.' : 'Stop Focus and start it again: it isn’t running under pnpm start or pnpm run dev, so it can’t restart itself.')),
    ship.canRestart ? restart : null,
  );
}

const costLabel = (e: PluginEntry): string => (e.about.cost ? COST_BADGE[e.about.cost].label : 'Cost unknown');

function costChip(e: PluginEntry): HTMLElement {
  const badge = e.about.cost ? COST_BADGE[e.about.cost] : null;
  return h('span', { class: `chip ${badge?.tone ?? 'off'}` }, badge?.label ?? 'Cost unknown');
}

function pluginCard(ui: Ui, info: ServerInfo, e: PluginEntry, entries: readonly PluginEntry[]): HTMLElement {
  const { about } = e;
  return h('div', { class: 'card plugin-card' },
    h('div', { class: 'row' },
      h('strong', { class: 'grow plugin-name' }, about.name),
      e.on !== e.chosen ? h('span', { class: 'chip warn' }, shipStatus(e)) : null,
      shipSwitch(ui, info, e),
    ),
    about.summary ? h('p', null, about.summary) : null,
    needs(info, e, entries),
    h('div', { class: 'plugin-cost' }, h('div', { class: 'row' }, h('span', { class: 'label' }, 'Cost'), costChip(e)), h('p', { class: 'muted' }, about.costDetail)),
    about.adds.length ? [h('div', { class: 'label' }, 'Adds'), h('ul', { class: 'plugin-adds' }, ...about.adds.map((a) => h('li', null, a)))] : null,
    e.on ? ownSettings(ui, info, e) : null,
    e.on ? whereItWorks(ui, e) : h('p', { class: 'muted' }, 'Off for the whole ship.'),
  );
}

/** The plugin's own settings for the whole ship, while it's on: the secrets it needs first. */
function ownSettings(ui: Ui, info: ServerInfo, e: PluginEntry): HTMLElement[] {
  const settings = [...secretFields(ui, info.pluginSecrets[e.plugin.id] ?? [], e.plugin.id), ...pluginSettings(e.plugin, ui)];
  return settings.length ? [h('div', { class: 'label' }, 'Settings'), h('div', { class: 'plugin-settings' }, ...settings)] : [];
}

/**
 * A field for each secret the plugin needs (an API key): typing one and leaving the field saves it, Clear forgets it.
 * Focus never sends one back, only where it's set; one its environment variable sets can't be changed here.
 */
function secretFields(ui: Ui, secrets: readonly PluginSecretStatus[], plugin: string): HTMLElement[] {
  return secrets.map((s) => {
    // true once it's taken: a field whose secret wasn't keeps what was typed, to try again
    const send = (value: string | null) => api.changePluginSecret(plugin, s.name, value).then(() => true, (err: Error) => (ui.error(err.message), false));
    const input = h('input', { type: 'password', autocomplete: 'off', placeholder: s.by ? 'Paste a new one to replace it' : `Paste your ${s.label}`, style: 'flex:1' });
    input.addEventListener('change', () => void send(input.value).then((taken) => taken && (input.value = '')));
    const clear = h('button', { class: 'btn small' }, 'Clear');
    clear.onclick = () => void busy(clear, () => send(null), ui.error);
    const chip =
      s.by === 'env' ? h('span', { class: 'chip warn', title: `Unset ${s.name} and restart Focus to change it here` }, `from ${s.name}`)
      : s.by ? h('span', { class: 'chip ok' }, 'set')
      : h('span', { class: 'chip' }, 'not set');
    return h('div', { class: 'field' },
      h('label', null, s.label),
      h('div', { class: 'row' }, chip, s.by === 'env' ? null : input, s.by === 'captain' ? clear : null),
      s.hint ? h('small', null, `${s.hint} Kept on this machine, in secrets.env: never sent back to a browser or handed to agents.`) : null,
    );
  });
}

/** The plugin's switch for the whole ship, from Focus's next start: locked while FOCUS_PLUGINS decides. */
function shipSwitch(ui: Ui, info: ServerInfo, e: PluginEntry): HTMLElement {
  const ship = info.shipPlugins;
  const pinned = !!ship.pinnedBy;
  const toggle = new Switch('For the ship', e.chosen, {
    title: ship.pinnedBy === 'FOCUS_PLUGINS' ? 'FOCUS_PLUGINS decides, where Focus started' : pinned ? 'The demo ship has every plugin on' : 'Applies when Focus restarts',
    changed: (on) => void api.updateSettings({ plugins: switchShipPlugin(chosen(info), e.plugin.id, on, ship.available) }).catch((err: Error) => {
      toggle.on = !on;
      ui.error(err.message);
    }),
  });
  toggle.el.disabled = pinned;
  return toggle.el;
}

/** What the plugin can't work without, and what can't work without it: switching it brings them along. */
function needs(info: ServerInfo, e: PluginEntry, entries: readonly PluginEntry[]): HTMLElement | null {
  const name = (id: string) => entries.find((x) => x.plugin.id === id)?.about.name ?? id;
  const requires = info.shipPlugins.available.find((a) => a.id === e.plugin.id)?.requires ?? [];
  const requiredBy = info.shipPlugins.available.filter((a) => a.requires.includes(e.plugin.id)).map((a) => a.id);
  const lines = [
    requires.length ? `Needs ${requires.map(name).join(', ')}: switching it on switches ${requires.length === 1 ? 'that' : 'those'} on too.` : null,
    requiredBy.length ? `${requiredBy.map(name).join(', ')} ${requiredBy.length === 1 ? 'needs' : 'need'} it: switching it off switches ${requiredBy.length === 1 ? 'that' : 'those'} off too.` : null,
  ].filter((line): line is string => !!line);
  return lines.length ? h('p', { class: 'muted plugin-needs' }, lines.join(' ')) : null;
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
