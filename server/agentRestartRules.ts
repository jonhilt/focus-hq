import { qaOfficerFor } from '../shared/crew';
import { ACTIVE_STATUSES, type Agent, type Avatar } from '../shared/types';

// How an agent saved before a restart picks up again: who stops, what doesn't outlive Focus, and what one saved by an
// older Focus gains. Pure, so it's unit tested (agentRestartRules.test.ts); the store loads them and rolls new avatars.

/**
 * A lead saved before goals: the project's one lead becomes the goal at the first team station, keeping its session,
 * slices and pull requests. Anyone else, and a lead that already has a station, comes back as it was.
 */
export function upgradeLead(agent: Agent, projectName: string): Agent {
  if (agent.task !== 'lead' || !agent.lead || typeof agent.lead.station === 'number') return agent;
  const title = `${projectName}’s first goal`;
  return { ...agent, issue: { ...agent.issue, title }, lead: { ...agent.lead, station: 0, title } };
}

/**
 * An agent as they pick up after a restart (`projectName` is their room's, for a lead saved before team stations): whoever was at
 * work stops, and waits for a message; what doesn't outlive Focus (a lead's subagents, workflows and background work, a hold
 * for the plan's usage limit) goes; and one saved before a field existed gets it (a crew member saved before uniforms
 * gets `newAvatar()`).
 */
export function agentAfterRestart(saved: Agent, projectName: string, newAvatar: () => Avatar): Agent {
  let agent: Agent = { ...saved, task: saved.task ?? 'issue', helpers: undefined, workflows: undefined, background: undefined };
  if (agent.handover) {
    // still waiting for the captain to start their cloud session; a terminal opened before isn't watched any more
    agent = { ...agent, status: 'waiting', activity: 'Waiting for a cloud session', handover: { ...agent.handover, terminalAt: undefined } };
  } else if (ACTIVE_STATUSES.includes(agent.status) || agent.status === 'queued') {
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
