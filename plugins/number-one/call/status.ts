import type { Agent, Attention, Project, Snapshot } from '../../../plugin-api/server';
import { ACTIVE_STATUSES, columns, goalTitle, inFlight, needsYou, prKey, shownProjects } from '../../../plugin-api/shared';

// What the ship says when the captain asks how things stand on a call: plain sentences, no paths or symbols, for the
// voice model to say in its own words. Read straight off the board, so it's exact and instant.

const MAX_AT_WORK = 5;
/** What the ship is given to say is at most 500 tokens: a status longer than this is cut at a sentence. */
export const SPOKEN_LIMIT = 1_800;

const quoted = (text: string) => `"${text}"`;

function atWork(agent: Agent): string {
  if (agent.task === 'review') return `${agent.name} is reviewing a pull request`;
  return `${agent.name} is on ${quoted(agent.issue.title)}`;
}

/** A goal's lead and their goal, and whether they're at it right now (otherwise it's the captain's turn). */
const goal = (lead: Agent) => `${lead.name} on ${quoted(lead.lead?.title ?? lead.issue.title)}${ACTIVE_STATUSES.includes(lead.status) ? ', at work' : ''}`;

function waiting(a: Attention): string {
  switch (a.kind) {
    case 'hand':
      return `${a.agent.name} has a hand up`;
    case 'question':
      return `${a.agent.name} asked you a question`;
    case 'error':
      return `${a.agent.name} hit a problem`;
    case 'wrap-up':
      return `${a.agent.name} thinks their goal is done`;
    case 'turn':
      return `${a.agent.name} is waiting for your reply`;
    case 'qa':
      return `pull request ${a.pr.number}, ${quoted(a.pr.title)}, failed QA and needs you`;
    case 'conflicts':
      return `pull request ${a.pr.number} conflicts with its base branch`;
  }
}

const count = (n: number, one: string, many = `${one}s`) => `${n === 1 ? 'one' : n} ${n === 1 ? one : many}`;
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const listed = (items: string[]) => `${items.slice(0, MAX_AT_WORK).join('; ')}${items.length > MAX_AT_WORK ? `; and ${items.length - MAX_AT_WORK} more` : ''}`;

function projectStatus(snapshot: Snapshot, project: Project): string {
  const agents = snapshot.agents.filter((a) => a.projectId === project.id);
  const leads = agents.filter((a) => a.task === 'lead');
  const working = inFlight(project.id, agents).filter((a) => a.task !== 'lead');
  const board = snapshot.boards.find((b) => b.projectId === project.id);
  const prs = columns(project, board, agents, snapshot.info.github.login).prs.map((pr) => ({ projectId: project.id, pr }));
  const reviews = new Map(snapshot.reviews.map((r) => [prKey(r.repo, r.number), r]));
  const needs = needsYou(agents, prs, reviews);
  const queue = project.goalQueue ?? [];

  const lines = [
    leads.length ? `${project.name} has ${count(leads.length, 'goal')} under way: ${listed(leads.map(goal))}.` : `${project.name} has no goals under way.`,
    working.length ? `${sentence(count(working.length, 'crew member'))} at work on issues: ${listed(working.map(atWork))}.` : '',
    needs.length ? `Waiting on you: ${needs.map(waiting).join('; ')}.` : 'Nothing is waiting on you.',
    queue.length ? `${sentence(count(queue.length, 'goal'))} queued; next is ${quoted(goalTitle(queue[0].text))}.` : 'No goals are queued.',
  ].filter(Boolean);
  return lines.join(' ');
}

/** How things stand: in one project, or in every one aboard (hidden ones left out). */
export function spokenStatus(snapshot: Snapshot, projectId?: string): string {
  const projects = shownProjects(snapshot.projects).filter((p) => !projectId || p.id === projectId);
  if (!projects.length) return 'There are no projects aboard yet.';
  return clip(projects.map((p) => projectStatus(snapshot, p)).join(' '));
}

/** Text cut to `SPOKEN_LIMIT` at the end of a sentence, saying there's more. */
export function clip(text: string, limit = SPOKEN_LIMIT): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const end = cut.lastIndexOf('. ');
  return `${end > 0 ? cut.slice(0, end + 1) : cut} There's more on the screens.`;
}
