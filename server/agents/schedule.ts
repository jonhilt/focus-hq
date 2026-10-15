import type { Agent, Project } from '../../shared/types';
import { ACTIVE_STATUSES, AWAY_DESK } from '../../shared/types';

/** QA officers, leads and agents on a brief away from the room don't sit at one of its desks, and don't count against its limit (only the global one). */
export const deskless = (a: Pick<Agent, 'task' | 'desk'>) => a.task === 'review' || a.task === 'lead' || a.desk === AWAY_DESK;

/**
 * Which queued agents start now, under the office's limit (`maxConcurrent`, everyone counts) and each room's
 * (`maxAgents`, desk agents only), and why the others wait. QA goes first, then whoever was queued first: finished
 * work gets reviewed before new work starts.
 */
export function whoStarts(agents: Agent[], projects: Pick<Project, 'id' | 'name' | 'maxAgents'>[], maxConcurrent: number): { start: Agent[]; wait: { agent: Agent; why: string }[] } {
  const active = agents.filter((a) => ACTIVE_STATUSES.includes(a.status));
  let running = active.length;
  const inRoom = new Map<string, number>();
  for (const a of active) if (!deskless(a)) inRoom.set(a.projectId, (inRoom.get(a.projectId) ?? 0) + 1);
  const queued = agents
    .filter((a) => a.status === 'queued')
    .sort((a, b) => Number(b.task === 'review') - Number(a.task === 'review') || a.startedAt - b.startedAt);
  const start: Agent[] = [];
  const wait: { agent: Agent; why: string }[] = [];
  for (const agent of queued) {
    if (running >= maxConcurrent) {
      wait.push({ agent, why: `Waiting for a free slot (${running} agents busy)` });
      continue;
    }
    const project = projects.find((p) => p.id === agent.projectId);
    if (!project) continue;
    if (!deskless(agent) && (inRoom.get(project.id) ?? 0) >= project.maxAgents) {
      wait.push({ agent, why: `Waiting – ${project.name} allows ${project.maxAgents} at once` });
      continue;
    }
    running++;
    if (!deskless(agent)) inRoom.set(project.id, (inRoom.get(project.id) ?? 0) + 1);
    start.push(agent);
  }
  return { start, wait };
}
