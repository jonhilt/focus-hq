// The open frictions as bars: on the engineering station's ledger, and in plugins' views (the retro's,
// through plugin-api/client). Apart from the station's panel so a plugin can show them without importing the panel.
import { frictionName } from '../../../shared/ledger';
import { state } from '../net/state';
import type { Ui } from './context';
import { h } from './dom';

/** The open frictions, the most widespread first, as bars (plugins' views show them too). Each opens its trace in the ledger review. */
export function frictionBars(ui: Ui, limit: number): HTMLElement | null {
  const frictions = state.report?.frictions.slice(0, limit) ?? [];
  if (!frictions.length) return null;
  const most = frictions[0].sessions || 1;
  return h('div', { class: 'eng-frictions' }, ...frictions.map((f) => {
    const { kind, signature } = frictionName(f.key);
    return h('button', { class: 'eng-friction', title: `${f.key}: open every session it came up in`, onclick: () => ui.openLedger({ kind: 'friction', key: f.key }) },
      h('span', { class: 'grow' }, signature, kind ? h('small', { class: 'muted' }, ` ${kind}`) : null),
      h('span', { class: 'bar' }, h('i', { style: `width:${Math.max(4, (f.sessions / most) * 100)}%` })),
      h('small', { class: 'muted' }, `${f.sessions} sessions ›`));
  }));
}
