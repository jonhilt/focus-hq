import { chiefEngineer } from '../../../shared/crew';
import { reportLines } from '../../../shared/ledger';
import { api } from '../net/api';
import { state } from '../net/state';
import { clientPlugins, type EngineeringGo } from '../plugins';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { busy, fill, h } from './dom';
import { type NavItem, readout, shownView, SideNav } from './panels';
import { usageView } from './usageView';
import { frictionBars } from './frictionBars';

/** A view of the station: the overview and the ledger are the core's, and plugins add their own (the scorecard's). */
type View = string;

/**
 * The engineering station, a view at a time: your plan's usage and the plugins' parts at a glance (the scorecard's
 * overview, the plugins' cards), each plugin's views (the scorecard's code and office numbers), and the ledger as it
 * stands, with the agents' older sessions to digest.
 */
export function openEngineeringPanel(ui: Ui): void {
  const eng = chiefEngineer();
  const body = h('div', { class: 'engineering' });
  // what the captain opened outlives re-renders
  const open = new Set<string>();
  let picked: View | undefined;

  // the agents' sessions from before digests began: counted once when the panel opens
  const older = h('div', { class: 'row', style: 'margin:10px 0' });
  const showOlder = (count: number) => {
    if (!count) return fill(older);
    const go = h('button', { class: 'btn small' }, 'Digest them');
    go.onclick = () => {
      void busy(go, () => api.backfillDigests().then(() => fill(older, h('span', { class: 'muted' }, `Digesting ${count} older sessions: the report card fills in as they’re done`))), ui.error);
    };
    fill(older, h('span', { class: 'muted grow' }, `${count} older agent sessions haven’t been digested`), go);
  };
  void api.undigested().then((r) => showOlder(r.sessions)).catch(() => undefined);

  const nav = new SideNav<View>((view) => {
    picked = view;
    render();
  });
  /** To one of the views, scrolled to what's asked for, with `at.key` opened. */
  const go: EngineeringGo = (view, at = {}) => {
    if (at.key) open.add(at.key);
    picked = view;
    render();
    const target = at.key ? `[data-key="${at.key}"]` : at.anchor ? `#${at.anchor}` : undefined;
    if (target) body.querySelector(target)?.scrollIntoView({ block: 'start' });
  };

  const render = () => {
    const parts = clientPlugins().flatMap((plugin) => (plugin.engineering ? [plugin.engineering] : []));
    const pluginViews = parts.flatMap((part) => part.views ?? []);
    const items: NavItem<View>[] = [
      { key: 'overview', label: 'Overview', readout: parts.map((part) => part.readout?.() ?? '').find(Boolean) ?? '' },
      ...pluginViews.map((v) => ({ key: v.key, label: v.label, readout: v.readout?.() ?? '', standby: v.standby?.() })),
      { key: 'ledger', label: 'Ledger', readout: state.report?.merged ? `${Math.round((state.report.mergedFirstTime / state.report.merged) * 100)}%` : '' },
    ];
    const view = shownView(items, picked) ?? 'overview';
    nav.show(items, view);
    const ledger = h('button', { class: 'btn small' }, 'Review the ledger →');
    ledger.onclick = () => ui.openLedger();
    const overview = () => {
      // every plugin's card, laid out by the first plugin with an overview of its own (the scorecard's), or on their own
      const cards = h('div', { class: 'eng-cards' }, ...parts.map((part) => part.card?.(ui, go) ?? null));
      const laidOut = parts.find((part) => part.overview)?.overview?.(ui, cards, go);
      return [usageView(ui), laidOut ?? cards];
    };
    const plugged = pluginViews.find((v) => v.key === view);
    const shown = view === 'overview' ? overview()
      : view === 'ledger' ? [liveLedger(ui, ledger), older]
        : plugged ? plugged.render(ui, go, open) : overview();
    fill(body, ...shown);
  };

  ui.panels.open({ title: `${eng.name} · Chief engineer`, body, nav, accent: LCARS.gold, wide: true });
  ui.panels.own(state.on('report', render));
  ui.panels.own(state.on('usage', render));
  ui.panels.own(state.on('plugin', render));
  // what agents on a plugin's brief are doing, as they work (the climber's card)
  ui.panels.own(state.on('agent', (a) => {
    if (a.brief) render();
  }));
  render();
}

/** The ledger as it stands now: the report card's numbers, and the open frictions. */
function liveLedger(ui: Ui, ledger: HTMLElement): HTMLElement {
  const card = state.report;
  const shown = card ? reportLines(card) : undefined;
  const warnings = [...(card?.warnings ?? []).map((w) => `⚠ Ledger damaged: ${w}`), ...(card?.notes ?? []).map((n) => `Ledger: ${n}`)];
  const live = card && (card.merged || card.closed || card.verdicts)
    ? h('div', { class: 'readouts' },
      readout('Merged', String(card.merged)),
      readout('QA first time', card.merged ? `${Math.round((card.mergedFirstTime / card.merged) * 100)}%` : '–'),
      readout('Closed unmerged', String(card.closed)),
      readout('Conflicts', `${card.conflicts} (${card.conflictsForAgent} for an agent)`),
      readout('Triaged', String(card.triages)),
      readout('Goals closed', String(card.goalsClosed)),
      card.sessions ? readout('Per merge', `$${card.costPerMerge.toFixed(2)}`) : null,
      readout('Spent', `$${card.costUsd.toFixed(2)}`))
    : h('small', { class: 'muted' }, shown?.lines.join(' · ') ?? 'Nothing in the ledger yet');
  const bars = frictionBars(ui, 5);
  return h('section', { class: 'card eng-section', style: '--c:var(--lcars-orange)' },
    h('div', { class: 'row' }, h('h4', { class: 'grow' }, `The ledger now${card ? `, last ${card.days} days` : ''}`, h('span', null, 'Live, as the ledger fills')), ledger),
    ...warnings.map((w) => h('small', null, w)),
    live,
    bars ? h('h4', null, 'Most widespread open frictions', h('span', null, 'Sessions they came up in, over 14 days, with no decision on them yet')) : null,
    bars,
  );
}
