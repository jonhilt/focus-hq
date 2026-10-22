import { openQuestion } from './artifacts';
import { prKey, qaBadge } from './qa';
import type { Agent, PullRequest, QaReview } from './types';
import { ACTIVE_STATUSES } from './types';

// What waits on the captain, as the Tricorder (the phone view at /tricorder) and the 3D ship put it in front of them,
// and as a plugin reads it (Number One, an inbox). Pure, so it's unit tested (shared/tricorder.test.ts).

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

/** How urgent each kind is, most first: what has stopped an agent mid-work, then what's holding a goal up, then the PRs. */
const URGENCY: Attention['kind'][] = ['hand', 'error', 'question', 'turn', 'wrap-up', 'qa', 'conflicts'];

/** When an agent's hail began, for oldest first within a kind: the hand's raised, or the turn ended. */
const since = (a: Attention): number => ('agent' in a ? (a.kind === 'hand' ? a.agent.permission?.at : a.agent.finishedAt) ?? 0 : 0);

/**
 * Everything waiting on the captain, most urgent first (`URGENCY`, then oldest first): agents with a raised hand, a
 * question for you or in error, goals' leads proposing to wrap up or waiting for a reply (unless the captain has read
 * that turn: `turnRead`), PRs QA gave up on and PRs that conflict with their base (unless someone's resolving it
 * already). `prs` are the PRs the boards show, so a project's "only my PRs" filter applies here too.
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
  return [...fromAgents, ...fromPrs].sort((a, b) => URGENCY.indexOf(a.kind) - URGENCY.indexOf(b.kind) || since(a) - since(b));
}

/** What a hail needs from the captain, in a few words, the same wherever it's shown: an icon and a line. */
export function needLine(a: Attention, reviews: ReadonlyMap<string, QaReview>): { icon: string; what: string } {
  switch (a.kind) {
    case 'hand':
      return { icon: '✋', what: `Approve: ${a.agent.permission?.summary ?? 'something'}` };
    case 'error':
      return { icon: '❗', what: `Stuck: ${a.agent.error ?? 'hit a problem'}` };
    case 'question':
      return { icon: '❓', what: `Pick: ${openQuestion(a.agent)?.question ?? 'they ask you'}` };
    case 'turn':
      return { icon: '💬', what: 'Waiting for your reply' };
    case 'wrap-up':
      return { icon: '🏁', what: `Ready to close${a.agent.lead?.closing?.reason ? `: ${a.agent.lead.closing.reason}` : ''}` };
    case 'qa': {
      const followUp = reviews.get(prKey(a.pr.repo, a.pr.number))?.followUp;
      return { icon: '🙋', what: `QA needs you${followUp?.kind === 'needs-you' ? `: ${followUp.reason}` : ''}` };
    }
    case 'conflicts':
      return { icon: '⚠', what: 'Resolve conflicts with its base branch' };
  }
}

/** What an agent hails the captain for just now, if anything: `needsYou`'s kind for the one agent. */
export const hailOf = (agent: Agent): Attention['kind'] | null => agentAttention(agent)?.kind ?? null;

/** The hails a toast tells the captain of as they come: what stops an agent, or a goal, until they answer. */
const TOASTED: ReadonlySet<Attention['kind']> = new Set(['hand', 'question', 'turn', 'wrap-up']);

/**
 * The toast as an agent comes to need the captain, if it does: as it starts hailing them for something it wasn't
 * (`before`, `hailOf` as it last stood). None the first time Focus shows the agent (`before` undefined), so a reload
 * doesn't toast everything waiting again, and none for an error, which says itself on the agent.
 */
export function hailNews(before: Attention['kind'] | null | undefined, agent: Agent, reviews: ReadonlyMap<string, QaReview>): string | null {
  const now = agentAttention(agent);
  if (before === undefined || !now || now.kind === before || !TOASTED.has(now.kind)) return null;
  if (now.kind === 'turn') return `🖖 ${agent.name} is waiting for you`;
  const { icon, what } = needLine(now, reviews);
  return `${icon} ${agent.name}: ${what}`;
}

/** A project's agents at work or waiting for a slot, oldest first. The QA officer counts while they're reviewing. */
export function inFlight(projectId: string, agents: Agent[]): Agent[] {
  return agents
    .filter((a) => a.projectId === projectId && (a.status === 'queued' || ACTIVE_STATUSES.includes(a.status)))
    .sort((a, b) => a.startedAt - b.startedAt);
}
