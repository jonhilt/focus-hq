import { agentSignIn, signInLine, usageHeadline, usageRows } from '../../../shared/usage';
import { state } from '../net/state';
import type { Ui } from './context';
import { h, timeAgo } from './dom';

const SIGN_IN = { plan: { chip: '', label: 'plan' }, key: { chip: 'warn', label: '🔑 key' }, cloud: { chip: 'off', label: '☁ cloud' } };

/**
 * Your plan's usage at the top of the engineering panel: a bar per limit, how the office signs in, and each agent on
 * board with what they sign in with and what their session has used at API prices (docs/usage.md).
 */
export function usageView(ui: Ui): HTMLElement {
  const usage = state.usage;
  const rows = usageRows(usage);
  const onMsd = h('button', { class: 'btn small' }, 'Show on the MSD');
  onMsd.disabled = !rows.length;
  onMsd.onclick = () => ui.showOnMsd('usage');
  const read = usage?.plan ? ` · read ${timeAgo(usage.plan.at)}` : '';

  const agents = [...state.agents.values()].sort((a, b) => b.costUsd - a.costUsd);
  return h('div', { class: 'usage' },
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, `Plan usage · ${usageHeadline(usage)}${read}`), onMsd),
    ...rows.map((r) => h('div', { class: `usage-row ${r.tone}` },
      h('div', { class: 'row' }, h('span', { class: 'grow' }, r.label), h('small', { class: 'muted' }, r.note), h('strong', null, `${r.percent}%`)),
      h('div', { class: 'usage-bar' }, h('i', { style: `width:${Math.min(100, r.percent)}%` })),
    )),
    usage?.error && usage.plan ? h('small', { class: 'muted' }, `Last reading failed: ${usage.error}`) : null,
    h('small', { class: 'muted' }, signInLine(usage)),
    agents.length
      ? h('table', { class: 'usage-agents' },
        h('tr', null, h('th', null, 'Aboard'), h('th', null, 'Signs in with'), h('th', { title: 'What their session has used at API prices: on your plan it isn’t billed' }, 'Session')),
        ...agents.map((a) => {
          const how = SIGN_IN[agentSignIn(a)];
          return h('tr', null,
            h('td', null, a.name),
            h('td', null, h('span', { class: `chip ${how.chip}` }, how.label)),
            h('td', null, a.costUsd > 0 ? `~$${a.costUsd.toFixed(2)}` : '–'),
          );
        }))
      : null,
  );
}
