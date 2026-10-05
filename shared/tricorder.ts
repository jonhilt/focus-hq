import { prKey, qaBadge } from './qa';
import type { Agent, PullRequest, QaReview } from './types';
import { ACTIVE_STATUSES } from './types';

// What the Tricorder (the phone view at /tricorder) puts in front of the manager. Pure, so it's unit tested
// (shared/tricorder.test.ts).

/** Something that waits on the manager: nothing moves until they act on it. */
export type Attention =
  | { kind: 'hand'; agent: Agent }
  | { kind: 'error'; agent: Agent }
  | { kind: 'qa'; projectId: string; pr: PullRequest }
  | { kind: 'conflicts'; projectId: string; pr: PullRequest };

/**
 * The Needs you strip: agents with a raised hand or in error, PRs QA gave up on and PRs that conflict with their base.
 * `prs` are the PRs the boards show, so a project's "only my PRs" filter applies here too.
 */
export function needsYou(agents: Agent[], prs: { projectId: string; pr: PullRequest }[], reviews: ReadonlyMap<string, QaReview>): Attention[] {
  const fromAgents = agents.flatMap((agent): Attention[] =>
    agent.permission ? [{ kind: 'hand', agent }] : agent.status === 'error' ? [{ kind: 'error', agent }] : [],
  );
  const fromPrs = prs.flatMap(({ projectId, pr }): Attention[] => [
    ...(qaBadge(reviews.get(prKey(pr.repo, pr.number)), pr).state === 'needs-you' ? [{ kind: 'qa' as const, projectId, pr }] : []),
    ...(pr.mergeable === 'CONFLICTING' ? [{ kind: 'conflicts' as const, projectId, pr }] : []),
  ]);
  return [...fromAgents, ...fromPrs];
}

/** A project's agents at work or waiting for a slot, oldest first. The QA officer counts while they're reviewing. */
export function inFlight(projectId: string, agents: Agent[]): Agent[] {
  return agents
    .filter((a) => a.projectId === projectId && (a.status === 'queued' || ACTIVE_STATUSES.includes(a.status)))
    .sort((a, b) => a.startedAt - b.startedAt);
}
