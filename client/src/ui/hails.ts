import { type Attention, hailNews, hailOf, needLine, needsYou } from '../../../shared/tricorder';
import { shownPrs } from '../net/attention';
import { state } from '../net/state';
import { pluginHails } from '../plugins';
import { agentPanelOpen } from './agentPanel';
import type { Ui } from './context';
import { h } from './dom';

// The core's plain word to the captain on what waits on them, wherever they are on the ship: a count on the HUD and a
// toast as an agent comes to need them (a raised hand, a question, a lead's turn, a goal ready to close). A plugin
// switched on that puts these in front of the captain its own way (`ClientPlugin.hails`) takes their place.

/** What waits on the captain across the shown projects (`needsYou`). */
export const waitingOnYou = (): Attention[] => needsYou(state.shownAgents(), shownPrs(), state.reviews);

/** The HUD's count of what waits on the captain, each on a line on hover; nothing when nothing does, or a plugin counts it. */
export function hailStat(hails: Attention[], pluginsHail: boolean): HTMLElement | null {
  if (pluginsHail || !hails.length) return null;
  const lines = hails.map((a) => {
    const { icon, what } = needLine(a, state.reviews);
    return `${icon} ${'agent' in a ? `${a.agent.name}: ` : `${a.pr.repo}#${a.pr.number}: `}${what}`;
  });
  return h('div', { class: 'stat warn hails', title: lines.join('\n') }, `🖖 ${hails.length} waiting on you`);
}

/**
 * Toasts each agent of a shown project as it comes to need the captain (`hailNews`), unless their panel is open or a
 * plugin says it its own way. What already waits as Focus sends its state (a reload, a reconnect) isn't toasted again,
 * nor an agent the first time it's heard of.
 */
export function toastHails(ui: Pick<Ui, 'hud' | 'openAgent'>): void {
  const before = new Map<string, Attention['kind'] | null>();
  state.on('snapshot', () => {
    before.clear();
    for (const agent of state.agents.values()) before.set(agent.id, hailOf(agent));
  });
  state.on('agent', (agent) => {
    const news = hailNews(before.get(agent.id), agent, state.reviews);
    before.set(agent.id, hailOf(agent));
    if (!news || state.isHidden(agent.projectId) || pluginHails() || agentPanelOpen(agent.id)) return;
    ui.hud.toast('info', news, { label: 'Talk', run: () => ui.openAgent(agent.id) });
  });
  state.on('agent-removed', (agent) => before.delete(agent.id));
}
