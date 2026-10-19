import { ACTIVE_STATUSES } from '../../../shared/types';
import { attention } from '../net/attention';
import { state } from '../net/state';
import { hudStats } from '../plugins';
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
  private curtain = h('div', { class: 'curtain' });
  private lastLocation = '';
  private pauseKey = h('span', null, h('kbd', null, 'Esc'), 'pause');

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
        h('span', null, h('kbd', null, 'C'), 'comms'),
        h('span', null, h('kbd', null, 'I'), 'jot an idea'),
        h('span', null, h('kbd', null, 'T'), 'teleport'),
        h('span', null, h('kbd', null, 'M'), 'ready room'),
        h('span', null, h('kbd', null, 'N'), 'new issue'),
        h('span', null, h('kbd', null, 'L'), 'goals'),
        h('span', null, h('kbd', null, 'H'), 'hide for recording'),
        this.pauseKey,
      ),
    );
    document.body.append(this.root, this.toasts, this.curtain);
    const refresh = () => this.renderStats();
    state.on('snapshot', refresh);
    state.on('agent', refresh);
    state.on('agent-removed', refresh);
    state.on('board', refresh);
    state.on('info', refresh);
    state.on('connection', refresh);
    state.on('preview', refresh);
    state.on('review', refresh);
    state.on('plugin', refresh);
  }

  /** Adds keys to the controls listed (a plugin's legend), before Esc. */
  addKeys(keys: { key: string; label: string }[]): void {
    for (const { key, label } of keys) this.pauseKey.before(h('span', null, h('kbd', null, key), label));
  }

  /** Blacks out the view, does `between` in the dark and brings the view back: the length of a turbolift ride. */
  blackout(between: () => void): void {
    this.curtain.classList.add('down');
    setTimeout(() => {
      between();
      this.curtain.classList.remove('down');
    }, 900);
  }

  /**
   * A transporter's shimmer over the view: it sparkles up to white, `between` happens in the glare, and the view
   * resolves again.
   */
  beam(between: () => void): void {
    this.curtain.classList.add('beam', 'down');
    setTimeout(() => {
      between();
      this.curtain.classList.remove('down');
      setTimeout(() => this.curtain.classList.remove('beam'), 500);
    }, 700);
  }

  /** A dive into what you're looking at: the view rushes in to a bright light, `between` happens in it, and it clears. */
  dive(between: () => void): void {
    this.curtain.classList.add('dive', 'down');
    setTimeout(() => {
      between();
      this.curtain.classList.remove('down');
      setTimeout(() => this.curtain.classList.remove('dive'), 1000);
    }, 900);
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
    const agents = state.shownAgents();
    const working = agents.filter((a) => ACTIVE_STATUSES.includes(a.status) && a.status !== 'waiting').length;
    const queued = agents.filter((a) => a.status === 'queued').length;
    const hails = attention().length;
    const prs = state.shown.reduce((n, p) => n + (state.boards.get(p.id)?.prs.length ?? 0), 0);
    const previews = [...state.previews.keys()].filter((id) => !state.isHidden(id)).length;
    fill(
      this.stats,
      !state.connected ? h('div', { class: 'stat bad' }, '🔌 reconnecting…') : null,
      state.info && !state.info.github.ok ? h('div', { class: 'stat bad' }, '⚠ GitHub not connected') : null,
      h('div', { class: 'stat' }, `⌨️ ${working} working`),
      queued ? h('div', { class: 'stat' }, `⏳ ${queued} queued`) : null,
      h('div', { class: 'stat' }, `👀 ${prs} PR${prs === 1 ? '' : 's'}`),
      previews ? h('div', { class: 'stat' }, `▶ ${previews} preview${previews === 1 ? '' : 's'}`) : null,
      // what the plugins add, wherever you are on the ship
      ...hudStats().map((stat) => h('div', { class: `stat${stat.tone ? ` ${stat.tone}` : ''}`, title: stat.title }, stat.text)),
      // whatever waits on the captain, anywhere on the ship: C opens Comms to answer it
      h('div', { class: `comms-badge${hails ? ' hailing' : ''}`, title: hails ? `${hails} waiting on you: press C` : 'Nobody is waiting on you' },
        h('span', null, 'Comms'), h('b', null, hails), h('kbd', null, 'C')),
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
