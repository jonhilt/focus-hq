import type { Agent, Effort, GoalArtifact, GoalQuestion, GoalRecord, LeadAgent, LeadWork, QaReport, QueuedGoal } from '../../shared/types';
import { TEAM_STATIONS } from '../../shared/types';
import type { BranchState } from './types';

// A goal lead's decisions: the station a goal gets, whether a queued goal can start, whether Ops compacts the lead's
// conversation first, what showing a page or asking (or answering) a question does to the goal, what closing a goal
// would leave behind and whether a closed one reopens, which reviews start, and what the captain hears of QA's verdict.
// Pure, so it's unit tested (leadRules.test.ts); manager/leads.ts, goalTools.ts, sessions.ts and reviews.ts act on it.

/**
 * The team station a new goal gets: `wanted` if it's free, otherwise the first free one. Undefined when `wanted` is taken
 * or out of range, or when every station is.
 */
export function pickStation(taken: number[], wanted?: number): number | undefined {
  const free = (s: number) => s >= 0 && s < TEAM_STATIONS && !taken.includes(s);
  if (wanted !== undefined) return Number.isInteger(wanted) && free(wanted) ? wanted : undefined;
  for (let s = 0; s < TEAM_STATIONS; s++) if (free(s)) return s;
  return undefined;
}

/** Whether the agent carries a goal's lead work, as every lead does from the moment it's made. */
export const hasLeadWork = (agent: Agent): agent is LeadAgent => agent.lead !== undefined;

/**
 * Whether Ops compacts a lead's conversation before their next turn: when the turn picks a conversation here
 * back up and it held `at` tokens or more at the end of the last one (0 = never), unless compacting it already failed.
 * Every call in a turn reads the whole conversation again, so a big one costs on every step, not just once.
 */
export function compactsFirst(lead: Pick<Agent, 'sessionId' | 'cloud' | 'context'>, resuming: boolean, at: number, failedIn?: string): boolean {
  return at > 0 && resuming && !lead.cloud && !!lead.sessionId && lead.sessionId !== failedIn && (lead.context?.tokens ?? 0) >= at;
}

export const ARTIFACT_LIMITS = { id: 40, title: 80, count: 12, bytes: 2_000_000 } as const;

export interface ArtifactInput {
  id: string;
  title: string;
  html: string;
}

/**
 * The goal's artifacts once the lead shows one: a new id joins the end, a known one is replaced where it stands. Or why
 * it was refused (nothing changes then).
 */
export function showArtifact(artifacts: readonly GoalArtifact[], input: ArtifactInput, at: number): GoalArtifact[] | { error: string } {
  const L = ARTIFACT_LIMITS;
  const title = input.title.replace(/\s+/g, ' ').trim();
  if (!new RegExp(`^[a-z0-9][a-z0-9-]{0,${L.id - 1}}$`).test(input.id)) return { error: `The id must be lowercase letters, digits and dashes, at most ${L.id} characters (like "data-flow")` };
  if (!title) return { error: 'Give it a title' };
  if (title.length > L.title) return { error: `The title is ${title.length} characters (at most ${L.title})` };
  if (!input.html.trim()) return { error: 'The page is empty' };
  if (Buffer.byteLength(input.html) > L.bytes) return { error: `The page is over ${L.bytes / 1_000_000} MB: keep it self-contained but small` };
  const shown = { id: input.id, title, at };
  if (artifacts.some((a) => a.id === input.id)) return artifacts.map((a) => (a.id === input.id ? shown : a));
  if (artifacts.length >= L.count) return { error: `The screen already has ${L.count} artifacts: show a new version under an existing id instead` };
  return [...artifacts, shown];
}

export const QUESTION_LIMITS = { question: 300, context: 600, label: 60, detail: 500, minOptions: 2, maxOptions: 4, kept: 12, note: 1000 } as const;

export interface QuestionInput {
  question: string;
  /** Why it's being asked, and what matters in choosing. */
  context?: string;
  /** `detail`: what the option means and what it trades off, beside its page. */
  options: { label: string; html: string; detail?: string }[];
}

/**
 * The goal's questions once the lead asks one: it goes on the end as q1, q2, …, with options a, b, c, d. A question
 * still open is dropped (the new one replaces it), and so are the oldest once there are more than a few: `dropped` says
 * which, for their pages to go too. Or why it was refused (nothing changes then).
 */
export function askQuestion(questions: readonly GoalQuestion[], input: QuestionInput, at: number): { questions: GoalQuestion[]; asked: GoalQuestion; dropped: GoalQuestion[] } | { error: string } {
  const L = QUESTION_LIMITS;
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
  const question = clean(input.question);
  if (!question) return { error: 'Ask a question' };
  if (question.length > L.question) return { error: `The question is ${question.length} characters (at most ${L.question}): put the background in context` };
  const context = input.context?.trim();
  if (context && context.length > L.context) return { error: `The context is ${context.length} characters (at most ${L.context})` };
  if (input.options.length < L.minOptions || input.options.length > L.maxOptions) return { error: `Give ${L.minOptions} to ${L.maxOptions} options (you gave ${input.options.length})` };
  for (const [i, o] of input.options.entries()) {
    const label = clean(o.label);
    if (!label) return { error: `Option ${i + 1} needs a label` };
    if (label.length > L.label) return { error: `Option ${i + 1}'s label is ${label.length} characters (at most ${L.label})` };
    if (o.detail && o.detail.trim().length > L.detail) return { error: `Option ${i + 1}'s detail is ${o.detail.trim().length} characters (at most ${L.detail})` };
    if (!o.html.trim()) return { error: `Option ${i + 1}'s page is empty` };
    if (Buffer.byteLength(o.html) > ARTIFACT_LIMITS.bytes) return { error: `Option ${i + 1}'s page is over ${ARTIFACT_LIMITS.bytes / 1_000_000} MB` };
  }
  const n = Math.max(0, ...questions.map((q) => Number(q.id.slice(1)) || 0)) + 1;
  const asked: GoalQuestion = {
    id: `q${n}`,
    question,
    ...(context ? { context } : {}),
    options: input.options.map((o, i) => ({ id: 'abcd'[i], label: clean(o.label), ...(o.detail?.trim() ? { detail: o.detail.trim() } : {}) })),
    at,
  };
  const kept = questions.filter((q) => q.answer);
  const over = Math.max(0, kept.length + 1 - L.kept);
  return { questions: [...kept.slice(over), asked], asked, dropped: [...questions.filter((q) => !q.answer), ...kept.slice(0, over)] };
}

/** The goal's questions once the captain picks an option of an open one, or why it can't be picked. */
export function answerQuestion(questions: readonly GoalQuestion[], questionId: string, option: string, note: string | undefined, at: number): { questions: GoalQuestion[]; question: GoalQuestion } | { error: string } {
  const question = questions.find((q) => q.id === questionId);
  if (!question) return { error: 'That question isn’t there any more: the lead may have asked another' };
  if (question.answer) return { error: question.answer.option ? `You already picked ${question.answer.option.toUpperCase()}` : 'You already answered it in chat' };
  if (!question.options.some((o) => o.id === option)) return { error: `There’s no option ${option}` };
  const said = note?.trim();
  if (said && said.length > QUESTION_LIMITS.note) return { error: `Keep the note under ${QUESTION_LIMITS.note} characters` };
  return { questions: questions.map((q) => (q.id === questionId ? { ...q, answer: { option, ...(said ? { note: said } : {}), at } } : q)), question };
}

/**
 * A repo of a goal's workspace as the goal closes: whether it has uncommitted changes (or git couldn't tell), and how its
 * branch stands with GitHub (missing when git couldn't tell).
 */
export interface RepoAtClose {
  folder: string;
  dirty: boolean;
  branch?: BranchState;
  /** The branch it's on, when it isn't the goal's. */
  on?: string;
}

/**
 * What closing the goal would leave behind, for the captain to confirm first. Nothing is thrown away (uncommitted
 * changes are committed as a WIP snapshot on the branch), but commits GitHub hasn't got stay only in the clone Ops keeps.
 */
export function closeCheck(work: Pick<LeadWork, 'prs' | 'slice'>, branch: string, repos: RepoAtClose[]): { kind: 'ok' } | { kind: 'warn'; reasons: string[] } {
  const reasons: string[] = [];
  const list = (folders: string[]) => folders.map((f) => `./${f}`).join(' and ');
  const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;
  const dirty = repos.filter((r) => r.dirty).map((r) => r.folder);
  if (dirty.length) reasons.push(`Uncommitted changes in ${list(dirty)} are committed as a WIP snapshot on \`${branch}\`, kept only in the clone Ops keeps.`);
  for (const r of repos) {
    if (!r.branch) reasons.push(`Couldn’t tell whether ./${r.folder}’s commits reached GitHub.`);
    else if (!r.branch.onOrigin && r.branch.unpushed) reasons.push(`./${r.folder}’s branch \`${r.on ?? branch}\` never reached GitHub: its ${commits(r.branch.unpushed)} stay only in the clone Ops keeps.`);
    else if (r.branch.unpushed) reasons.push(`./${r.folder} has ${commits(r.branch.unpushed)} that never reached GitHub, kept only in the clone Ops keeps.`);
  }
  if (work.slice <= 1 && !work.prs.length) reasons.push('The goal never shipped anything: no pull request was opened for it.');
  const open = work.prs.filter((p) => !p.outcome);
  if (open.length) reasons.push(`${open.map((p) => `${p.repo}#${p.number}`).join(' and ')} ${open.length === 1 ? 'stays' : 'stay'} open on GitHub, with no lead to fix ${open.length === 1 ? 'it' : 'them'}.`);
  return reasons.length ? { kind: 'warn', reasons } : { kind: 'ok' };
}

/** A closed goal that kept its branch and the repos it was checked out from. */
export type ReopenableGoal = GoalRecord & { branch: string; repos: [LeadWork['repos'][number], ...LeadWork['repos']] };

/** Whether a closed goal can be reopened: it kept its branch and repos (goals closed before they were kept didn't). */
export const reopenable = (goal: GoalRecord): goal is ReopenableGoal => !!goal.branch && !!goal.repos?.length;

/** What starting a queued goal comes to: the station, words and effort it starts with, or why it can't start. */
export type QueuedStart =
  | { kind: 'start'; station: number; text: string; effort?: Effort; from?: string; shaping?: boolean }
  | { kind: 'refused'; message: string };

/**
 * Starting goal `id` from the queue, with the captain's last edits to it: the station they started it from if it's still
 * free, else the first free one; their words, effort and whether to shape it first, else the ones it was queued with. `taken` holds the stations
 * with a goal, and `room` names the project.
 */
export function queuedStart(queue: QueuedGoal[] | undefined, id: string, taken: number[], edits: { text?: string; effort?: Effort; station?: number; shaping?: boolean }, room: string): QueuedStart {
  const queued = queue?.find((g) => g.id === id);
  if (!queued) return { kind: 'refused', message: 'That goal is no longer in line' };
  const station = (edits.station === undefined ? undefined : pickStation(taken, edits.station)) ?? pickStation(taken);
  if (station === undefined) return { kind: 'refused', message: `Every team station in ${room} still has a goal` };
  const shaping = edits.shaping ?? !!queued.shaping;
  return { kind: 'start', station, text: edits.text?.trim() || queued.text, effort: edits.effort ?? queued.effort, from: queued.from, ...(shaping && { shaping }) };
}

/**
 * The reviews that can start now, oldest first: each reviewer (`reviewerOf`) takes at most one, and only when they
 * aren't already busy with another. Goals' reviewers and the room's QA officer work side by side.
 */
export function reviewsToStart<R extends { requestedAt: number }>(queued: R[], reviewerOf: (review: R) => string, busy: (reviewer: string) => boolean): { review: R; reviewer: string }[] {
  const taken = new Set<string>();
  const start: { review: R; reviewer: string }[] = [];
  for (const review of [...queued].sort((a, b) => a.requestedAt - b.requestedAt)) {
    const reviewer = reviewerOf(review);
    if (taken.has(reviewer) || busy(reviewer)) continue;
    taken.add(reviewer);
    start.push({ review, reviewer });
  }
  return start;
}

/** Where a goal's lead stands once QA's fail is noted for them, for the captain's toast (`verdictToast`): `fixing`, a developer of Ops' has it. */
export type VerdictStands = 'idle' | 'working' | 'woken' | 'fixing';

/**
 * Where a goal's lead stands once QA's verdict is noted for them: `woken` when someone's message (a plugin's) has them
 * hear it, or will (it went into their live session with the note: `heard`; it waits in their inbox for a turn: `queued`;
 * or it's held for your plan's usage limit, picked up as that resets: `held`), or when it picked them up out of an idle
 * spell (`wasIdle`, no longer `finished`); otherwise `idle`, waiting on the captain, or `working`, in a turn without it.
 */
export function verdictStands(s: { wasIdle: boolean; finished: boolean; heard: boolean; queued: boolean; held: boolean }): VerdictStands {
  if (s.heard || s.queued || s.held) return 'woken';
  if (!s.wasIdle) return 'working';
  return s.finished ? 'idle' : 'woken';
}

/**
 * The captain's toast for QA failing one of a goal's pull requests, by where its lead stands now that it's noted
 * (`verdictStands`): `idle`, waiting on the captain; `working`, in a turn, hearing it with their next message (and if
 * the turn ends without it, `idle` then); `fixing`, sent to a developer instead, whose own toast says so; `woken`, which says nothing more. None for a pass, or a verdict they've
 * shipped past (QA's on their latest commit already).
 */
export function verdictToast(v: { repo: string; number: number; verdict: QaReport['verdict']; failedRounds: number; behind: boolean }, lead: string, stands: VerdictStands): { level: 'error' | 'info'; text: string } | undefined {
  if (v.verdict !== 'fail' || v.behind || stands === 'woken' || stands === 'fixing') return undefined;
  const failed = `QA failed ${v.repo.split('/')[1]}#${v.number}${v.failedRounds > 1 ? ` ${v.failedRounds} times` : ''}`;
  return stands === 'idle' ? { level: 'error', text: `🙋 ${failed}: ${lead} waits on you` } : { level: 'info', text: `🔧 ${failed}: ${lead} hears it with their next message` };
}
