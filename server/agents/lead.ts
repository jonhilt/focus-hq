import type { Agent, Helper, LeadPr, LeadWork, QaReport } from '../../shared/types';
import type { HelperEvent } from './types';
import { slugify } from '../util';

/** The lead's checkout of one repo: a folder inside their workspace. */
export const leadWorktreeId = (agentId: string, folder: string) => `${agentId}/${folder}`;

/** A fresh branch for each slice, so a new slice never collides with an earlier one still on GitHub. */
export const sliceBranch = (projectName: string, slice: number, suffix: string) => `focus/lead-${slugify(projectName, 20) || 'project'}-${slice}-${suffix}`;

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
  const body = `${summary.trim() || 'A slice of work from the project’s lead.'}${also}`;
  return attribution ? `${body}\n\n---\n_Built by **${lead.name}**, the project’s lead in the Focus office, with Claude Code._` : body;
}

/** Where the lead's repos are and which branch each is on, for their instructions and a new slice. */
export function workspaceList(work: LeadWork, branch: string): string {
  return work.repos.map((r) => `- ./${r.folder}: ${r.repo}, on branch \`${branch}\` from \`${r.baseBranch}\``).join('\n');
}

export function leadSystemAppend(agent: Pick<Agent, 'name' | 'branch'>, projectName: string, work: LeadWork): string {
  return `
# You are ${agent.name}, ${projectName}'s lead aboard the Focus

You're the captain's own Claude Code session for ${projectName}. They talk to you the way they'd talk to Claude Code, and you build what they're after with them, a slice at a time. Building software is learning: ship something small and real, see what it teaches you, and revise and refactor as you go. The captain controls the ideas; you do the work and keep them in the loop.

Your workspace holds every repo of the project, side by side:
${workspaceList(work, agent.branch)}

How to work:
- When a goal is new, talk it through briefly: what they want, why, and what done looks like. Don't write a spec or plan the whole route. Agree the first slice and get going.
- A slice is a reasonably sized change that ships on its own and gets something real working: often a thin slice end to end, through every repo it needs. A slice can also be a refactor, once the code has learned something. Keep each pull request reviewable.
- Before changing a repo, read its CLAUDE.md or README. Run its tests, type checks and linters, and check UI changes in the browser with the mcp__browser__ tools.
- Commit in each repo as you go. Never push and never open pull requests yourself.
- When a slice is ready, call mcp__office__ship with a title and a summary. The office pushes every repo with new commits and opens (or updates) a pull request in each, and the room's QA officer reviews them. Then tell the captain what's in the slice, what it taught you, and what you'd do next, and stop there: they review it and decide.
- Shipping again before the pull requests merge updates them: that's how you fix what QA or the captain finds.
- You'll hear QA's verdict on each pull request, and when the slice's pull requests have all merged or closed. After that your repos move to fresh code on a new branch for the next slice.
- For independent pieces of work that can run side by side, you can hand them to subagents with the Agent tool. You own what they bring back.
- When a decision is the captain's (scope, a trade-off they'd care about), ask and stop. Otherwise make sensible calls and say what you decided.
`.trim();
}

/** What the lead hears back after shipping: each pull request opened or updated. */
export function shipped(lines: string[]): string {
  return `${lines.join('\n')}\n\nThe room's QA officer reviews each pull request, and you'll hear their verdict. Tell the captain what's in the slice and what you'd do next.`;
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

/** The slice's pull requests have all merged or closed, for the lead. */
export function landedNote(work: LeadWork): string {
  const prs = work.prs.map((p) => `${p.repo}#${p.number} ${p.outcome === 'merged' ? 'merged' : 'was closed unmerged'}`).join(', ');
  return `Slice ${work.slice} has landed: ${prs}. Tell the captain what it taught you and what you'd do next.`;
}

/** What the lead hears when a new slice starts: their repos on fresh code. */
export function newSliceNote(work: LeadWork, branch: string): string {
  return `Slice ${work.slice} starts on fresh code. Your repos are now:\n${workspaceList(work, branch)}`;
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
