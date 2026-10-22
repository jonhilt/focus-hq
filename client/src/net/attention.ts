import { columns } from '../../../shared/board';
import { turnRead } from '../../../shared/tricorder';
import type { Agent, PullRequest } from '../../../shared/types';
import { api } from './api';
import { state } from './state';

// Telling Focus the captain has read a lead's turn, and the pull requests the shown projects' boards show (what a
// plugin that lists what waits on the captain reads, with the agents).

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

/** The pull requests the shown projects' boards show, each with its project (and the agent resolving it, if one is). */
export function shownPrs(): { projectId: string; pr: PullRequest & { agent?: Agent; resolver?: Agent } }[] {
  const login = state.info?.github.login;
  return state.shown.flatMap((project) =>
    columns(project, state.boards.get(project.id), state.agentsIn(project.id), login).prs.map((pr) => ({ projectId: project.id, pr })),
  );
}
