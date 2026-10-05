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
      return 'Needs your approval!';
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
