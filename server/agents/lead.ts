import type { Agent, Effort, GoalNote, GoalRecord, Helper, LeadPr, LeadWork, QaReport, QaReview, QueuedGoal, Settings } from '../../shared/types';
import { TEAM_STATIONS } from '../../shared/types';
import type { HelperEvent } from './types';
import { slugify } from '../util';

/** The lead's checkout of one repo: a folder inside their workspace. */
export const leadWorktreeId = (agentId: string, folder: string) => `${agentId}/${folder}`;

/**
 * A fresh branch for each slice, named after the goal, so a new slice never collides with an earlier one still on GitHub,
 * nor with another goal's.
 */
export function sliceBranch(goalTitle: string, slice: number, suffix: string): string {
  const slug = slugify(goalTitle, 60);
  // about 24 characters, cut between words
  const short = slug.length <= 24 ? slug : slug.slice(0, slug.lastIndexOf('-', 24) > 8 ? slug.lastIndexOf('-', 24) : 24);
  return `focus/${short || 'goal'}-${slice}-${suffix}`;
}

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

/** A goal's title from the captain's first words: their first line, cut at a word to about 60 characters. */
export function goalTitle(text: string): string {
  const line = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  const plain = line.replace(/[.!?:;,]+$/, '');
  if (plain.length <= 60) return plain || 'A new goal';
  const cut = plain.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60).replace(/[\s.,;:]+$/, '')}…`;
}

/** The effort a new goal's lead works at: what the captain picked, else the office's default for leads. */
export const goalEffort = (picked: Effort | undefined, settings: Pick<Settings, 'leadEffort'>): Effort => picked ?? settings.leadEffort;

/**
 * A lead saved before goals: the project's one lead becomes the goal at the first team station, keeping its session,
 * slices and pull requests. Anyone else, and a lead that already has a station, comes back as it was.
 */
export function upgradeLead(agent: Agent, projectName: string): Agent {
  if (agent.task !== 'lead' || !agent.lead || typeof agent.lead.station === 'number') return agent;
  const title = `${projectName}’s first goal`;
  return { ...agent, issue: { ...agent.issue, title }, lead: { ...agent.lead, station: 0, title } };
}

/** Whether the slice has landed: it shipped, and every pull request it opened has merged or closed. */
export const sliceLanded = (prs: LeadPr[]): boolean => prs.length > 0 && prs.every((p) => p.outcome);

/** The lead's open pull request in a repo, if the slice has one. */
export const openPr = (work: LeadWork, repo: string): LeadPr | undefined => work.prs.find((p) => p.repo === repo && !p.outcome);

/**
 * One repo of the lead's workspace when they ask to ship: uncommitted changes, commits not on its base branch, and
 * whether its commit has moved on since it last shipped.
 */
export interface RepoState {
  repo: string;
  folder: string;
  dirty: boolean;
  ahead: number;
  changed: boolean;
}

/** What shipping would do: nothing until every repo's work is committed, then push each repo with new commits. */
export type ShipPlan = { kind: 'commit-first'; folders: string[] } | { kind: 'nothing' } | { kind: 'ship'; repos: string[] };

export function shipPlan(repos: RepoState[]): ShipPlan {
  const dirty = repos.filter((r) => r.dirty).map((r) => r.folder);
  if (dirty.length) return { kind: 'commit-first', folders: dirty };
  const ready = repos.filter((r) => r.ahead > 0 && r.changed).map((r) => r.repo);
  return ready.length ? { kind: 'ship', repos: ready } : { kind: 'nothing' };
}

/** What the lead hears back from the ship tool when it couldn't ship. */
export function notShipped(plan: Exclude<ShipPlan, { kind: 'ship' }>): string {
  return plan.kind === 'commit-first'
    ? `Nothing shipped: ${plan.folders.map((f) => `./${f}`).join(' and ')} ${plan.folders.length === 1 ? 'has' : 'have'} uncommitted changes. Commit them (or drop them) and ship again.`
    : 'Nothing shipped: no repo has new commits since it last shipped.';
}

/** A slice's pull request description: the lead's summary, and the repos shipping alongside it. */
export function leadPrBody(summary: string, lead: Pick<Agent, 'name'>, alongside: string[], attribution: boolean): string {
  const also = alongside.length ? `\n\nShipped alongside the same slice in ${alongside.join(' and ')}.` : '';
  const body = `${summary.trim() || 'A slice of work from one of the project’s leads.'}${also}`;
  return attribution ? `${body}\n\n---\n_Built by **${lead.name}**, a lead in the Focus office, with Claude Code._` : body;
}

/** Where the lead's repos are and which branch each is on, for their first message and a new slice. */
export function workspaceList(work: LeadWork, branch: string): string {
  return work.repos.map((r) => `- ./${r.folder}: ${r.repo}, on branch \`${branch}\` from \`${r.baseBranch}\``).join('\n');
}

/**
 * The lead's instructions: who they are and how they work. They stay the same for the whole goal, because Claude Code
 * keeps a session's first system prompt on every resume; where the repos are and which branch they're on (which change
 * from slice to slice) come in messages instead (`workspaceNote`, `newSliceNote`).
 */
export function leadSystemAppend(agent: Pick<Agent, 'name'>, projectName: string, station: number): string {
  return `
# You are ${agent.name}, a lead on ${projectName} aboard the Focus

You're the captain's own Claude Code session for one goal of ${projectName}, at team station ${station + 1} in its room. They talk to you the way they'd talk to Claude Code, and you build what they're after with them, a slice at a time. Building software is learning: ship something small and real, see what it teaches you, and revise and refactor as you go. The captain controls the ideas; you do the work and keep them in the loop.

Your workspace holds every repo of the project side by side, each in its own folder. Which folders, and the branch they're on, come in your first message and again at each new slice. Other leads may be working on other goals in the same repos at the same time, each on their own branches: keep your slices small so they merge cleanly.

How to work:
- When a goal is new, talk it through briefly: what they want, why, and what done looks like. Don't write a spec or plan the whole route. Agree the first slice and get going.
- Keep the goal's note with mcp__office__note. It survives when your conversation gets summarised, and the captain sees it, so keep it current and short: it's a note, not a spec. In it: what done looks like (once you've agreed it), this slice's checklist when the slice has more than a couple of parts (tick items off as you go), a line or two on what each slice taught you once it lands, and up to three ideas for what's next. You can also give the goal a better title. When a slice lands the office clears its checklist: carry what's unfinished into the next one, or say in learned that you dropped it.
- A slice is a reasonably sized change that ships on its own and gets something real working: often a thin slice end to end, through every repo it needs. A slice can also be a refactor, once the code has learned something. Keep each pull request reviewable.
- Before changing a repo, read its CLAUDE.md or README. Run its tests, type checks and linters, and check UI changes in the browser with the mcp__browser__ tools.
- Commit in each repo as you go. Never push and never open pull requests yourself.
- When a slice is ready, call mcp__office__ship with a title and a summary. The office pushes every repo with new commits and opens (or updates) a pull request in each, and QA reviews them. Then tell the captain what's in the slice, what it taught you, and what you'd do next, and stop there: they review it and decide.
- Shipping again before the pull requests merge updates them: that's how you fix what QA or the captain finds.
- You'll hear QA's verdict on each pull request, and when the slice's pull requests have all merged or closed. After that your repos move to fresh code on a new branch for the next slice.
- For independent pieces of work that can run side by side, you can hand them to subagents with the Agent tool. You own what they bring back. Hand broad exploration (reading through a repo, long test runs, combing through logs) to subagents too, and keep their conclusions rather than the details: your context has to last the whole goal.
- When a decision is the captain's (scope, a trade-off they'd care about), ask and stop. Otherwise make sensible calls and say what you decided.
- When what done looks like is met, or a slice has landed and nothing worthwhile is left, call mcp__office__propose_close with why, tell the captain, and stop. They close the goal, or carry on with you.
`.trim();
}

/**
 * What happens when a slice has landed and the lead takes their next turn: nothing moves while a repo has uncommitted
 * changes; otherwise the conversation is compacted first (when there's one to compact), then the repos move to fresh
 * code for the next slice.
 */
export const afterLanding = (dirtyFolders: string[], hasSession: boolean): 'held-back' | 'compact-then-next' | 'next' =>
  dirtyFolders.length ? 'held-back' : hasSession ? 'compact-then-next' : 'next';

/**
 * What a lead's conversation keeps when the office compacts it between slices: the goal and how it's going, not the
 * details the code and the note already hold.
 */
export function compactInstructions(title: string, note: GoalNote | undefined): string {
  return [
    `Summarise this conversation for the lead of the goal "${title}" to carry on from, at the start of a new slice.`,
    'Keep: the goal and what done looks like; the decisions made and why; what each slice taught us; what the captain prefers, and anything they asked to keep in mind; the pull requests and what became of them; what to do next.',
    'Drop: file contents, diffs, command and tool output, and the step-by-step of finished work: the code and the goal note hold it now.',
    `The goal note as it stands:\n${noteForPrompt(title, note)}`,
  ].join('\n\n');
}

/** What any other agent's conversation keeps when the captain compacts it. */
export const COMPACT_INSTRUCTIONS =
  'Summarise this conversation so you can carry on with your task: keep the task, what you have done and decided and why, and what is left. Drop file contents, diffs, and command and tool output.';

/** How long a goal's note may get: enough to carry the goal, never enough to become a spec. */
export const NOTE_LIMITS = { title: 60, done: 400, slice: 7, item: 160, learned: 10, line: 200, next: 3 } as const;

export const emptyNote = (): GoalNote => ({ done: '', slice: [], learned: [], next: [] });

/**
 * What the lead can send through the note tool: each field replaces what was there, except `learned`, which adds a
 * line (`allLearned` replaces them all, to merge old lessons when the list is full).
 */
export interface NoteInput {
  title?: string;
  done?: string;
  slice?: { text: string; done?: boolean }[];
  learned?: string;
  allLearned?: string[];
  next?: string[];
}

/** Why the note is too long, for the lead to trim: undefined when it fits. */
export function checkNote(title: string, note: GoalNote): string | undefined {
  const L = NOTE_LIMITS;
  const over: string[] = [];
  if (title.length > L.title) over.push(`the title is ${title.length} characters (at most ${L.title})`);
  if (note.done.length > L.done) over.push(`done is ${note.done.length} characters (at most ${L.done})`);
  if (note.slice.length > L.slice) over.push(`the slice has ${note.slice.length} items (at most ${L.slice}: split the slice, or merge items)`);
  if (note.slice.some((i) => i.text.length > L.item)) over.push(`a slice item is longer than ${L.item} characters`);
  if (note.learned.length > L.learned) over.push(`learned has ${note.learned.length} lines (at most ${L.learned}: send allLearned with the older lessons merged)`);
  if (note.learned.some((l) => l.length > L.line)) over.push(`a learned line is longer than ${L.line} characters`);
  if (note.next.length > L.next) over.push(`next has ${note.next.length} ideas (at most ${L.next})`);
  if (note.next.some((n) => n.length > L.item)) over.push(`an idea in next is longer than ${L.item} characters`);
  return over.length ? `The note is too long: ${over.join('; ')}. It's a note, not a spec: trim it and try again.` : undefined;
}

/** The goal's title and note after the lead's update, or why it was refused (nothing changes then). */
export function applyNote(work: Pick<LeadWork, 'title' | 'note'>, input: NoteInput): { title: string; note: GoalNote } | { error: string } {
  const before = work.note ?? emptyNote();
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
  const title = input.title !== undefined && clean(input.title) ? clean(input.title) : work.title;
  const note: GoalNote = {
    done: input.done !== undefined ? input.done.trim() : before.done,
    slice: input.slice ? input.slice.map((i) => ({ text: clean(i.text), done: !!i.done })).filter((i) => i.text) : before.slice,
    learned: [...(input.allLearned ? input.allLearned.map(clean).filter(Boolean) : before.learned), ...(input.learned && clean(input.learned) ? [clean(input.learned)] : [])],
    next: input.next ? input.next.map(clean).filter(Boolean) : before.next,
  };
  const error = checkNote(title, note);
  return error ? { error } : { title, note };
}

/** The goal as the lead last wrote it down: for a new slice, and anywhere their conversation may have been summarised. */
export function noteForPrompt(title: string, note: GoalNote | undefined): string {
  const n = note ?? emptyNote();
  const parts = [`The goal: ${title}`];
  if (n.done) parts.push(`What done looks like: ${n.done}`);
  if (n.learned.length) parts.push(`What the slices so far taught us:\n${n.learned.map((l) => `- ${l}`).join('\n')}`);
  if (n.slice.length) parts.push(`This slice:\n${n.slice.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n')}`);
  if (n.next.length) parts.push(`Ideas for next:\n${n.next.map((x) => `- ${x}`).join('\n')}`);
  return parts.join('\n\n');
}

/** What closing the goal would lose or leave behind, for the captain to confirm first. */
export function closeCheck(work: Pick<LeadWork, 'prs'>, dirtyFolders: string[]): { kind: 'ok' } | { kind: 'warn'; reasons: string[] } {
  const reasons: string[] = [];
  if (dirtyFolders.length) reasons.push(`Uncommitted changes in ${dirtyFolders.map((f) => `./${f}`).join(' and ')} are thrown away.`);
  const open = work.prs.filter((p) => !p.outcome);
  if (open.length) reasons.push(`${open.map((p) => `${p.repo}#${p.number}`).join(' and ')} ${open.length === 1 ? 'stays' : 'stay'} open on GitHub, with no lead to fix ${open.length === 1 ? 'it' : 'them'}.`);
  return reasons.length ? { kind: 'warn', reasons } : { kind: 'ok' };
}

/** How many closed goals a room keeps in its log. */
export const GOAL_LOG = 30;

/** The goal for the room's log, as it closes: its slices are the ones that shipped. */
export function goalRecord(agent: Agent, now: number): GoalRecord {
  const work = agent.lead!;
  return { id: agent.id, title: work.title, note: work.note, slices: work.prs.length ? work.slice : work.slice - 1, prs: work.prs, leadName: agent.name, sessionId: agent.sessionId, openedAt: agent.startedAt, closedAt: now };
}

/** The room's log with a goal just closed: newest first, the oldest dropping off. */
export const fileGoal = (log: GoalRecord[], record: GoalRecord): GoalRecord[] => [record, ...log.filter((g) => g.id !== record.id)].slice(0, GOAL_LOG);

/** The queued goal a freed station offers: the first in line. */
export const nextGoal = (queue: QueuedGoal[] | undefined): QueuedGoal | undefined => queue?.[0];

/** The queue with one goal moved `by` places (negative: sooner), staying within the queue. */
export function moveQueued(queue: QueuedGoal[], id: string, by: number): QueuedGoal[] {
  const from = queue.findIndex((g) => g.id === id);
  if (from < 0) return queue;
  const to = Math.max(0, Math.min(queue.length - 1, from + by));
  const next = queue.filter((g) => g.id !== id);
  next.splice(to, 0, queue[from]);
  return next;
}

/** Where the lead's repos are, for the first message of a goal. */
export function workspaceNote(work: LeadWork, branch: string): string {
  return `Your workspace, with every repo of the project checked out side by side:\n${workspaceList(work, branch)}`;
}

/** What the lead hears back after shipping: each pull request opened or updated. */
export function shipped(lines: string[]): string {
  return `${lines.join('\n')}\n\nThe room's QA officer reviews each pull request, and you'll hear their verdict. Tell the captain what's in the slice and what you'd do next.`;
}

/** A goal's own QA reviewer, reused from review to review like the room's QA officer. */
export const goalReviewerId = (leadId: string) => `qa_${leadId}`;

/** The goal whose lead shipped this pull request, if one did: its own reviewer reviews it. */
export const goalOf = (review: Pick<QaReview, 'repo' | 'number'>, leads: Agent[]): Agent | undefined =>
  leads.find((a) => a.task === 'lead' && a.lead?.prs.some((p) => p.repo === review.repo && p.number === review.number));

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

/** How many times QA can fail one of the lead's pull requests before the lead stops being sent back to fix it. */
export const LEAD_FIX_ROUNDS = 2;

/**
 * What QA's verdict on one of the lead's pull requests does: a fail wakes the lead to fix it, for a couple of rounds;
 * after that, and on a pass, the lead hears it with the captain's next message, and a fail that keeps coming back is the
 * captain's to look at.
 */
export function afterVerdict(verdict: QaReport['verdict'], failedRounds: number): 'wake' | 'pass-on' | 'needs-you' {
  if (verdict === 'pass') return 'pass-on';
  return failedRounds <= LEAD_FIX_ROUNDS ? 'wake' : 'needs-you';
}

/** QA's verdict on one of the slice's pull requests, for the lead. */
export function qaVerdictNote(repo: string, number: number, report: Pick<QaReport, 'verdict' | 'summary' | 'fixInstructions'>): string {
  const verdict = report.verdict === 'pass' ? 'passed' : 'failed';
  const fix = report.verdict === 'fail' && report.fixInstructions ? `\n\nWhat to fix: ${report.fixInstructions}` : '';
  const next = report.verdict === 'pass' ? 'It waits for the captain to merge it.' : 'Fix it and ship again, or tell the captain why not.';
  return `QA ${verdict} ${repo}#${number}: ${report.summary}${fix}\n\n${next}`;
}

/**
 * One of the slice's pull requests conflicts with its base: the lead resolves it in their own checkout of that repo
 * (which still holds the PR's branch) and ships again, which updates the PR.
 */
export function conflictsNote(repo: string, number: number, baseBranch: string, folder: string): string {
  return [
    `${repo}#${number} has merge conflicts with \`${baseBranch}\`. Resolve them in ./${folder}, which is on its branch:`,
    `1. \`git -C ${folder} fetch origin\`, then \`git -C ${folder} merge origin/${baseBranch}\`.`,
    '2. Resolve every conflict so that both sides keep doing what they were meant to do. Read the base branch commits that caused each conflict before choosing.',
    '3. Run the repo\'s type checks, tests and linters, and fix what the merge broke.',
    '4. Commit the merge, then ship again with mcp__office__ship: that updates the pull request.',
    'Merge rather than rebase: the pull request is already open, so its history must stay intact. If you have other work in progress in that repo, commit it or set it aside first.',
  ].join('\n');
}

/** The slice's pull requests have all merged or closed, for the lead. */
export function landedNote(work: LeadWork): string {
  const prs = work.prs.map((p) => `${p.repo}#${p.number} ${p.outcome === 'merged' ? 'merged' : 'was closed unmerged'}`).join(', ');
  return `Slice ${work.slice} has landed: ${prs}. Tell the captain what it taught you and what you'd do next.`;
}

/** What the lead hears when a new slice starts: their repos on fresh code, and the goal as they wrote it down. */
export function newSliceNote(work: LeadWork, branch: string): string {
  return `Slice ${work.slice} starts on fresh code. Your repos are now:\n${workspaceList(work, branch)}\n\nThe office cleared the last slice's checklist from your note. Where the goal stands:\n\n${noteForPrompt(work.title, work.note)}`;
}

/** The slice landed but some repos still have uncommitted changes: the next slice waits for them. */
export function heldBack(work: LeadWork, folders: string[]): string {
  return `Slice ${work.slice} has landed, but ${folders.map((f) => `./${f}`).join(' and ')} still ${folders.length === 1 ? 'has' : 'have'} uncommitted changes, so your repos stay where they are. Ship them as part of the next slice, or discard them; the next slice starts on fresh code once every repo is clean.`;
}

/** How long a finished helper stays at the group desk, so you see it done before it goes. */
export const HELPER_LINGER_MS = 8000;

/**
 * The lead's helpers after a subagent event: a new one sits down, a busy one's activity changes, a finished one says
 * how it went (and goes once it has lingered). The same list when the event is about no helper we know of.
 */
export function applyHelperEvent(helpers: Helper[], event: HelperEvent, now: number): Helper[] {
  if (event.kind === 'started') {
    if (helpers.some((h) => h.id === event.id)) return helpers;
    return [...helpers, { id: event.id, description: event.description || 'Helping out', type: event.type, status: 'working', activity: 'Getting started', startedAt: now }];
  }
  const helper = helpers.find((h) => h.id === event.id);
  if (!helper) return helpers;
  const next: Helper =
    event.kind === 'activity'
      ? helper.status === 'working' && event.activity ? { ...helper, activity: event.activity } : helper
      : { ...helper, status: event.ok ? 'done' : 'failed', activity: event.ok ? (event.summary?.split('\n')[0] || 'Done') : 'Hit a problem' };
  return next === helper ? helpers : helpers.map((h) => (h.id === event.id ? next : h));
}
