import { clock } from './clock';
import type { Agent, AgentStatus, RunView } from './types';

// How an agent's status reads, wherever it's shown: the 3D office, its panels and the Tricorder.

export const STATUS_ICON: Record<AgentStatus, string> = {
  queued: '⏳',
  'setting-up': '📦',
  working: '⌨️',
  testing: '🧪',
  waiting: '✋',
  pushing: '🚀',
  done: '✅',
  error: '❗',
  stopped: '💤',
};

/** On hold for your plan's usage limit to reset (`Agent.held`), whatever they were doing. */
export const HELD_ICON = '⏸';

export const statusIcon = (a: Agent): string => (a.held ? HELD_ICON : STATUS_ICON[a.status]);

/** Each phase of a run, as its machine names it, in words. */
const PHASES: Record<string, string> = {
  idle: 'idle',
  waiting: 'waiting for a slot',
  'setting-up': 'setting up',
  'turn.requested': 'starting',
  'turn.started': 'running',
  'turn.stopping': 'stopping',
  ended: 'ended',
  interrupted: 'interrupted',
  'delivering.pushing': 'pushing',
  'delivering.opening': 'opening the PR',
  delivered: 'delivered',
  failed: 'delivery failed',
};

/** Where an agent's run is, as its journal tells it: `turn 3 · running`, `turn 3 ended → deliver`. */
export function runLine(run: RunView): string {
  const phase = PHASES[run.phase] ?? run.phase;
  const turn = run.turns ? `turn ${run.turns} ` : '';
  if (run.phase === 'delivered' && run.pr) return `${turn}delivered → PR #${run.pr}`;
  if (run.phase.startsWith('delivering.') || run.phase === 'delivered' || run.phase === 'failed') return `${turn}${phase}`;
  if (run.phase.startsWith('turn.') || run.phase === 'ended' || run.phase === 'interrupted') return `${turn}${phase}${run.target ? ` → ${run.target}` : ''}`;
  return phase;
}

export function statusLine(agent: Agent): string {
  if (agent.held) return `On hold till ${clock(agent.held.until)}: your plan's usage limit`;
  switch (agent.status) {
    case 'waiting':
      return agent.handover ? 'Needs you to start their cloud session' : 'Needs your approval!';
    case 'done':
      return agent.pr ? `PR #${agent.pr.number} ready for review` : agent.activity;
    case 'error':
      return 'Hit a problem – come and look';
    case 'stopped':
      return 'Stopped';
    default:
      return agent.activity || agent.status;
  }
}

/** How full an agent's context is: fine, filling up (worth compacting at a good moment), or nearly full. */
export function contextLevel(percent: number): 'ok' | 'filling' | 'full' {
  return percent >= 80 ? 'full' : percent >= 60 ? 'filling' : 'ok';
}
