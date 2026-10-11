import { shownProjects } from '../../shared/hidden';
import type { CallLine, Project, Snapshot } from '../../shared/types';
import { goalTitle, pickStation } from '../agents/lead';
import type { JevAnswer, JevAnswers, JevQuestion } from './jev';
import { spokenStatus } from './status';

// What a call does with what the captain just said: the questions Jev is asked about it, and what its answers mean.
// Pure, so it's unit tested (route.test.ts); the call's machine (machine.ts) acts on the result.

/** Jev's pick of action, and of project, counts at this confidence or above; below it, the captain wasn't clear. */
export const ROUTE_CONFIDENCE = 0.6;
/** The captain's yes counts at this probability or above. Nothing consequential runs on a maybe. */
export const APPROVE_PROBABILITY = 0.9;
/** How many lines of the call so far Jev sees, besides what the captain just said. */
const RECENT_LINES = 6;

/** The next queued goal, as the ship asks to start it. */
export interface StartGoal {
  projectId: string;
  projectName: string;
  queueId: string;
  title: string;
  /** The team station it would get, 0-based. */
  station: number;
}

/** What the call does next: say something and listen on, ask the captain's yes to start a goal, or start it. */
export type Routing = { kind: 'say'; text: string } | { kind: 'confirm'; start: StartGoal; ask: string } | { kind: 'go' };

const ACTIONS = {
  status: 'The captain wants to know how things stand: what the crew are doing, goals, pull requests, what is waiting on them',
  start_next_goal: 'The captain wants the next queued goal started',
  other: 'Anything else: chat, a question the ship cannot act on by voice yet, or nothing clear',
} as const satisfies Record<string, string>;
type Action = keyof typeof ACTIONS;
const isAction = (v: string | undefined): v is Action => v !== undefined && v in ACTIONS;

const NO_PROJECT = 'none';

/** What the ship asks before starting a goal: the one question the captain's yes answers. */
export const askToStart = (start: StartGoal) => `Start "${start.title}" in ${start.projectName}, at station ${start.station + 1}?`;

/** The questions for what the captain just said: always the action (and the project, with more than one aboard); their yes too when a start waits on it. */
export function routingQuestions(projects: Pick<Project, 'id' | 'name'>[], pending?: StartGoal): Record<string, JevQuestion> {
  return {
    action: { type: 'choice', instructions: 'What does the captain want, from what they just said?', criteria: { ...ACTIONS } },
    ...(projects.length > 1 && {
      project: {
        type: 'choice',
        instructions: 'Which project does the captain mean, by name or from the conversation?',
        criteria: { ...Object.fromEntries(projects.map((p) => [p.id, p.name])), [NO_PROJECT]: 'No project named or clearly implied' },
      },
    }),
    ...(pending && {
      approve: {
        type: 'noul',
        instructions: `The ship asked the captain: ${askToStart(pending)} Does what the captain just said clearly approve it?`,
        criteria: {
          true: 'A clear yes to that question: yes, go ahead, do it, make it so',
          false: 'No, wait, not yet, unsure, a different request, or anything that is not a clear yes',
        },
      },
    }),
  };
}

/** What Jev reads: the projects, what waits on the captain's yes, the call so far, and what the captain just said. */
export function routingState(projects: Pick<Project, 'id' | 'name'>[], heard: string, recent: CallLine[], pending?: StartGoal): string {
  const who = { captain: 'Captain', ship: 'Ship', office: 'Office' } as const;
  return [
    `The captain is on a voice call with their starship's first officer, who runs their software projects. Projects aboard: ${projects.map((p) => p.name).join(', ') || 'none'}.`,
    pending ? `The ship is waiting for the captain's answer to: ${askToStart(pending)}` : '',
    recent.length ? `The call so far:\n${recent.slice(-RECENT_LINES).map((l) => `${who[l.who]}: ${l.text}`).join('\n')}` : '',
    `What the captain just said: "${heard}"`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const confident = (answer: JevAnswer | undefined, min: number): string | undefined =>
  answer?.choice !== undefined && (answer.confidence ?? answer.probabilities?.[answer.choice] ?? 0) >= min ? answer.choice : undefined;

/** The project the captain means: the only one aboard, or Jev's confident pick. */
function projectMeant(projects: Project[], answers: JevAnswers): Project | undefined {
  if (projects.length === 1) return projects[0];
  const id = confident(answers.project, ROUTE_CONFIDENCE);
  return projects.find((p) => p.id === id);
}

/** Starting the next queued goal: which, and where; or why not, said aloud. */
export function nextGoal(snapshot: Snapshot, project: Project | undefined): Routing {
  const projects = shownProjects(snapshot.projects);
  if (!project) {
    const queued = projects.filter((p) => p.goalQueue?.length);
    if (!queued.length) return { kind: 'say', text: 'There are no goals queued in any project.' };
    if (queued.length > 1) return { kind: 'say', text: `Goals are queued in ${queued.map((p) => p.name).join(' and ')}. Which project?` };
    project = queued[0];
  }
  const next = project.goalQueue?.[0];
  if (!next) return { kind: 'say', text: `There are no goals queued in ${project.name}.` };
  const title = goalTitle(next.text);
  const taken = snapshot.agents.filter((a) => a.projectId === project.id && a.task === 'lead').map((a) => a.lead?.station ?? 0);
  const station = pickStation(taken);
  if (station === undefined) return { kind: 'say', text: `Every team station in ${project.name} has a goal, so "${title}" has to wait for one to close.` };
  const start = { projectId: project.id, projectName: project.name, queueId: next.id, title, station };
  return { kind: 'confirm', start, ask: askToStart(start) };
}

/**
 * What Jev's answers mean. A start waiting on the captain goes ahead only on a clear yes; anything else leaves it queued,
 * and what they said instead is answered as if nothing waited.
 */
export function decide(snapshot: Snapshot, answers: JevAnswers, pending?: StartGoal): Routing {
  if (pending && (answers.approve?.noul ?? 0) >= APPROVE_PROBABILITY) return { kind: 'go' };
  const projects = shownProjects(snapshot.projects);
  const choice = confident(answers.action, ROUTE_CONFIDENCE);
  const action: Action = isAction(choice) ? choice : 'other';
  const dropped = pending ? `Okay, I've left "${pending.title}" queued.` : '';
  const routing: Routing =
    action === 'status'
      ? { kind: 'say', text: spokenStatus(snapshot, projectMeant(projects, answers)?.id) }
      : action === 'start_next_goal'
        ? nextGoal(snapshot, projectMeant(projects, answers))
        : { kind: 'say', text: pending ? '' : 'By voice I can tell you how things stand and start the next queued goal, nothing else yet.' };
  if (!dropped) return routing;
  return routing.kind === 'say' ? { kind: 'say', text: `${dropped} ${routing.text}`.trim() } : routing;
}
