import { columns } from '../../../shared/board';
import { waiting } from '../../../shared/captainsInbox';
import { type Attention, needsYou, turnRead } from '../../../shared/tricorder';
import type { Agent } from '../../../shared/types';
import { api } from './api';
import { state } from './state';

// What waits on the captain right now, for the 3D ship's Comms panel and badge and the Tricorder's Needs you strip,
// and telling Focus when they've read a lead's turn.

/** Turns already on their way to Focus, so a burst of updates to an open panel asks once. */
const asked = new Set<string>();

/**
 * The captain is reading the lead's latest turn (their panel is open, say): it stops hailing them on every screen until
 * the lead's next one. Only on the screen they're looking at: a panel left open on a desk while they're on their
 * phone reads nothing.
 */
export function markRead(agent: Agent): void {
  if (!agent.lead || agent.status !== 'done' || turnRead(agent)) return;
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
  const key = `${agent.id}:${agent.finishedAt}`;
  if (asked.has(key)) return;
  asked.add(key);
  api.readTurn(agent.id).catch(() => asked.delete(key));
}

/** The pull requests the shown projects' boards show, for what needs the captain. */
function shownPrs() {
  const login = state.info?.github.login;
  return state.shown.flatMap((project) =>
    columns(project, state.boards.get(project.id), state.agentsIn(project.id), login).prs.map((pr) => ({ projectId: project.id, pr })),
  );
}

/** What's hailing the captain across the shown projects, for the badge: `needsYou` over the agents and the boards' PRs. */
export const attention = (): Attention[] => needsYou(state.shownAgents(), shownPrs(), state.reviews);

/**
 * Everything waiting on the captain across the shown projects: the hails, then the leads whose turn they've read but
 * not answered (`waiting`). Focus's inbox (`GET /api/inbox`) is the same list.
 */
export const needs = (): Attention[] => waiting(state.shownAgents(), shownPrs(), state.reviews, state.shown.flatMap((p) => state.leadsIn(p.id)), Date.now());
