import { qaOfficerFor } from '../shared/crew';
import { ACTIVE_STATUSES, type Agent, type Avatar } from '../shared/types';

// How an agent saved before a restart picks up again: who stops, what doesn't outlive Focus, and what one saved by an
// older Focus gains. Pure, so it's unit tested (agentRestartRules.test.ts); the store loads them and rolls new avatars.

/**
 * A lead saved before goals (with no title): the project's one lead becomes a goal, keeping its session, slices and pull
 * requests. Anyone else, and a lead that already has a goal, comes back as it was.
 */
export function upgradeLead(agent: Agent, projectName: string): Agent {
  if (agent.task !== 'lead' || !agent.lead || agent.lead.title) return agent;
  const title = `${projectName}’s first goal`;
  return { ...agent, issue: { ...agent.issue, title }, lead: { ...agent.lead, title } };
}

/**
 * An agent saved by a Focus that could run them in a Claude Code cloud session: `cloud` when they worked in one, and
 * `handover` while they waited for one, keeping their conversation on this machine.
 */
export type SavedAgent = Agent & { cloud?: boolean; handover?: { localSessionId?: string } };

/**
 * An agent as they pick up after a restart (`projectName` is their room's, for a lead saved before goals): whoever was at
 * work stops, and waits for a message; what doesn't outlive Focus (a lead's subagents, workflows and background work, a hold
 * for the plan's usage limit) goes; one saved before a field existed gets it (a crew member saved before uniforms
 * gets `newAvatar()`); and one saved in or waiting for a cloud session works here, in their conversation on this
 * machine if they had one.
 */
export function agentAfterRestart(saved: SavedAgent, projectName: string, newAvatar: () => Avatar): Agent {
  const { cloud, handover, ...kept } = saved;
  let agent: Agent = { ...kept, task: saved.task ?? 'issue', helpers: undefined, workflows: undefined, background: undefined };
  // a cloud session's id doesn't resume here
  if (cloud || handover) agent = { ...agent, sessionId: handover?.localSessionId };
  if (ACTIVE_STATUSES.includes(agent.status) || agent.status === 'queued') {
    agent = { ...agent, status: 'stopped', activity: 'Interrupted when Focus shut down. Send a message to pick it back up.', permission: undefined };
  }
  if (agent.held) {
    // whatever waited for your plan's limit to reset waits for the captain now
    agent = { ...agent, held: undefined, activity: 'Was waiting for your plan’s usage limit when Focus shut down. Send a message to pick it back up.' };
  }
  agent = upgradeLead(agent, projectName);
  // saved before the crew wore uniforms
  if (!('division' in agent.avatar)) agent = { ...agent, avatar: agent.task === 'review' ? qaOfficerFor(agent.projectId).avatar : newAvatar() };
  return agent;
}
