import { openQuestion } from './artifacts';
import { prKey, qaBadge } from './qa';
import type { Agent, PullRequest, QaReview } from './types';
import { ACTIVE_STATUSES } from './types';

// What the Tricorder (the phone view at /tricorder) and the 3D office's Comms panel put in front of the manager. Pure,
// so it's unit tested (shared/tricorder.test.ts).

/** Something that waits on the manager: nothing moves until they act on it. */
export type Attention =
  | { kind: 'hand'; agent: Agent }
  | { kind: 'question'; agent: Agent }
  | { kind: 'error'; agent: Agent }
  /** A goal's lead thinks the goal is done: close it, or carry on. */
  | { kind: 'wrap-up'; agent: Agent }
  /** A goal's lead finished a turn and waits for the captain's reply. */
  | { kind: 'turn'; agent: Agent }
  | { kind: 'qa'; projectId: string; pr: PullRequest }
  | { kind: 'conflicts'; projectId: string; pr: PullRequest };

/** A lead waiting for the captain, whose turn the captain has read: still their turn, but no longer hailing. */
export const turnRead = (agent: Pick<Agent, 'status' | 'finishedAt' | 'lead'>): boolean =>
  agent.status === 'done' && agent.finishedAt !== undefined && agent.lead?.readTurn === agent.finishedAt;

/** What an agent waits on the manager for, if anything. */
function agentAttention(agent: Agent): Attention | null {
  if (agent.permission) return { kind: 'hand', agent };
  if (agent.status === 'error') return { kind: 'error', agent };
  if (openQuestion(agent)) return { kind: 'question', agent };
  if (agent.task !== 'lead') return null;
  if (agent.lead?.closing) return { kind: 'wrap-up', agent };
  return agent.status === 'done' && !turnRead(agent) ? { kind: 'turn', agent } : null;
}

/**
 * The Needs you strip: agents with a raised hand, a question for you or in error, goals' leads proposing to wrap up or waiting for a reply
 * (unless the manager has read that turn: `turnRead`), PRs QA gave up on and PRs that conflict with
 * their base (unless someone's resolving it already). `prs` are the PRs the boards show, so a project's "only my PRs"
 * filter applies here too.
 */
export function needsYou(
  agents: Agent[],
  prs: { projectId: string; pr: PullRequest & { resolver?: Agent } }[],
  reviews: ReadonlyMap<string, QaReview>,
): Attention[] {
  const fromAgents = agents.flatMap((agent) => agentAttention(agent) ?? []);
  const fromPrs = prs.flatMap(({ projectId, pr }): Attention[] => [
    ...(qaBadge(reviews.get(prKey(pr.repo, pr.number)), pr).state === 'needs-you' ? [{ kind: 'qa' as const, projectId, pr }] : []),
    ...(pr.mergeable === 'CONFLICTING' && !pr.resolver ? [{ kind: 'conflicts' as const, projectId, pr }] : []),
  ]);
  return [...fromAgents, ...fromPrs];
}

/** A project's agents at work or waiting for a slot, oldest first. The QA officer counts while they're reviewing. */
export function inFlight(projectId: string, agents: Agent[]): Agent[] {
  return agents
    .filter((a) => a.projectId === projectId && (a.status === 'queued' || ACTIVE_STATUSES.includes(a.status)))
    .sort((a, b) => a.startedAt - b.startedAt);
}
