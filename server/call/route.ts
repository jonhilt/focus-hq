import { shownProjects } from '../../shared/hidden';
import type { LedgerEvent } from '../../shared/ledger';
import type { CallLine, Project, Snapshot } from '../../shared/types';
import { goalTitle, pickStation } from '../agents/lead';
import { briefing, pieces, type Topic, topics } from './brief';
import type { JevAnswer, JevAnswers, JevQuestion } from './jev';
import { spokenStatus } from './status';

// What a call does with what the captain just said: the questions Jev is asked about it, and what its answers mean.
// Pure, so it's unit tested (route.test.ts); the call's machine (machine.ts) acts on the result.

/** Jev's pick of action, project or topic counts at this confidence or above; below it, the captain wasn't clear. */
export const ROUTE_CONFIDENCE = 0.6;
/** The captain's yes counts at this probability or above. Nothing consequential runs on a maybe. */
export const APPROVE_PROBABILITY = 0.9;
/** Words for a goal or a lead count as called off at this probability or above. */
export const CANCEL_PROBABILITY = 0.6;
/** How many lines of the call so far Jev sees, besides what the captain just said. */
const RECENT_LINES = 6;
/** The most of a call's conversation a new goal or a message carries with it. */
const NOTES_CHARS = 4_000;
/** The topics Jev chooses from. */
const MAX_TOPICS = 40;

/** The next queued goal, as the ship asks to start it. */
export interface StartGoal {
  projectId: string;
  projectName: string;
  queueId: string;
  title: string;
  /** The team station it would get, 0-based. */
  station: number;
}

/** Something consequential the call does, once the captain has said yes to it. */
export type Act =
  | { kind: 'start-queued'; start: StartGoal }
  | { kind: 'new-goal'; projectId: string; projectName: string; title: string; said: string; text: string }
  | { kind: 'tell-lead'; leadId: string; leadName: string; said: string; text: string };

/** What the captain asked to capture, waiting on their words for it. */
export type Capture = { kind: 'new-goal'; projectId: string; projectName: string } | { kind: 'tell-lead'; leadId: string; leadName: string };

/**
 * What the call does next: say something (aloud, or as a quiet note to the voice model), ask the captain's yes to an
 * act, do it, brief the voice model on a topic to talk through, or wait for the captain's words for a capture.
 */
export type Routing =
  | { kind: 'say'; text: string; quiet?: boolean }
  | { kind: 'confirm'; act: Act; ask: string }
  | { kind: 'go' }
  | { kind: 'brief'; topic: Topic; text: string; pieces: string[] }
  | { kind: 'dictate'; capture: Capture; ask: string };

/** Where the call is: what waits on a yes, what's being talked through, what waits on the captain's words. */
export interface CallScene {
  pending?: Act;
  topic?: Topic;
  capture?: Capture;
}

const ACTIONS = {
  status: 'The captain wants to know how things stand: what the crew are doing, goals, pull requests, what is waiting on them',
  start_next_goal: 'The captain wants the next queued goal started',
  talk: 'The captain wants to talk something through or think out loud: a goal, a requirement, an idea, how something on the ship is or is not working',
  capture_goal: 'The captain wants what they have been talking about made into a new goal',
  tell_lead: "The captain wants something passed on to a goal's lead",
  other: 'Anything else: carrying on the conversation, a question the ship cannot act on by voice, or nothing clear',
} as const satisfies Record<string, string>;
type Action = keyof typeof ACTIONS;
const isAction = (v: string | undefined): v is Action => v !== undefined && v in ACTIONS;

const NONE = 'none';

export function askFor(act: Act): string {
  switch (act.kind) {
    case 'start-queued':
      return `Start "${act.start.title}" in ${act.start.projectName}, at station ${act.start.station + 1}?`;
    case 'new-goal':
      return `Start a new goal in ${act.projectName}: "${act.said}"? It takes the notes from this call with it.`;
    case 'tell-lead':
      return `Send ${act.leadName}: "${act.said}"?`;
  }
}

const choiceOf = (instructions: string, options: Record<string, string>): JevQuestion => ({ type: 'choice', instructions, criteria: { ...options, [NONE]: 'None of these, or not clear' } });

/**
 * The questions for what the captain just said. Words for a capture only need to know whether they call it off.
 * Otherwise: the action, the project (with more than one aboard), the topic, and their yes when an act waits on it.
 */
export function routingQuestions(projects: Pick<Project, 'id' | 'name'>[], options: Topic[], scene: CallScene = {}): Record<string, JevQuestion> {
  if (scene.capture)
    return {
      cancel: {
        type: 'noul',
        instructions: 'The ship asked the captain for the words to pass on. Is the captain calling it off rather than saying them?',
        criteria: { true: 'Never mind, forget it, cancel, not now', false: 'They are saying what to put in it' },
      },
    };
  return {
    action: { type: 'choice', instructions: 'What does the captain want, from what they just said?', criteria: { ...ACTIONS } },
    ...(projects.length > 1 && { project: choiceOf('Which project does the captain mean, by name or from the conversation?', Object.fromEntries(projects.map((p) => [p.id, p.name]))) }),
    ...(options.length > 0 && { topic: choiceOf('Which of these is the captain talking about, if any?', Object.fromEntries(options.slice(0, MAX_TOPICS).map((t) => [t.id, t.label]))) }),
    ...(scene.pending && {
      approve: {
        type: 'noul',
        instructions: `The ship asked the captain: ${askFor(scene.pending)} Does what the captain just said clearly approve it?`,
        criteria: {
          true: 'A clear yes to that question: yes, go ahead, do it, make it so, send it',
          false: 'No, wait, not yet, unsure, a different request, or anything that is not a clear yes',
        },
      },
    }),
  };
}

const WHO = { captain: 'Captain', ship: 'Ship', office: 'Office' } as const;

/** What Jev reads: the projects, the topic, what waits on the captain, the call so far, and what the captain just said. */
export function routingState(projects: Pick<Project, 'id' | 'name'>[], heard: string, recent: CallLine[], scene: CallScene = {}): string {
  return [
    `The captain is on a voice call with their starship's first officer, who runs their software projects. Projects aboard: ${projects.map((p) => p.name).join(', ') || 'none'}.`,
    scene.topic ? `They are talking through: ${scene.topic.label}.` : '',
    scene.pending ? `The ship is waiting for the captain's answer to: ${askFor(scene.pending)}` : '',
    recent.length ? `The call so far:\n${recent.slice(-RECENT_LINES).map((l) => `${WHO[l.who]}: ${l.text}`).join('\n')}` : '',
    `What the captain just said: "${heard}"`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The conversation so far, as notes a new goal or a message carries: what the captain and the ship said, the latest kept. */
export function callNotes(lines: CallLine[]): string {
  const said = lines.filter((l) => l.who !== 'office').map((l) => `${WHO[l.who]}: ${l.text}`);
  let notes = said.join('\n');
  while (notes.length > NOTES_CHARS && said.length > 1) notes = (said.shift(), said.join('\n'));
  return notes;
}

const confident = (answer: JevAnswer | undefined, min: number): string | undefined =>
  answer?.choice !== undefined && answer.choice !== NONE && (answer.confidence ?? answer.probabilities?.[answer.choice] ?? 0) >= min ? answer.choice : undefined;

/** The project the captain means: the only one aboard, Jev's confident pick, or the topic's. */
function projectMeant(projects: Project[], answers: JevAnswers, topic?: Topic): Project | undefined {
  if (projects.length === 1) return projects[0];
  const id = confident(answers.project, ROUTE_CONFIDENCE) ?? topic?.projectId;
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
  const act: Act = { kind: 'start-queued', start: { projectId: project.id, projectName: project.name, queueId: next.id, title, station } };
  return { kind: 'confirm', act, ask: askFor(act) };
}

/** Talking something through: the voice model is briefed on the topic the captain named, or asks which. */
export function talkAbout(snapshot: Snapshot, ledger: LedgerEvent[], answers: JevAnswers, now: number): Routing {
  const options = topics(snapshot);
  const topic = options.find((t) => t.id === confident(answers.topic, ROUTE_CONFIDENCE));
  if (!topic) {
    const goals = options.filter((t) => t.kind === 'goal').map((t) => `"${t.title}"`);
    return { kind: 'say', text: `What would you like to talk through? ${goals.length ? `Goals under way: ${goals.join(', ')}. ` : ''}Or a project as a whole.` };
  }
  const text = briefing(snapshot, ledger, topic, now);
  return { kind: 'brief', topic, text, pieces: pieces(text) };
}

/** Making the conversation a goal: in the project named, the topic's, or the only one; the captain says what it is next. */
function captureGoal(snapshot: Snapshot, answers: JevAnswers, topic?: Topic): Routing {
  const project = projectMeant(shownProjects(snapshot.projects), answers, topic);
  if (!project) return { kind: 'say', text: 'Which project should the goal go in?' };
  return { kind: 'dictate', capture: { kind: 'new-goal', projectId: project.id, projectName: project.name }, ask: 'What should the goal be? A sentence or two will do.' };
}

/** Passing something on to a goal's lead: the one named, or the lead of the goal being talked through. */
function captureForLead(snapshot: Snapshot, answers: JevAnswers, topic?: Topic): Routing {
  const named = topics(snapshot).find((t) => t.id === confident(answers.topic, ROUTE_CONFIDENCE));
  const goal = named?.kind === 'goal' ? named : topic?.kind === 'goal' ? topic : undefined;
  const lead = goal && snapshot.agents.find((a) => a.id === goal.leadId);
  if (!goal || !lead) return { kind: 'say', text: 'Which goal’s lead should I pass it to?' };
  return { kind: 'dictate', capture: { kind: 'tell-lead', leadId: lead.id, leadName: lead.name }, ask: `What should I tell ${lead.name}?` };
}

/** What the captain said, as far as its first sentence, for reading back. */
const firstSentence = (words: string) => (/^[^.!?\n]{1,160}[.!?]?/.exec(words.trim())?.[0] ?? words).replace(/[.!?]$/, '');

/** The captain's words for a capture, as the act the ship reads back; or dropped, when they called it off. */
export function dictated(capture: Capture, words: string, answers: JevAnswers, notes: string, topic?: Topic): Routing {
  if ((answers.cancel?.noul ?? 0) >= CANCEL_PROBABILITY || !words) return { kind: 'say', text: 'Okay, dropped it.' };
  const about = topic ? ` about ${topic.title}` : '';
  const act: Act =
    capture.kind === 'new-goal'
      ? { kind: 'new-goal', projectId: capture.projectId, projectName: capture.projectName, title: goalTitle(words), said: firstSentence(words), text: `${words}\n\nFrom a call with the captain${about}:\n${notes}` }
      : { kind: 'tell-lead', leadId: capture.leadId, leadName: capture.leadName, said: words, text: `${words}\n\n(Said on a call with the captain${about}. The conversation:\n${notes})` };
  return { kind: 'confirm', act, ask: askFor(act) };
}

/** What the call needs, besides Jev's answers, to decide. */
export interface Deciding {
  snapshot: Snapshot;
  ledger: LedgerEvent[];
  now: number;
  scene: CallScene;
}

function act(d: Deciding, action: Action, answers: JevAnswers): Routing {
  const projects = shownProjects(d.snapshot.projects);
  const { topic } = d.scene;
  switch (action) {
    case 'status':
      return { kind: 'say', text: spokenStatus(d.snapshot, projectMeant(projects, answers)?.id) };
    case 'start_next_goal':
      return nextGoal(d.snapshot, projectMeant(projects, answers));
    case 'talk':
      return talkAbout(d.snapshot, d.ledger, answers, d.now);
    case 'capture_goal':
      return captureGoal(d.snapshot, answers, topic);
    case 'tell_lead':
      return captureForLead(d.snapshot, answers, topic);
    case 'other':
      return topic
        ? { kind: 'say', text: 'Nothing for the office to do there: carry on talking it through from the briefing.', quiet: true }
        : { kind: 'say', text: 'By voice I can tell you how things stand, start the next queued goal, or talk something through with you.' };
  }
}

/**
 * What Jev's answers mean. An act waiting on the captain goes ahead only on a clear yes; anything else drops it, and
 * what they said instead is answered as if nothing waited.
 */
export function decide(d: Deciding, answers: JevAnswers): Routing {
  const { pending } = d.scene;
  if (pending && (answers.approve?.noul ?? 0) >= APPROVE_PROBABILITY) return { kind: 'go' };
  const choice = confident(answers.action, ROUTE_CONFIDENCE);
  const routing = act(d, isAction(choice) ? choice : 'other', answers);
  if (!pending) return routing;
  const dropped = pending.kind === 'start-queued' ? `Okay, I've left "${pending.start.title}" queued.` : "Okay, I haven't done that.";
  return routing.kind === 'say' ? { kind: 'say', text: routing.quiet ? dropped : `${dropped} ${routing.text}` } : routing;
}
