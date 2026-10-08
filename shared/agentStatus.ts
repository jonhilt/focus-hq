import { clock } from './clock';
import type { Agent, AgentStatus } from './types';

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
