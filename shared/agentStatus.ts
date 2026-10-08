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

export const statusIcon = (a: Agent): string => STATUS_ICON[a.status];

export function statusLine(agent: Agent): string {
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
