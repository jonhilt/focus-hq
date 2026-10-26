import type { Agent, AgentStatus } from '../../../shared/types';

// Whether the captain's Compact now goes ahead, and which statuses count as an agent's session being over. Pure, so
// it's unit tested (sessionRules.test.ts); sessions.ts does the compacting, and the manager's parts read FINISHED.

/** The statuses of an agent whose session is over: between turns, or sent home. */
export const FINISHED: AgentStatus[] = ['done', 'stopped', 'error'];

/** Why the captain's Compact now is refused (`running`: a turn of theirs is under way), or undefined when it isn't. */
export function compactRefusal(agent: Pick<Agent, 'name' | 'task' | 'sessionId' | 'cloud' | 'status'>, running: boolean): string | undefined {
  if (agent.task === 'review') return 'QA starts each review afresh, so there’s nothing to compact';
  if (!agent.sessionId || agent.cloud) return `${agent.name} has no conversation here to compact`;
  if (!FINISHED.includes(agent.status) || running) return `${agent.name} is working: compact once their turn ends`;
  return undefined;
}
