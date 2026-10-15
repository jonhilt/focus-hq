import { type Agent, type GoalTagPlace, h, onPluginState, pluginState } from '../../plugin-api/client';
import { FLOW_COLOR } from './colors';
import { FLOW, type FlowPluginState, type LeadFlow } from './shared';
import { flowNow, flowText, flowTitle } from './words';

// What a goal's waiting on and for how long (README.md), wherever a panel lists goals: Comms and the goals list.
// Panels keep some rows from render to render (so a busy button isn't swapped under the pointer), and nothing in the
// office changes while a goal waits on the captain, so each tag writes itself from its goal's latest flow as the
// plugin's state changes and again each minute, rather than only when its row is built.

/** An open goal's latest flow, as the plugin's state has it. */
const flowOf = (id: string): LeadFlow | undefined => pluginState<FlowPluginState>(FLOW)?.leads[id];

/**
 * A goal's flow, live: on its card in the goals list only once there's a flow to show (the list is drawn again as the
 * plugin's state changes), and on its line in Comms always, hidden until there is.
 */
export function flowTag(lead: Agent, where: GoalTagPlace): { label: string; el: HTMLElement } | null {
  if (!lead.lead || (where === 'card' && !flowOf(lead.id))) return null;
  const el = h('span', { attrs: { 'data-flow-of': lead.id } });
  write(el);
  keepLive();
  return { label: 'Flow', el };
}

function write(el: HTMLElement): void {
  const id = el.dataset.flowOf;
  const flow = id ? flowOf(id) : undefined;
  el.hidden = !flow;
  if (!flow) return;
  const now = Date.now();
  el.textContent = flowText(flow, now);
  el.title = flowTitle(flow, now);
  el.style.setProperty('--tone', FLOW_COLOR[flowNow(flow, now).state]);
}

let live = false;

/**
 * From the first tag on: every tag on the page written again as the plugin's state changes, and each minute. Never
 * undone, on purpose: the page lives as long as the office does, and a page with no tags on it costs one query a minute.
 */
function keepLive(): void {
  if (live) return;
  live = true;
  const refresh = () => document.querySelectorAll<HTMLElement>('[data-flow-of]').forEach(write);
  window.setInterval(refresh, 60_000);
  onPluginState(FLOW, refresh);
}
