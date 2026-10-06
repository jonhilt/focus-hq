import { ACTIVE_STATUSES } from '../../../shared/types';
import { state } from '../net/state';
import { sound } from '../sound';
import { fill, h } from './dom';

export type ToastAction = { label: string; run: () => void };

/** Crosshair, interaction hint, where-am-I label, office counters and toasts. */
export class Hud {
  private root = h('div', { class: 'hud' });
  private crosshair = h('div', { class: 'crosshair' });
  private hint = h('div', { class: 'hint' });
  private location = h('div', { class: 'location' });
  private stats = h('div', { class: 'stats' });
  private toasts = h('div', { class: 'toasts' });
  private lastLocation = '';

  constructor() {
    this.root.append(
      this.crosshair,
      this.hint,
      this.location,
      this.stats,
      h(
        'div',
        { class: 'controls' },
        h('span', null, h('kbd', null, 'WASD'), 'move'),
        h('span', null, h('kbd', null, 'Shift'), 'run'),
        h('span', null, h('kbd', null, 'E'), 'interact'),
        h('span', null, h('kbd', null, 'T'), 'teleport'),
        h('span', null, h('kbd', null, 'M'), 'ready room'),
        h('span', null, h('kbd', null, 'N'), 'new issue'),
        h('span', null, h('kbd', null, 'L'), 'goals'),
        h('span', null, h('kbd', null, '1'), 'Number One'),
        h('span', null, h('kbd', null, 'Esc'), 'pause'),
      ),
    );
    document.body.append(this.root, this.toasts);
    const refresh = () => this.renderStats();
    state.on('snapshot', refresh);
    state.on('agent', refresh);
    state.on('agent-removed', refresh);
    state.on('board', refresh);
    state.on('info', refresh);
    state.on('connection', refresh);
    state.on('preview', refresh);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  setHint(text: string | null): void {
    this.crosshair.classList.toggle('hot', !!text);
    if (!text) {
      this.hint.style.display = 'none';
      return;
    }
    this.hint.style.display = 'block';
    this.hint.replaceChildren(h('kbd', null, 'E'), text);
  }

  setLocation(label: string, color?: string): void {
    const key = `${label}|${color}|${state.info?.mode}`;
    if (key === this.lastLocation) return;
    this.lastLocation = key;
    fill(
      this.location,
      color ? h('span', { class: 'swatch', style: `background:${color}` }) : '📍',
      h('span', null, label),
      state.info?.mode === 'demo' ? h('span', { class: 'mode' }, 'DEMO') : null,
    );
  }

  private renderStats(): void {
    const agents = [...state.agents.values()];
    const working = agents.filter((a) => ACTIVE_STATUSES.includes(a.status) && a.status !== 'waiting').length;
    const waiting = agents.filter((a) => a.status === 'waiting').length;
    const queued = agents.filter((a) => a.status === 'queued').length;
    const failed = agents.filter((a) => a.status === 'error').length;
    const prs = [...state.boards.values()].reduce((n, b) => n + b.prs.length, 0);
    fill(
      this.stats,
      !state.connected ? h('div', { class: 'stat bad' }, '🔌 reconnecting…') : null,
      state.info && !state.info.github.ok ? h('div', { class: 'stat bad' }, '⚠ GitHub not connected') : null,
      h('div', { class: 'stat' }, `⌨️ ${working} working`),
      queued ? h('div', { class: 'stat' }, `⏳ ${queued} queued`) : null,
      waiting ? h('div', { class: 'stat alert' }, `✋ ${waiting} need${waiting === 1 ? 's' : ''} you`) : null,
      failed ? h('div', { class: 'stat bad' }, `❗ ${failed} stuck`) : null,
      h('div', { class: 'stat' }, `👀 ${prs} PR${prs === 1 ? '' : 's'}`),
      state.previews.size ? h('div', { class: 'stat' }, `▶ ${state.previews.size} preview${state.previews.size === 1 ? '' : 's'}`) : null,
    );
  }

  toast(level: 'info' | 'success' | 'error', text: string, action?: ToastAction): void {
    const el = h(
      'div',
      { class: `toast ${level}` },
      h('span', null, text),
      action ? h('button', { class: 'btn small', onclick: () => { action.run(); el.remove(); } }, action.label) : null,
    );
    this.toasts.append(el);
    sound.alert(level);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
    setTimeout(() => el.remove(), action ? 12_000 : 6_000);
  }
}
