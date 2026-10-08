import { columns } from '../../../shared/board';
import { type Attention, needsYou, turnRead } from '../../../shared/tricorder';
import type { Agent } from '../../../shared/types';
import { api } from './api';
import { state } from './state';

// What waits on the captain right now, for the 3D office's Comms panel and badge and the Tricorder's Needs you strip,
// and telling the office when they've read a lead's turn.

/** Turns already on their way to the office, so a burst of updates to an open panel asks once. */
const asked = new Set<string>();

/**
 * The captain is reading the lead's latest turn (their panel is open, say): it stops hailing them on every screen until
 * the lead's next one. Only on the screen they're looking at: a panel left open on a desk while they're on their
 * phone reads nothing. `force`: they said so (Later), wherever the focus is.
 */
export function markRead(agent: Agent, force = false): void {
  if (!agent.lead || agent.status !== 'done' || turnRead(agent)) return;
  if (!force && (document.visibilityState !== 'visible' || !document.hasFocus())) return;
  const key = `${agent.id}:${agent.finishedAt}`;
  if (asked.has(key)) return;
  asked.add(key);
  api.readTurn(agent.id).catch(() => asked.delete(key));
}

/** Everything waiting on the captain across the shown projects: `needsYou` over the agents and the boards' PRs. */
export function attention(): Attention[] {
  const login = state.info?.github.login;
  const prs = state.shown.flatMap((project) =>
    columns(project, state.boards.get(project.id), state.agentsIn(project.id), login).prs.map((pr) => ({ projectId: project.id, pr })),
  );
  return needsYou(state.shownAgents(), prs, state.reviews);
}
