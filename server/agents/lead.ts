import type { Agent, Effort, LeadAgent, GoalQuestion, GoalRecord, Helper, LeadPr, LeadWork, QaReport, QaReview, QueuedGoal, Settings } from '../../shared/types';
import { unanswered } from '../../shared/artifacts';
import type { HelperEvent, WorkflowEvent } from './types';
import { applyBackgroundEvent, type BackgroundEvent } from './backgroundTasks';
import { applyTaskTool } from './tasks';
import { applyWorkflowEvent } from './workflows';
import { slugify } from '../util';
import { CREW_RULES, crewPrompt } from './crewFiles';
import { proofsToKeep } from './qaProof';
import { BRIEF_FILE, briefForPrompt } from './briefFile';
import { probedWaypoints, taskedWaypoint } from './waypoints';
import { QUESTION_LIMITS } from './leadRules';

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

export { goalTitle } from '../../shared/goalTitle';

/** How much of the captain's first words on a goal it keeps, to hear again at each new slice. */
export const BRIEF_LIMIT = 2000;

/** The goal as the captain first put it, kept with the goal (cut short past `BRIEF_LIMIT`). */
export function goalBrief(text: string): string {
  const brief = text.trim();
  return brief.length <= BRIEF_LIMIT ? brief : `${brief.slice(0, BRIEF_LIMIT).trimEnd()}…`;
}

/** The effort a new goal's lead works at: what the captain picked, else Focus's default for leads. */
export const goalEffort = (picked: Effort | undefined, settings: Pick<Settings, 'leadEffort'>): Effort => picked ?? settings.leadEffort;


/** Whether the slice has landed: it shipped, and every pull request it opened has merged or closed. */
export const sliceLanded = (prs: LeadPr[]): boolean => prs.length > 0 && prs.every((p) => p.outcome);

/** The branch one of the lead's repos is on: the goal's, unless Ops started it a fresh one (`needsFreshBranch`). */
export const repoBranch = (repo: Pick<LeadWork['repos'][number], 'branch'>, branch: string): string => repo.branch ?? branch;

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

/** Where the lead's repos are and which branch each is on, for their first message and a new slice. */
export function workspaceList(work: LeadWork, branch: string): string {
  return work.repos.map((r) => `- ./${r.folder}: ${r.repo}, on branch \`${repoBranch(r, branch)}\` from \`${r.baseBranch}\``).join('\n');
}

/**
 * The lead's instructions: who they are and how they work. They stay the same for the whole goal, because Claude Code
 * keeps a session's first system prompt on every resume; where the repos are and which branch they're on (which change
 * from slice to slice) come in messages instead (`workspaceNote`, `newSliceNote`).
 */
export function leadSystemAppend(agent: Pick<Agent, 'name'>, projectName: string, work: Pick<LeadWork, 'station' | 'shaping'>): string {
  return crewPrompt('lead', { name: agent.name, project: projectName, station: String(work.station + 1), shaping: !!work.shaping, ...CREW_RULES }).trim();
}

/**
 * What a lead's conversation keeps when the captain compacts it: the goal and how it's going, not the details the code
 * and the brief already hold (Ops gives the lead the brief again once it's compacted: `briefForPrompt`).
 */
export function compactInstructions(work: Pick<LeadWork, 'title' | 'note' | 'brief' | 'briefMd' | 'contacts'>): string {
  return [
    `Summarise this conversation for the lead of the goal "${work.title}" to carry on from.`,
    'Keep: the goal, what the captain asked for and what done looks like; the decisions made and why; what each slice taught us; what the captain prefers, and anything they asked to keep in mind; the pull requests and what became of them; what to do next.',
    `Drop: file contents, diffs, command and tool output, and the step-by-step of finished work: the code and ./${BRIEF_FILE} hold it now.`,
    `Where the goal stands:\n${briefForPrompt(work)}`,
  ].join('\n\n');
}

/** What any other agent's conversation keeps when the captain compacts it. */
export const COMPACT_INSTRUCTIONS =
  'Summarise this conversation so you can carry on with your task: keep the task, what you have done and decided and why, and what is left. Drop file contents, diffs, and command and tool output.';

/**
 * What the lead hears when the page they showed reported errors while Ops took its picture: the first few, each
 * cut short, so they know it may be broken on the screen. Nothing when it loaded cleanly.
 */
export function pageErrorsNote(errors: readonly string[]): string {
  const distinct = [...new Set(errors.map((e) => e.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (!distinct.length) return '';
  const shown = distinct.slice(0, 3).map((e) => (e.length > 200 ? `${e.slice(0, 199)}…` : e));
  const more = distinct.length > shown.length ? ` (and ${distinct.length - shown.length} more)` : '';
  return ` But the page reported ${distinct.length === 1 ? 'an error' : 'errors'} as it loaded${more}: ${shown.map((e) => `“${e}”`).join('; ')}. Fix it and show it again under the same id.`;
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
    brief: work.brief, ...(work.briefMd !== undefined && { briefMd: work.briefMd }), ...(work.shaping && { shaping: true }), branch: agent.branch, repos: work.repos, openedAt: agent.startedAt, closedAt: now,
    ...(work.artifacts?.length && { artifacts: work.artifacts }), ...(work.questions?.length && { questions: work.questions }),
    ...(work.waypoints?.length && { waypoints: work.waypoints }), ...(work.contacts?.length && { contacts: work.contacts }),
  };
}

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
    station, title: goal.title, brief: goal.brief, ...(goal.briefMd !== undefined && { briefMd: goal.briefMd }), ...(goal.shaping && { shaping: true }), note: goal.note, repos: goal.repos ?? [], slice, prs: current,
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
  const said = [
    `[Ops] The captain reopened this goal, closed on ${closed}.`,
    sliceLanded(work.prs)
      ? `Its last slice had landed, so the next one starts on fresh code, as above. If you had uncommitted work when it closed, it was the commit ${wip}, and it came along with any others you hadn't shipped.`
      : `Your repos are checked out again on \`${branch}\`, as you left them: ${work.repos.map((r) => `./${r.folder}`).join(', ')}. If you had uncommitted work when it closed, it's the commit ${wip} at the tip: build on it, or \`git reset HEAD~1\` to have it uncommitted again.`,
    open.length ? `Still open on GitHub: ${open.map((p) => `${p.repo}#${p.number}`).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  // the brief went with the goal's old workspace, unless it's still there: the lead writes it back
  const brief = work.briefMd?.trim() ? `\n\nIf ./${BRIEF_FILE} isn't there any more, write it back as it was:\n\n\`\`\`markdown\n${work.briefMd.trim()}\n\`\`\`\n\n` : ' ';
  return `${said}${brief}Tell the captain where the goal stands and what you'd do next.`;
}

/** The room's log with a goal just closed: newest first, the oldest dropping off. */
/** The goals in `before` that `after` no longer has: what they showed can go. */
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
 * QA's verdict on one of the slice's pull requests, as a note for the lead (`Inbox.note`): heard with the next message
 * they get, not when it comes, so a fail says what to fix and leaves when to the one who wakes them for it.
 */
export function qaVerdictNote(repo: string, number: number, report: Pick<QaReport, 'verdict' | 'summary' | 'fixInstructions' | 'advisory' | 'proofs'>, behind?: VerdictBehind): string {
  const verdict = report.advisory ? 'passed (with advice: it found problems, but no proof held)' : report.verdict === 'pass' ? 'passed' : 'failed';
  const advice = report.advisory && report.fixInstructions ? `\n\nQA's advice, yours to take or leave: ${report.fixInstructions}` : '';
  const fix = report.verdict === 'fail' ? `${report.fixInstructions ? `\n\nWhat to fix: ${report.fixInstructions}` : ''}${proofsToKeep(report).map((l) => `\n${l}`).join('')}` : advice;
  if (behind) {
    const what = `QA ${verdict} ${repo}#${number} at ${behind.tested.slice(0, 7)}, before your last ship (${behind.shipped.slice(0, 7)}): ${report.summary}${fix}`;
    return `${what}\n\nQA is reviewing ${behind.shipped.slice(0, 7)} now, and you'll hear that verdict too. Fix only what your last ship didn't already.`;
  }
  // a fail says nothing of when: the message it comes with does, the captain's or the one a plugin wakes them with
  const next = report.verdict === 'pass' ? '\n\nIt waits for the captain to merge it.' : '';
  return `QA ${verdict} ${repo}#${number}: ${report.summary}${fix}${next}`;
}

/** What the lead hears with QA's fail when Ops sent it to `fixer`, a developer of its own, rather than to them. */
export function fixingNote(fixer: string, repo: string, number: number): string {
  return `${fixer} is fixing it on a branch of their own and Ops pushes their fix to ${repo}#${number}, so there's nothing for you to do: you'll hear when it's pushed, or if it comes back to you. Leave that branch be until then.`;
}

/** A fix Ops sent one of the lead's failed pull requests to didn't land (`reason`): QA's findings are the lead's again. */
export function fixHandedBackNote(repo: string, number: number, report: Pick<QaReport, 'summary' | 'fixInstructions'>, reason: string): string {
  const fix = report.fixInstructions ? `\n\nWhat to fix: ${report.fixInstructions}` : '';
  return `QA's fail on ${repo}#${number} is yours again: ${reason}. QA said: ${report.summary}${fix}`;
}

/** A developer Ops sent one of the lead's failed pull requests to pushed their fix (`sha`) to it, and QA tests it again. */
export function fixPushedNote(pr: { repo: string; number: number; branch: string }, folder: string, who: string, sha: string): string {
  return [
    `${who} fixed what QA found on ${pr.repo}#${pr.number} and pushed it (${sha.slice(0, 7)}) to \`${pr.branch}\`, so ./${folder} is behind GitHub. QA is testing it again, and you'll hear that verdict.`,
    `Before you touch ./${folder} again, pull it with \`git -C ${folder} pull --no-rebase origin ${pr.branch}\` (commit or set aside anything in progress first). Until you do, Ops won't ship that repo.`,
  ].join(' ');
}

/** A verdict on the commit QA `tested`, which the lead has `shipped` past while QA was at it. */
export interface VerdictBehind {
  tested: string;
  shipped: string;
}

/**
 * Ops resolved one of the slice's merge conflicts without the lead: `who` merged the base into the PR's branch and
 * pushed it. The lead's checkout doesn't have that commit until they pull, and Ops won't ship over it.
 */
export function conflictsResolvedNote(pr: { repo: string; number: number; baseBranch: string; branch: string }, folder: string, who: string): string {
  return [
    `${pr.repo}#${pr.number} had merge conflicts with \`${pr.baseBranch}\`: ${who} merged \`${pr.baseBranch}\` into \`${pr.branch}\` and pushed it, so ./${folder} is behind GitHub.`,
    `Before you touch ./${folder} again, pull it with \`git -C ${folder} pull --no-rebase origin ${pr.branch}\` (commit or set aside anything in progress first). Until you do, Ops won't ship that repo.`,
  ].join(' ');
}

/** The slice's pull requests, each merged or closed unmerged. */
function landedPrs(work: LeadWork): string {
  return work.prs.map((p) => `${p.repo}#${p.number} ${p.outcome === 'merged' ? 'merged' : 'was closed unmerged'}`).join(', ');
}

/**
 * The slice's pull requests have all merged or closed, as a note for the lead: heard with the next message they get,
 * mid-turn or as a turn starts, so it says what landed and where their checkouts stand rather than what to do next.
 */
export function landedNote(work: LeadWork): string {
  return [
    `Slice ${work.slice} has landed: ${landedPrs(work)}.`,
    `Your checkouts stay as they are: start what's next on a fresh branch from the base, since a push to a branch whose pull request merged is refused.`,
  ].join(' ');
}

/**
 * What the lead hears when their repos had to be checked out again: a move to a new slice (or a reopening) that failed
 * part way left them with none. They're on fresh code, so commits that hadn't shipped stayed behind on the old branch.
 */
export function reposBackNote(work: LeadWork, branch: string): string {
  return [
    `[Ops] Your repos are checked out again: Ops' last attempt to check them out didn't finish, which left you without them. They're on fresh code for slice ${work.slice}:\n${workspaceList(work, branch)}`,
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
    `You're carrying on with this goal in a new conversation: the one before couldn't be picked back up.${landed ? '' : ` Where the goal stands:\n\n${briefForPrompt(work)}`}`,
    words || "Look over the repos, then tell the captain where you think the goal stands and what you'd do next.",
  ].filter(Boolean).join('\n\n');
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
