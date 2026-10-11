import { columns } from '../../shared/board';
import { shownProjects } from '../../shared/hidden';
import { type Attention, inFlight, needsYou } from '../../shared/tricorder';
import type { Agent, Project, Snapshot } from '../../shared/types';
import { prKey } from '../../shared/qa';
import { goalTitle } from '../agents/lead';

// What the ship says when the captain asks how things stand on a call: plain sentences, no paths or symbols, for the
// voice model to say in its own words. Read straight off the board, so it's exact and instant.

const MAX_AT_WORK = 5;

const quoted = (text: string) => `"${text}"`;

function atWork(agent: Agent): string {
  if (agent.task === 'lead') return `${agent.name} is leading the goal ${quoted(agent.lead?.title ?? agent.issue.title)}`;
  if (agent.task === 'review') return `${agent.name} is reviewing a pull request`;
  return `${agent.name} is on ${quoted(agent.issue.title)}`;
}

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

function projectStatus(snapshot: Snapshot, project: Project): string {
  const agents = snapshot.agents.filter((a) => a.projectId === project.id);
  const working = inFlight(project.id, agents);
  const board = snapshot.boards.find((b) => b.projectId === project.id);
  const prs = columns(project, board, agents, snapshot.info.github.login).prs.map((pr) => ({ projectId: project.id, pr }));
  const reviews = new Map(snapshot.reviews.map((r) => [prKey(r.repo, r.number), r]));
  const needs = needsYou(agents, prs, reviews);
  const queue = project.goalQueue ?? [];

  const lines = [
    working.length
      ? `${project.name}: ${count(working.length, 'crew member')} at work. ${working.slice(0, MAX_AT_WORK).map(atWork).join('. ')}${working.length > MAX_AT_WORK ? `, and ${working.length - MAX_AT_WORK} more` : ''}.`
      : `${project.name}: nobody's at work.`,
    needs.length ? `Waiting on you: ${needs.map(waiting).join('; ')}.` : 'Nothing is waiting on you.',
    queue.length ? `${count(queue.length, 'goal')} queued; next is ${quoted(goalTitle(queue[0].text))}.` : 'No goals are queued.',
  ];
  return lines.join(' ');
}

/** How things stand: in one project, or in every one aboard (hidden ones left out). */
export function spokenStatus(snapshot: Snapshot, projectId?: string): string {
  const projects = shownProjects(snapshot.projects).filter((p) => !projectId || p.id === projectId);
  if (!projects.length) return 'There are no projects aboard yet.';
  return projects.map((p) => projectStatus(snapshot, p)).join(' ');
}
