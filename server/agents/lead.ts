import type { Agent, Effort, LeadAgent, GoalArtifact, GoalNote, GoalQuestion, GoalRecord, Helper, LeadPr, LeadWork, QaReport, QaReview, QueuedGoal, Settings } from '../../shared/types';
import { TEAM_STATIONS } from '../../shared/types';
import { unanswered } from '../../shared/artifacts';
import type { BranchState, HelperEvent, WorkflowEvent } from './types';
import { applyBackgroundEvent, type BackgroundEvent } from './backgroundTasks';
import { applyTaskTool } from './tasks';
import { applyWorkflowEvent } from './workflows';
import { slugify } from '../util';
import { proofsToKeep } from './qaProof';
import { SCRATCH_RULE } from './scratch';
import { WAIT_RULE } from './wait';
import { applyContacts, type ContactInput, contactsForPrompt } from './contacts';
import { notedWaypoint, probedWaypoints, taskedWaypoint } from './waypoints';

/** The lead's checkout of one repo: a folder inside their workspace. */
export const leadWorktreeId = (agentId: string, folder: string) => `${agentId}/${folder}`;

/** `text` as a branch-name slug of about `max` characters, cut between words. */
function branchSlug(text: string, max: number): string {
  const slug = slugify(text, 60);
  if (slug.length <= max) return slug;
  const cut = slug.lastIndexOf('-', max);
  return slug.slice(0, cut > 8 ? cut : max);
}

/**
 * A fresh branch for each slice, named after the goal, so a new slice never collides with an earlier one still on GitHub,
 * nor with another goal's. It's a working name: the slice's first ship renames it after its work (`shipBranch`).
 */
export function sliceBranch(goalTitle: string, slice: number, suffix: string): string {
  return `focus/${branchSlug(goalTitle, 24) || 'goal'}-${slice}-${suffix}`;
}

/**
 * The branch a repo's pull request ships from: named after what the slice did (the ship's title), keeping the id its
 * working branch ends in so it stays unique. Undefined when the title has nothing to name it by.
 */
export function shipBranch(title: string, working: string): string | undefined {
  const slug = branchSlug(title, 40);
  if (!slug) return undefined;
  const id = /[^-/]*$/.exec(working)?.[0];
  return `focus/${slug}${id ? `-${id}` : ''}`;
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

export { goalTitle } from '../../shared/goalTitle';

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

/** Whether the agent carries a goal's lead work, as every lead does from the moment it's made. */
export const hasLeadWork = (agent: Agent): agent is LeadAgent => agent.lead !== undefined;

/** Whether the slice has landed: it shipped, and every pull request it opened has merged or closed. */
export const sliceLanded = (prs: LeadPr[]): boolean => prs.length > 0 && prs.every((p) => p.outcome);

/** The commit last shipped to a repo's pull request this slice, if any. */
export const shippedSha = (work: LeadWork, repo: string): string | undefined => work.prs.findLast((p) => p.repo === repo && p.sha)?.sha;

/** The lead's open pull request in a repo, if the slice has one. */
export const openPr = (work: Pick<LeadWork, 'prs'>, repo: string): LeadPr | undefined => work.prs.find((p) => p.repo === repo && !p.outcome);

/**
 * What a ship does with a repo's pull request once its push is done, from the one open when the ship started (`before`)
 * and the lead's pull requests as they are now: the captain may have merged or closed it while the push was under way.
 * One still open is updated; one that landed meanwhile stays landed (never put back as open), and what the push added
 * to its branch hasn't shipped: it's carried as unshipped commits are (onto a fresh branch at the next ship, or onto the
 * next slice). With none open before, the office finds or opens one.
 */
export type AfterPush = { kind: 'update'; pr: LeadPr } | { kind: 'landed'; pr: LeadPr & { outcome: 'merged' | 'closed' } } | { kind: 'open' };

export function afterPush(before: LeadPr | undefined, now: Pick<LeadWork, 'prs'>, repo: string): AfterPush {
  const open = openPr(now, repo);
  if (open) return { kind: 'update', pr: open };
  const landed = before && now.prs.find((p) => p.repo === before.repo && p.number === before.number);
  if (landed?.outcome) return { kind: 'landed', pr: { ...landed, outcome: landed.outcome } };
  return { kind: 'open' };
}

/** What the lead hears about a pull request that merged or closed while their ship was pushing to it. */
export function landedMidShipNote(pr: Pick<LeadPr, 'repo' | 'number'> & { outcome: 'merged' | 'closed' }): string {
  const then = pr.outcome === 'merged'
    ? 'Those commits haven\'t shipped: the office carries them over (onto a fresh branch when you ship again, or onto the next slice once this one has landed).'
    : 'Those commits are still on its branch: ship again and the office opens a new pull request from it.';
  return `${pr.repo}#${pr.number} was ${pr.outcome} while the ship was pushing to it, so what this ship pushed isn't in it. ${then}`;
}

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

You're the captain's own Claude Code session for one goal of ${projectName}, at team station ${station + 1} in its room. They talk to you the way they'd talk to Claude Code, and you build what they're after with them. The captain controls the ideas; you do the work and keep them in the loop.

What the captain wants of you:
- Shape the goal first. Talk it through briefly: what they want, why, and what done looks like. Don't write a spec or plan the whole route.
- Prove risky assumptions early. Find what the goal rests on that might not hold, and try it before you build on it.
- Bring real things back for judgement calls. When a choice is the captain's (scope, a trade-off they'd care about), show them something real (running code, a screenshot, a mockup, a model of the code) and ask. Otherwise make a sensible call and say what you decided.
- Keep pull requests reviewable: ship in slices small enough to review and merge cleanly. Other leads may be working in the same repos at the same time, each on their own branches.

How the office works:
- Your workspace holds every repo of the project side by side, each in its own folder; which folders, and the branch each is on, come in your messages. Read a repo's CLAUDE.md or README before changing it.
- Commit as you go, but never push or open pull requests yourself: mcp__office__ship pushes every repo with new commits and opens (or updates) a pull request in each. QA reviews them and you hear its verdict; the captain decides what merges. Once a slice's pull requests have all merged or closed you hear so, and your repos move to fresh code on a new branch at the start of your next turn, bringing along commits you hadn't shipped.
- The goal's star chart is drawn from what you do: your task list (Claude Code's task tools), your commits and your ships.
- mcp__office__note keeps the goal's note, which survives when your conversation gets summarised and which the captain sees: what done looks like, what you've learned, ideas for what's next, and loose threads as contacts.
- Your station's screen: mcp__office__show puts up a visual, mcp__office__model a model of how real code works (cited and checked against your workspace), mcp__office__explain an animated explainer of a concept, and mcp__office__ask a question answered by picking a page (their pick comes back as a message: end your turn for it).
- Hand independent work, and broad exploration, to subagents with the Agent tool, and keep their conclusions: your context has to last the whole goal.
- ${SCRATCH_RULE} It's emptied at the end of each of your turns.
- ${WAIT_RULE}
- When what done looks like is met, or nothing worthwhile is left, say so with mcp__office__propose_close.
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
export function compactInstructions(work: Pick<LeadWork, 'title' | 'note' | 'brief' | 'contacts'>): string {
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

export const emptyNote = (): GoalNote => ({ done: '', learned: [], next: [] });

/**
 * What the lead can send through the note tool: each field replaces what was there, except `learned`, which adds a
 * line (`allLearned` replaces them all, to merge old lessons), and the contacts (`contacts.ts`).
 */
export interface NoteInput extends ContactInput {
  title?: string;
  done?: string;
  learned?: string;
  allLearned?: string[];
  next?: string[];
}

/** The goal's title and note after the lead's update. */
export function applyNote(work: Pick<LeadWork, 'title' | 'note'>, input: NoteInput): { title: string; note: GoalNote } {
  const before = work.note ?? emptyNote();
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
  const title = input.title !== undefined && clean(input.title) ? clean(input.title) : work.title;
  const note: GoalNote = {
    done: input.done !== undefined ? input.done.trim() : before.done,
    learned: [...(input.allLearned ? input.allLearned.map(clean).filter(Boolean) : before.learned), ...(input.learned && clean(input.learned) ? [clean(input.learned)] : [])],
    next: input.next ? input.next.map(clean).filter(Boolean) : before.next,
  };
  return { title, note };
}

/**
 * The goal once the lead sends the note tool, and what the tool says back, or why it was refused (nothing changes then):
 * its title and note (`applyNote`), its contacts (`contacts.ts`) and its waypoints, where a lesson, or a change to what
 * done looks like, goes on the slice it's about (`notedWaypoint`).
 */
export function notedGoal(work: LeadWork, input: NoteInput, now: number): { lead: LeadWork; reply: string } | { error: string } {
  const next = applyNote(work, input);
  const contacts = applyContacts(work, input, now);
  if ('error' in contacts) return contacts;
  const waypoints = notedWaypoint(work, input, next.note, now);
  const contact = input.contact?.trim() ? contacts.at(-1) : undefined;
  return {
    lead: { ...work, title: next.title, note: next.note, ...(waypoints && { waypoints }), ...(contacts.length && { contacts }) },
    reply: `Noted.${contact ? ` Logged contact ${contact.id}.` : ''}`,
  };
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
 * What the lead hears when the page they showed reported errors while the office took its picture: the first few, each
 * cut short, so they know it may be broken on the screen. Nothing when it loaded cleanly.
 */
export function pageErrorsNote(errors: readonly string[]): string {
  const distinct = [...new Set(errors.map((e) => e.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (!distinct.length) return '';
  const shown = distinct.slice(0, 3).map((e) => (e.length > 200 ? `${e.slice(0, 199)}…` : e));
  const more = distinct.length > shown.length ? ` (and ${distinct.length - shown.length} more)` : '';
  return ` But the page reported ${distinct.length === 1 ? 'an error' : 'errors'} as it loaded${more}: ${shown.map((e) => `“${e}”`).join('; ')}. Fix it and show it again under the same id.`;
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
 * The goal's questions once the captain sends the lead a chat message: an open one counts as answered in chat, with
 * what they said as its note (the lead reads the message and acts on it; which option they meant isn't guessed). The
 * same questions when none is open.
 */
export function answerInChat(questions: readonly GoalQuestion[], text: string, at: number): GoalQuestion[] {
  const open = unanswered(questions);
  if (!open) return [...questions];
  const said = text.trim().slice(0, QUESTION_LIMITS.note);
  return questions.map((q) => (q === open ? { ...q, answer: { ...(said ? { note: said } : {}), at } } : q));
}

/**
 * The goal as the captain put it and the lead last wrote it down: for a new slice, and anywhere their conversation may
 * have been summarised or lost.
 */
export function noteForPrompt(work: Pick<LeadWork, 'title' | 'note' | 'brief' | 'contacts'>): string {
  const n = work.note ?? emptyNote();
  const parts = [`The goal: ${work.title}`];
  if (work.brief && work.brief !== work.title) parts.push(`As the captain first put it:\n${work.brief.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')}`);
  if (n.done) parts.push(`What done looks like: ${n.done}`);
  if (n.learned.length) parts.push(`What the slices so far taught us:\n${n.learned.map((l) => `- ${l}`).join('\n')}`);
  if (n.next.length) parts.push(`Ideas for next:\n${n.next.map((x) => `- ${x}`).join('\n')}`);
  const contacts = contactsForPrompt(work.contacts);
  if (contacts) parts.push(contacts);
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
export function goalRecord(agent: LeadAgent, now: number): GoalRecord {
  const work = agent.lead;
  return {
    id: agent.id, title: work.title, note: work.note, slices: work.prs.length ? work.slice : work.slice - 1, prs: everyPr(work), slice: work.slice, leadName: agent.name, sessionId: agent.sessionId,
    brief: work.brief, branch: agent.branch, repos: work.repos, openedAt: agent.startedAt, closedAt: now,
    ...(work.artifacts?.length && { artifacts: work.artifacts }), ...(work.questions?.length && { questions: work.questions }),
    ...(work.waypoints?.length && { waypoints: work.waypoints }), ...(work.contacts?.length && { contacts: work.contacts }),
  };
}

/** A closed goal that kept its branch and the repos it was checked out from. */
export type ReopenableGoal = GoalRecord & { branch: string; repos: [LeadWork['repos'][number], ...LeadWork['repos']] };

/** Whether a closed goal can be reopened: it kept its branch and repos (goals closed before they were kept didn't). */
export const reopenable = (goal: GoalRecord): goal is ReopenableGoal => !!goal.branch && !!goal.repos?.length;

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
    ...(goal.artifacts && { artifacts: goal.artifacts }), ...(goal.questions && { questions: goal.questions }),
    ...(goal.waypoints && { waypoints: goal.waypoints }), ...(goal.contacts && { contacts: goal.contacts }),
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

/** The room's log with a goal just closed: newest first, the oldest dropping off. */
/** The goals in `before` that `after` no longer has: what they showed can go. */
export const fileGoal = (log: GoalRecord[], record: GoalRecord): GoalRecord[] => [record, ...log.filter((g) => g.id !== record.id)].slice(0, GOAL_LOG);

/** The queued goal a freed station offers: the first in line. */
export const nextGoal = (queue: QueuedGoal[] | undefined): QueuedGoal | undefined => queue?.[0];

/** What starting a queued goal comes to: the station, words and effort it starts with, or why it can't start. */
export type QueuedStart =
  | { kind: 'start'; station: number; text: string; effort?: Effort; from?: string }
  | { kind: 'refused'; message: string };

/**
 * Starting goal `id` from the queue, with the captain's last edits to it: the station they started it from if it's still
 * free, else the first free one; their words and effort, else the ones it was queued with. `taken` holds the stations
 * with a goal, and `room` names the project.
 */
export function queuedStart(queue: QueuedGoal[] | undefined, id: string, taken: number[], edits: { text?: string; effort?: Effort; station?: number }, room: string): QueuedStart {
  const queued = queue?.find((g) => g.id === id);
  if (!queued) return { kind: 'refused', message: 'That goal is no longer in line' };
  const station = (edits.station === undefined ? undefined : pickStation(taken, edits.station)) ?? pickStation(taken);
  if (station === undefined) return { kind: 'refused', message: `Every team station in ${room} still has a goal` };
  return { kind: 'start', station, text: edits.text?.trim() || queued.text, effort: edits.effort ?? queued.effort, from: queued.from };
}

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
  return `${lines.join('\n')}\n\nThe room's QA officer reviews each pull request, and you'll hear their verdict.`;
}

/** A goal's own QA reviewer, reused from review to review like the room's QA officer. */
export const goalReviewerId = (leadId: string) => `qa_${leadId}`;

/**
 * The other pull requests of the slice `pr` belongs to, one per repo, which QA checks out beside it to test the slice's
 * change across repos as one. None when no goal shipped it, or its slice touched no other repo.
 */
export const sliceSiblings = (pr: Pick<QaReview, 'repo' | 'number'>, goal: Agent | undefined): LeadPr[] =>
  goal?.lead?.prs.some((p) => p.repo === pr.repo && p.number === pr.number) ? goal.lead.prs.filter((p) => p.repo !== pr.repo) : [];

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
export function qaVerdictNote(repo: string, number: number, report: Pick<QaReport, 'verdict' | 'summary' | 'fixInstructions' | 'advisory' | 'proofs'>, behind?: VerdictBehind): string {
  const verdict = report.advisory ? 'passed (with advice: it found problems, but no proof held)' : report.verdict === 'pass' ? 'passed' : 'failed';
  const advice = report.advisory && report.fixInstructions ? `\n\nQA's advice, yours to take or leave: ${report.fixInstructions}` : '';
  const fix = report.verdict === 'fail' ? `${report.fixInstructions ? `\n\nWhat to fix: ${report.fixInstructions}` : ''}${proofsToKeep(report).map((l) => `\n${l}`).join('')}` : advice;
  if (behind) {
    const what = `QA ${verdict} ${repo}#${number} at ${behind.tested.slice(0, 7)}, before your last ship (${behind.shipped.slice(0, 7)}): ${report.summary}${fix}`;
    return `${what}\n\nQA is reviewing ${behind.shipped.slice(0, 7)} now, and you'll hear that verdict too. Fix only what your last ship didn't already.`;
  }
  const next = report.verdict === 'pass' ? 'It waits for the captain to merge it.' : 'Fix it and ship again, or tell the captain why not.';
  return `QA ${verdict} ${repo}#${number}: ${report.summary}${fix}\n\n${next}`;
}

/** A verdict on the commit QA `tested`, which the lead has `shipped` past while QA was at it. */
export interface VerdictBehind {
  tested: string;
  shipped: string;
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

/** The slice's pull requests, each merged or closed unmerged. */
function landedPrs(work: LeadWork): string {
  return work.prs.map((p) => `${p.repo}#${p.number} ${p.outcome === 'merged' ? 'merged' : 'was closed unmerged'}`).join(', ');
}

/** The slice's pull requests have all merged or closed, for a lead who isn't in a turn: it wakes them. */
export function landedNote(work: LeadWork): string {
  return [
    `Slice ${work.slice} has landed: ${landedPrs(work)}.`,
    `Carry on with what's next, unless it's the captain's call.`,
  ].join(' ');
}

/**
 * The slice's pull requests have all merged or closed while the lead is in the middle of a turn. The repos only move at the
 * start of their next turn, so they carry on: a lead that stops to make the move happen leaves the goal waiting on the captain.
 */
export function landedMidTurnNote(work: LeadWork): string {
  return [
    `Slice ${work.slice} has landed: ${landedPrs(work)}.`,
    `Carry on where you are: your repos move to fresh code at the start of your next turn, bringing your commits along.`,
  ].join(' ');
}

/**
 * What the lead hears when a new slice starts: their repos on fresh code, and the goal as the captain put it and the
 * lead wrote it down.
 */
export function newSliceNote(work: LeadWork, branch: string): string {
  return [
    `Slice ${work.slice} starts on fresh code. Your repos are now:\n${workspaceList(work, branch)}`,
    `Where the goal stands:\n\n${noteForPrompt(work)}`,
  ].join('\n\n');
}

/**
 * What the lead hears when their repos had to be checked out again: a move to a new slice (or a reopening) that failed
 * part way left them with none. They're on fresh code, so commits that hadn't shipped stayed behind on the old branch.
 */
export function reposBackNote(work: LeadWork, branch: string): string {
  return [
    `[Office] Your repos are checked out again: the office's last attempt to check them out didn't finish, which left you without them. They're on fresh code for slice ${work.slice}:\n${workspaceList(work, branch)}`,
    `Any commits you hadn't shipped didn't come along: they're still on your last slice's branch, if you need them.`,
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
export function applyHelperEvent(helpers: Helper[], event: HelperEvent, now: number, leadEffort?: Effort): Helper[] {
  if (event.kind === 'started') {
    if (helpers.some((h) => h.id === event.id)) return helpers;
    return [...helpers, { id: event.id, description: event.description || 'Helping out', type: event.type, effort: leadEffort, status: 'working', activity: 'Getting started', startedAt: now, ...(event.parent && { parent: event.parent }) }];
  }
  const helper = helpers.find((h) => h.id === event.id);
  if (!helper) return helpers;
  const next: Helper =
    event.kind === 'model'
      ? helper.model === event.model ? helper : { ...helper, model: event.model }
      : event.kind === 'activity'
      ? helper.status === 'working' && event.activity ? { ...helper, activity: event.activity } : helper
      : { ...helper, status: event.ok ? 'done' : 'failed', activity: event.ok ? (event.summary?.split('\n')[0] || 'Done') : 'Hit a problem' };
  return next === helper ? helpers : helpers.map((h) => (h.id === event.id ? next : h));
}

/**
 * What a subagent event changes on a lead: its helpers at the team station, and each one's probe on the goal's chart,
 * from the slice under way. Undefined when the event is about no helper it seats or knows.
 */
export function helperChange(lead: Pick<Agent, 'helpers' | 'lead' | 'effort'>, event: HelperEvent, now: number): Pick<Agent, 'helpers' | 'lead'> | undefined {
  const before = lead.helpers ?? [];
  const helpers = applyHelperEvent(before, event, now, lead.effort);
  if (helpers === before) return undefined;
  const work = lead.lead;
  const waypoints = work && probedWaypoints(work, event, now);
  return { helpers, ...(work && waypoints && { lead: { ...work, waypoints } }) };
}

/**
 * What one call to a task tool changes on an agent: its task list, and for a lead its slice's work on the goal's chart.
 * Undefined when the call left the list as it was.
 */
export function taskChange(
  agent: Pick<Agent, 'task' | 'tasks' | 'lead'>,
  call: { name: string; input: Record<string, unknown>; result?: unknown; said?: string },
  now: number,
): Pick<Agent, 'tasks' | 'lead'> | undefined {
  const before = agent.tasks ?? [];
  const tasks = applyTaskTool(before, call.name, call.input, call.result, call.said);
  if (tasks === before) return undefined;
  const work = agent.task === 'lead' ? agent.lead : undefined;
  const waypoints = work && taskedWaypoint(work, before, tasks, now);
  return { tasks, ...(work && waypoints !== work.waypoints && { lead: { ...work, waypoints } }) };
}

/**
 * What a background command's event changes on a lead: the commands floating by their chair. Undefined for anyone
 * else's, which have nowhere to float, and when it changed none of them (where a command's output goes is the caller's
 * to keep).
 */
export function backgroundChange(agent: Pick<Agent, 'task' | 'background'>, event: BackgroundEvent, now: number): Pick<Agent, 'background'> | undefined {
  if (agent.task !== 'lead') return undefined;
  const before = agent.background ?? [];
  const background = applyBackgroundEvent(before, event, now);
  return background === before ? undefined : { background };
}

/**
 * What the captain's stop of one of a lead's background tasks is for: what to tell the lead once it's stopped, so they
 * don't wonder where it went. Undefined when the agent has no such task still running.
 */
export function backgroundStop(agent: Pick<Agent, 'background'> | undefined, taskId: string): { note: string } | undefined {
  const task = agent?.background?.find((t) => t.id === taskId && t.status === 'running');
  if (!task) return undefined;
  const what = task.kind === 'monitor' ? `your monitor (${task.description})` : `your background command \`${task.description}\``;
  return { note: `I stopped ${what}. Start it again if you still need it.` };
}

/**
 * What a workflow event changes on a lead: the away teams beaming into its briefing room. Undefined for anyone else's,
 * which have nowhere to beam in to, and when it changed none of them.
 */
export function workflowChange(agent: Pick<Agent, 'task' | 'workflows'>, event: WorkflowEvent, now: number): Pick<Agent, 'workflows'> | undefined {
  if (agent.task !== 'lead') return undefined;
  const before = agent.workflows ?? [];
  const workflows = applyWorkflowEvent(before, event, now);
  return workflows === before ? undefined : { workflows };
}
