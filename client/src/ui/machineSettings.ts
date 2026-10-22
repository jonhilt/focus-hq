// Settings' card for what's particular to the machine Focus runs on: auto update, the terminal a cloud session opens
// in, the browser agents drive. Each one an environment variable sets (`ServerInfo.settingsPinned`) shows as set
// there, and can't be changed here.
import type { PinnedSettings, Settings } from '../../../shared/types';
import { api } from '../net/api';
import type { Ui } from './context';
import { h } from './dom';
import { Switch } from './panels';

/** A chip saying which environment variable sets it, or nothing. */
const pinnedChip = (pinned: PinnedSettings, key: keyof PinnedSettings) => {
  const env = pinned[key];
  return env ? h('span', { class: 'chip warn', title: `Unset ${env} and restart Focus to change it here` }, `from ${env}`) : null;
};

export function machineSection(ui: Ui, s: Settings, pinned: PinnedSettings): HTMLElement {
  const save = (patch: Partial<Settings>) => void api.updateSettings(patch).catch((e: Error) => ui.error(e.message));
  const autoUpdate = new Switch('Auto update', s.autoUpdate !== false, { changed: (on) => save({ autoUpdate: on }) });
  autoUpdate.el.disabled = pinned.autoUpdate !== undefined;
  const text = (key: 'terminal' | 'browserPath', placeholder: string) => {
    const input = h('input', { type: 'text', value: s[key] ?? '', placeholder, style: 'flex:1', disabled: pinned[key] !== undefined });
    input.addEventListener('change', () => save({ [key]: input.value }));
    return input;
  };

  return h('div', { class: 'card', style: 'margin-top:12px' },
    h('strong', { class: 'label' }, 'This machine'),
    h('div', { class: 'field', style: 'margin-top:8px' },
      h('div', { class: 'row' }, autoUpdate.el, pinnedChip(pinned, 'autoUpdate')),
      h('small', null, 'Pulls, rebuilds and restarts Focus when its branch moves upstream, once no agent is busy.'),
    ),
    h('div', { class: 'field' },
      h('label', null, 'Terminal for cloud sessions'),
      h('div', { class: 'row' }, text('terminal', 'The usual ones, in turn (e.g. kitty -e)'), pinnedChip(pinned, 'terminal')),
      h('small', null, 'The command that opens a terminal, the script’s path going after it. Applies to the next one opened.'),
    ),
    h('div', { class: 'field' },
      h('label', null, 'Browser for agents'),
      h('div', { class: 'row' }, text('browserPath', 'Playwright’s Chromium, else Chrome, else Edge'), pinnedChip(pinned, 'browserPath')),
      h('small', null, 'The path to a Chromium-based browser’s executable. Applies from Focus’s next start.'),
    ),
  );
}
