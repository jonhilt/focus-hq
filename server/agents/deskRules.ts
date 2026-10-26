import type { Agent } from '../../shared/types';
import { DESKS_PER_ROOM } from '../../shared/types';

// Who sits at a room's individual desks. Pure: the manager does the seating and the sending home.

const FINISHED = ['done', 'error', 'stopped'];

/** An agent at one of the room's individual desks (not QA, a lead, or someone waiting for a desk). */
const atDesk = (a: Pick<Agent, 'task' | 'desk'>) => a.task !== 'review' && a.task !== 'lead' && a.desk >= 0 && a.desk < DESKS_PER_ROOM;

/**
 * A desk for a newcomer to the room: a free one, else the desk of whoever finished first, who goes home (failed and
 * stopped agents before ones with a PR open). Never a goal's lead or QA, who don't sit at the desks. Undefined when
 * every desk has someone at work.
 */
export function pickDesk(inRoom: Agent[]): { desk: number; evict?: Agent } | undefined {
  const seated = inRoom.filter(atDesk);
  const taken = new Set(seated.map((a) => a.desk));
  for (let desk = 0; desk < DESKS_PER_ROOM; desk++) if (!taken.has(desk)) return { desk };
  const rank = (a: Agent) => (a.status === 'done' ? 1 : 0);
  const evict = seated
    .filter((a) => FINISHED.includes(a.status))
    .sort((a, b) => rank(a) - rank(b) || (a.finishedAt ?? 0) - (b.finishedAt ?? 0))[0];
  return evict && { desk: evict.desk, evict };
}

/** Whether a desk agent is off the floor: sat at a desk the room no longer has (it had six before team stations). */
export const offTheFloor = (a: Pick<Agent, 'task' | 'desk'>) => a.task !== 'review' && a.task !== 'lead' && a.desk >= DESKS_PER_ROOM;

/**
 * Agents saved at desks the room no longer has take its free desks, unfinished work first, then the most recent. The
 * rest stay off the floor, records and checkouts kept, and take a desk the next time they start. New desks by agent id.
 */
export function fitDesks(agents: Agent[]): Map<string, number> {
  const moves = new Map<string, number>();
  for (const projectId of new Set(agents.map((a) => a.projectId))) {
    const inRoom = agents.filter((a) => a.projectId === projectId);
    const free = [...Array(DESKS_PER_ROOM).keys()].filter((d) => !inRoom.some((a) => atDesk(a) && a.desk === d));
    const waiting = inRoom
      .filter(offTheFloor)
      .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt));
    for (const [i, agent] of waiting.entries()) if (i < free.length) moves.set(agent.id, free[i]);
  }
  return moves;
}
