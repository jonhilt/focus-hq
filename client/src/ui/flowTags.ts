import { flowNow, flowText, flowTitle } from '../../../shared/flow';
import type { Agent } from '../../../shared/types';
import { state } from '../net/state';
import { FLOW_COLOR } from '../world/starship';
import type { Ui } from './context';
import { h } from './dom';

// What a goal's waiting on and for how long (docs/flow.md), wherever a panel lists goals: Comms and the goals list.
// Panels keep some rows from render to render (so a busy button isn't swapped under the pointer), and nothing in the
// office changes while a goal waits on the captain, so each tag is written from its goal's latest flow when the panel
// renders and again each minute, rather than only when its row is built.

/** A goal's flow, live: `class` is `flow-tag` for an outlined tag, `flow-live` for plain text in its state's colour. */
export function flowLive(agent: Agent, cls: 'flow-tag' | 'flow-live'): HTMLElement | null {
  if (!agent.lead?.flow) return null;
  const el = h('span', { class: cls, attrs: { 'data-flow-of': agent.id } });
  write(el);
  return el;
}

function write(el: HTMLElement): void {
  const id = el.dataset.flowOf;
  const flow = id ? state.agents.get(id)?.lead?.flow : undefined;
  if (!flow) return;
  const now = Date.now();
  el.textContent = flowText(flow, now);
  el.title = flowTitle(flow, now);
  el.style.setProperty('--tone', FLOW_COLOR[flowNow(flow, now).state]);
}

/** Writes every live flow in `el` from its goal's latest flow: now, and each minute while the panel's open. */
export function keepFlowsLive(ui: Ui, el: HTMLElement): () => void {
  const refresh = () => el.querySelectorAll<HTMLElement>('[data-flow-of]').forEach(write);
  const timer = window.setInterval(refresh, 60_000);
  ui.panels.own(() => window.clearInterval(timer));
  return refresh;
}
