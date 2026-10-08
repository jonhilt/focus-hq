import type { Agent, Effort, GoalArtifact, GoalNote, GoalRecord, Helper, LeadPr, LeadWork, QaReport, QaReview, QueuedGoal, Settings } from '../../shared/types';
import { TEAM_STATIONS } from '../../shared/types';
import type { BranchState, HelperEvent, RunOutcome } from './types';
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

/** How much of the captain's first words on a goal it keeps, to hear again at each new slice. */
export const BRIEF_LIMIT = 2000;

/** The goal as the captain first put it, kept with the goal (cut short past `BRIEF_LIMIT`). */
export function goalBrief(text: string): string {
  const brief = text.trim();
  return brief.length <= BRIEF_LIMIT ? brief : `${brief.slice(0, BRIEF_LIMIT).trimEnd()}…`;
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

/** The commit last shipped to a repo's pull request this slice, if any. */
export const shippedSha = (work: LeadWork, repo: string): string | undefined => work.prs.findLast((p) => p.repo === repo && p.sha)?.sha;

/** The lead's open pull request in a repo, if the slice has one. */
export const openPr = (work: Pick<LeadWork, 'prs'>, repo: string): LeadPr | undefined => work.prs.find((p) => p.repo === repo && !p.outcome);

/** The branch one of the lead's repos is on: the goal's, unless the office started it a fresh one (`needsFreshBranch`). */
export const repoBranch = (repo: Pick<LeadWork['repos'][number], 'branch'>, branch: string): string => repo.branch ?? branch;

/**
 * Whether a repo has to move to a fresh branch from its base before it ships again: a pull request from the branch it's
 * on has merged, and the slice has none open in it. A squash merge leaves the branch's own commits off the base, so a
 * new pull request from it would carry them all again, and conflict. The office starts a new branch from the base
 * instead, bringing only the commits that haven't shipped, as a new slice does. (A pull request that was closed
 * unmerged leaves its branch fit to ship again.)
 */
export function needsFreshBranch(work: Pick<LeadWork, 'prs'>, repo: string, branch: string): boolean {
  if (openPr(work, repo)) return false;
  // a pull request shipped before its branch was kept came from the branch the repo is on: nothing else moved it
  return work.prs.some((p) => p.repo === repo && p.outcome === 'merged' && (p.branch ?? branch) === branch);
}

/** A repo the office moved to a fresh branch before shipping it, and whether its unshipped commits came along. */
export interface FreshBranch {
  folder: string;
  from: string;
  to: string;
  baseBranch: string;
  commits: string[];
  applied: boolean;
}

/** What the lead hears about a repo the office moved to a fresh branch because its pull request had merged. */
export function freshBranchNote({ folder, from, to, baseBranch, commits, applied }: FreshBranch): string {
  const moved = `./${folder}'s pull request from \`${from}\` has merged, so the office moved it to a new branch, \`${to}\`, from fresh \`${baseBranch}\``;
  const one = commits.length === 1;
  if (!commits.length) return `${moved}.`;
  if (applied) return `${moved}, and brought along the ${one ? 'commit' : `${commits.length} commits`} you hadn't shipped.`;
  return `${moved}, but the ${one ? 'commit' : `${commits.length} commits`} you hadn't shipped didn't apply cleanly to it, so ${one ? "it's" : "they're"} only on \`${from}\`. Bring ${one ? 'it' : 'them'} over with \`git -C ${folder} cherry-pick ${commits.map((c) => c.slice(0, 10)).join(' ')}\`, resolve the conflicts, then ship again.`;
}

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
  return work.repos.map((r) => `- ./${r.folder}: ${r.repo}, on branch \`${repoBranch(r, branch)}\` from \`${r.baseBranch}\``).join('\n');
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
- To show the captain something visual (a diagram, a mockup, options side by side), put it on your station's screen with mcp__office__show. They switch between what you've shown and open each one up close.
- When a slice is ready, call mcp__office__ship with a title and a summary. The office pushes every repo with new commits and opens (or updates) a pull request in each, and QA reviews them. Then tell the captain what's in the slice, what it taught you, and what you'd do next, and stop there: they review it and decide.
- Shipping again before the pull requests merge updates them: that's how you fix what QA or the captain finds.
- You'll hear QA's verdict on each pull request, and when the slice's pull requests have all merged or closed. After that your repos move to fresh code on a new branch for the next slice, and the office brings along any commits you hadn't shipped.
- For independent pieces of work that can run side by side, you can hand them to subagents with the Agent tool. You own what they bring back. Hand broad exploration (reading through a repo, long test runs, combing through logs) to subagents too, and keep their conclusions rather than the details: your context has to last the whole goal.
- When a decision is the captain's (scope, a trade-off they'd care about), ask and stop. Otherwise make sensible calls and say what you decided.
- When what done looks like is met, or a slice has landed and nothing worthwhile is left, call mcp__office__propose_close with why, tell the captain, and stop. They close the goal, or carry on with you.
`.trim();
}

/**
 * What happens when a slice has landed and the lead takes their next turn: nothing moves while a repo has uncommitted
 * changes; otherwise the repos move to fresh code for the next slice, taking along commits that never shipped. The
 * conversation is left as it is: the lead may be in the middle of something, so compacting is the captain's call.
 */
export const afterLanding = (dirtyFolders: string[]): 'held-back' | 'next' => (dirtyFolders.length ? 'held-back' : 'next');

/**
 * What a lead's conversation keeps when the captain compacts it: the goal and how it's going, not the details the code
 * and the note already hold.
 */
export function compactInstructions(work: Pick<LeadWork, 'title' | 'note' | 'brief'>): string {
  return [
    `Summarise this conversation for the lead of the goal "${work.title}" to carry on from.`,
    'Keep: the goal, what the captain asked for and what done looks like; the decisions made and why; what each slice taught us; what the captain prefers, and anything they asked to keep in mind; the pull requests and what became of them; what to do next.',
    'Drop: file contents, diffs, command and tool output, and the step-by-step of finished work: the code and the goal note hold it now.',
    `The goal note as it stands:\n${noteForPrompt(work)}`,
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

/**
 * The goal as the captain put it and the lead last wrote it down: for a new slice, and anywhere their conversation may
 * have been summarised or lost.
 */
export function noteForPrompt(work: Pick<LeadWork, 'title' | 'note' | 'brief'>): string {
  const n = work.note ?? emptyNote();
  const parts = [`The goal: ${work.title}`];
  if (work.brief && work.brief !== work.title) parts.push(`As the captain first put it:\n${work.brief.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')}`);
  if (n.done) parts.push(`What done looks like: ${n.done}`);
  if (n.learned.length) parts.push(`What the slices so far taught us:\n${n.learned.map((l) => `- ${l}`).join('\n')}`);
  if (n.slice.length) parts.push(`This slice:\n${n.slice.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n')}`);
  if (n.next.length) parts.push(`Ideas for next:\n${n.next.map((x) => `- ${x}`).join('\n')}`);
  return parts.join('\n\n');
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
 * changes are committed as a WIP snapshot on the branch), but commits GitHub hasn't got stay only in the office's clone.
 */
export function closeCheck(work: Pick<LeadWork, 'prs' | 'slice'>, branch: string, repos: RepoAtClose[]): { kind: 'ok' } | { kind: 'warn'; reasons: string[] } {
  const reasons: string[] = [];
  const list = (folders: string[]) => folders.map((f) => `./${f}`).join(' and ');
  const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;
  const dirty = repos.filter((r) => r.dirty).map((r) => r.folder);
  if (dirty.length) reasons.push(`Uncommitted changes in ${list(dirty)} are committed as a WIP snapshot on \`${branch}\`, kept only in the office’s clone.`);
  for (const r of repos) {
    if (!r.branch) reasons.push(`Couldn’t tell whether ./${r.folder}’s commits reached GitHub.`);
    else if (!r.branch.onOrigin && r.branch.unpushed) reasons.push(`./${r.folder}’s branch \`${r.on ?? branch}\` never reached GitHub: its ${commits(r.branch.unpushed)} stay only in the office’s clone.`);
    else if (r.branch.unpushed) reasons.push(`./${r.folder} has ${commits(r.branch.unpushed)} that never reached GitHub, kept only in the office’s clone.`);
  }
  if (work.slice <= 1 && !work.prs.length) reasons.push('The goal never shipped anything: no pull request was opened for it.');
  const open = work.prs.filter((p) => !p.outcome);
  if (open.length) reasons.push(`${open.map((p) => `${p.repo}#${p.number}`).join(' and ')} ${open.length === 1 ? 'stays' : 'stay'} open on GitHub, with no lead to fix ${open.length === 1 ? 'it' : 'them'}.`);
  return reasons.length ? { kind: 'warn', reasons } : { kind: 'ok' };
}

/** The commit message of the snapshot that keeps a closing goal's uncommitted work on its branch. */
export const snapshotMessage = (title: string) => `WIP: uncommitted work when the goal “${title}” closed`;

/** How many closed goals a room keeps in its log. */
export const GOAL_LOG = 30;

/** Every pull request of the goal so far: the landed slices', then this slice's, each marked with the slice it shipped in. */
export const everyPr = (work: Pick<LeadWork, 'slice' | 'prs' | 'landed'>): LeadPr[] => [...(work.landed ?? []), ...work.prs.map((p) => ({ ...p, slice: p.slice ?? work.slice }))];

/** The goal for the room's log, as it closes: its slices are the ones that shipped, and it keeps every one's pull requests. */
export function goalRecord(agent: Agent, now: number): GoalRecord {
  const work = agent.lead!;
  return {
    id: agent.id, title: work.title, note: work.note, slices: work.prs.length ? work.slice : work.slice - 1, prs: everyPr(work), slice: work.slice, leadName: agent.name, sessionId: agent.sessionId,
    brief: work.brief, branch: agent.branch, repos: work.repos, openedAt: agent.startedAt, closedAt: now,
  };
}

/** Whether a closed goal can be reopened: it kept its branch and repos (goals closed before they were kept didn't). */
export const reopenable = (goal: GoalRecord): boolean => !!goal.branch && !!goal.repos?.length;

/**
 * A closed goal's work as it stood when it closed, at `station`: the slice it was on, with that slice's pull requests,
 * and its repos (so closing it again before they're checked out still files a goal that can be reopened).
 */
export function reopenedWork(goal: GoalRecord, station: number): LeadWork {
  // goals closed before they kept their slice kept only that slice's pull requests
  const slice = goal.slice ?? (goal.prs.length ? goal.slices : goal.slices + 1);
  const current = goal.slice === undefined ? goal.prs : goal.prs.filter((p) => p.slice === slice);
  const landed = goal.slice === undefined ? [] : goal.prs.filter((p) => p.slice !== slice);
  return {
    station, title: goal.title, brief: goal.brief, note: goal.note, repos: goal.repos ?? [], slice, prs: current,
    ...(landed.length && { landed }), reopening: { closedAt: goal.closedAt },
  };
}

/**
 * What the lead hears when the captain reopens their goal: where their repos are, and where any uncommitted work went.
 * When its last slice had landed, the next one starts on fresh code first, and the lead hears about that above this.
 */
export function reopenedNote(work: LeadWork, branch: string, closedAt: number): string {
  const closed = new Date(closedAt).toISOString().slice(0, 10);
  const wip = `“${snapshotMessage(work.title)}”`;
  const open = work.prs.filter((p) => !p.outcome);
  return [
    `[Office] The captain reopened this goal, closed on ${closed}.`,
    sliceLanded(work.prs)
      ? `Its last slice had landed, so the next one starts on fresh code, as above. If you had uncommitted work when it closed, it was the commit ${wip}, and it came along with any others you hadn't shipped.`
      : `Your repos are checked out again on \`${branch}\`, as you left them: ${work.repos.map((r) => `./${r.folder}`).join(', ')}. If you had uncommitted work when it closed, it's the commit ${wip} at the tip: build on it, or \`git reset HEAD~1\` to have it uncommitted again.`,
    open.length ? `Still open on GitHub: ${open.map((p) => `${p.repo}#${p.number}`).join(', ')}.` : '',
    "Tell the captain where the goal stands and what you'd do next.",
  ].filter(Boolean).join(' ');
}

/**
 * A lead's conversation that couldn't be resumed because Claude Code no longer has it (the session was cleared, or the
 * goal was reopened on another machine): they carry on in a new one, hearing where the goal stands.
 */
export const sessionGone = (outcome: RunOutcome, resumed: boolean): boolean =>
  resumed && !outcome.ok && !outcome.aborted && !outcome.started && /no conversation found/i.test(outcome.error ?? '');

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
 * The office resolved one of the slice's merge conflicts without the lead: `who` merged the base into the PR's branch and
 * pushed it. The lead's checkout doesn't have that commit until they pull, and the office won't ship over it.
 */
export function conflictsResolvedNote(pr: { repo: string; number: number; baseBranch: string; branch: string }, folder: string, who: string): string {
  return [
    `${pr.repo}#${pr.number} had merge conflicts with \`${pr.baseBranch}\`: ${who} merged \`${pr.baseBranch}\` into \`${pr.branch}\` and pushed it, so ./${folder} is behind GitHub.`,
    `Before you touch ./${folder} again, pull it with \`git -C ${folder} pull --no-rebase origin ${pr.branch}\` (commit or set aside anything in progress first). Until you do, the office won't ship that repo.`,
  ].join(' ');
}

/** The lead's checkout of a repo is missing commits someone else pushed to the slice's branch, so shipping it would lose them. */
export function behindNote(folder: string, branch: string): string {
  return `Nothing shipped: GitHub's \`${branch}\` has commits ./${folder} doesn't (the office pushed a merge to it). Pull them with \`git -C ${folder} pull --no-rebase origin ${branch}\`, check the result, then ship again.`;
}

/** The slice's pull requests have all merged or closed, for the lead. */
export function landedNote(work: LeadWork): string {
  const prs = work.prs.map((p) => `${p.repo}#${p.number} ${p.outcome === 'merged' ? 'merged' : 'was closed unmerged'}`).join(', ');
  return `Slice ${work.slice} has landed: ${prs}. Tell the captain what it taught you and what you'd do next.`;
}

/**
 * What the lead hears when a new slice starts: their repos on fresh code, and the goal as the captain put it and the
 * lead wrote it down.
 */
export function newSliceNote(work: LeadWork, branch: string): string {
  return [
    `Slice ${work.slice} starts on fresh code. Your repos are now:\n${workspaceList(work, branch)}`,
    `The office cleared the last slice's checklist from your note. Where the goal stands:\n\n${noteForPrompt(work)}`,
  ].join('\n\n');
}

/**
 * A lead's first message in a new Claude Code session. A new goal's lead hears where their repos are and the captain's
 * words. A goal under way whose conversation couldn't be resumed hears where the goal stands first; when its slice has
 * landed, the new slice's note (`newSliceNote`, which goes before this) says where the repos are and where the goal stands.
 */
export function freshSessionPrompt(work: LeadWork, branch: string, inbox: string[], landed: boolean): string {
  const words = inbox.join('\n\n');
  // the goal's first words, in full: the brief is them, cut short past BRIEF_LIMIT
  if (work.brief !== undefined && inbox.length && goalBrief(inbox[0]) === work.brief) return `${workspaceNote(work, branch)}\n\n${words}`;
  return [
    landed ? '' : workspaceNote(work, branch),
    `You're carrying on with this goal in a new conversation: the one before couldn't be picked back up.${landed ? '' : ` Where the goal stands:\n\n${noteForPrompt(work)}`}`,
    words || "Look over the repos, then tell the captain where you think the goal stands and what you'd do next.",
  ].filter(Boolean).join('\n\n');
}

/** The slice landed but some repos still have uncommitted changes: the next slice waits for them. */
export function heldBack(work: LeadWork, folders: string[]): string {
  return `Slice ${work.slice} has landed, but ${folders.map((f) => `./${f}`).join(' and ')} still ${folders.length === 1 ? 'has' : 'have'} uncommitted changes, so your repos stay where they are. Ship them as part of the next slice, or discard them; the next slice starts on fresh code once every repo is clean.`;
}

/** Commits in one repo that hadn't shipped when the slice landed, and whether they made it onto the new slice's branch. */
export interface Carried {
  folder: string;
  commits: string[];
  applied: boolean;
}

/** What the lead hears about the commits they hadn't shipped when the slice landed (nothing when there were none). */
export function carriedNote(carried: Carried[], oldBranch: string): string {
  const lines = carried.map(({ folder, commits, applied }) => {
    const one = commits.length === 1;
    const these = one ? 'the commit' : `the ${commits.length} commits`;
    return applied
      ? `- ./${folder}: ${these} you hadn't shipped came along onto the new branch.`
      : `- ./${folder}: ${these} you hadn't shipped didn't apply cleanly to fresh code, so ${one ? "it's" : "they're"} only on \`${oldBranch}\`. Bring ${one ? 'it' : 'them'} over with \`git cherry-pick ${commits.map((c) => c.slice(0, 10)).join(' ')}\` and resolve the conflicts.`;
  });
  return lines.length ? `Work you'd committed but not shipped:\n${lines.join('\n')}` : '';
}

/** How long a finished helper stays at the team station, so you see it done before it goes. */
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
