// The ship as the read-only crew read it through their ship_status tool (claudeCrew's shipTools): who's on what, the
// open pull requests, what needs the captain and the goals closed, per project, trimmed hard. The office builds it
// (index.ts) and lends it to whoever asks: Number One, and plugins through `PluginHost.shipStatus`.
import { statusLine } from '../../shared/agentStatus';
import { shownProjects } from '../../shared/hidden';
import { prKey, qaBadge } from '../../shared/qa';
import type { Agent, GoalRecord, Project, PullRequest, Snapshot } from '../../shared/types';
import { truncate } from '../util';
import { repoFolders } from './planner';

/** A project as the crew's chats know it. */
export type ChatProject = Pick<Project, 'id' | 'name' | 'repos'>;

export interface AgentStatusLine {
  name: string;
  task: Agent['task'];
  repo: string;
  /** "#12 Add a wishlist" */
  issue: string;
  status: Agent['status'];
  activity: string;
  pr?: number;
  /** The agent's worktree on this machine, for the crew to read. Missing for cloud agents. */
  worktree?: string;
}

export interface PrStatusLine {
  repo: string;
  number: number;
  title: string;
  author?: string;
  draft: boolean;
  /** QA's verdict as the board shows it ("✅ QA passed", "not tested"). */
  qa: string;
  checks: PullRequest['checks'];
  failedChecks?: string[];
  conflicts: boolean;
}

export interface ProjectStatus {
  id: string;
  name: string;
  repos: string[];
  agents: AgentStatusLine[];
  openIssues: number;
  prs: PrStatusLine[];
  /** PRs left out to keep it short. */
  morePrs?: number;
  /** What's waiting on the captain in this room. */
  needsCaptain: string[];
  boardError?: string;
  /** Goals the captain has closed, newest first, with each PR's state on GitHub now. */
  closedGoals: ClosedGoalLine[];
  /** Closed goals left out to keep it short. */
  moreGoals?: number;
}

export type GoalPrState = 'open' | 'merged' | 'closed';

export interface GoalPrLine {
  repo: string;
  number: number;
  state: GoalPrState;
  /** GitHub couldn't be asked, so `state` is what was recorded when the goal closed, not confirmed live. */
  stale?: true;
}

export interface ClosedGoalLine {
  title: string;
  lead: string;
  slices: number;
  /** ISO time. */
  closedAt: string;
  /** What done looked like, agreed with the captain at the start. */
  done?: string;
  prs: GoalPrLine[];
}

/** What the crew's `ship_status` tool tells them: per project, who's working on what, the open PRs, what needs the captain and the closed goals. */
export interface ShipStatus {
  projects: ProjectStatus[];
}

const MAX_PRS = 15;
const MAX_GOALS = 10;
const DONE = 200;
const TITLE = 80;
const ACTIVITY = 120;

/** The PRs of the closed goals `summariseShip` shows, whose state it wants looked up on GitHub. */
export function closedGoalPrs(snapshot: Pick<Snapshot, 'projects'>): { repo: string; number: number }[] {
  return shownProjects(snapshot.projects).flatMap((p) => (p.goals ?? []).slice(0, MAX_GOALS).flatMap((g) => g.prs.map(({ repo, number }) => ({ repo, number }))));
}

/**
 * Asks GitHub for each PR's state at once, keyed by `prKey`. A PR whose lookup fails is left out of the map, which
 * `summariseShip` reports as its recorded outcome, marked stale.
 */
export async function lookUpPrStates(prs: { repo: string; number: number }[], state: (repo: string, number: number) => Promise<'OPEN' | 'CLOSED' | 'MERGED'>): Promise<Map<string, GoalPrState>> {
  const unique = [...new Map(prs.map((pr) => [prKey(pr.repo, pr.number), pr])).entries()];
  const found = await Promise.allSettled(unique.map(([, pr]) => state(pr.repo, pr.number)));
  const states = new Map<string, GoalPrState>();
  found.forEach((result, i) => {
    if (result.status === 'fulfilled') states.set(unique[i][0], result.value.toLowerCase() as GoalPrState);
  });
  return states;
}

function closedGoal(goal: GoalRecord, prStates: ReadonlyMap<string, GoalPrState>): ClosedGoalLine {
  return {
    title: truncate(goal.title, TITLE),
    lead: goal.leadName,
    slices: goal.slices,
    closedAt: new Date(goal.closedAt).toISOString(),
    ...(goal.note?.done && { done: truncate(goal.note.done, DONE) }),
    prs: goal.prs.map((pr): GoalPrLine => {
      const live = prStates.get(prKey(pr.repo, pr.number));
      return live ? { repo: pr.repo, number: pr.number, state: live } : { repo: pr.repo, number: pr.number, state: pr.outcome ?? 'open', stale: true };
    }),
  };
}

/**
 * The ship's live state, trimmed hard for a crew member's `ship_status`: no terminal lines, browser frames, previews or
 * voice, and short lines throughout, and nothing about hidden projects. `worktree` says where an agent's checkout lives
 * on this machine. `prStates` is each closed goal's PR's state on GitHub now (see `lookUpPrStates`); one missing falls
 * back to what was recorded.
 */
export function summariseShip(snapshot: Snapshot, worktree: (agentId: string) => string, prStates: ReadonlyMap<string, GoalPrState> = new Map()): ShipStatus {
  const reviews = new Map(snapshot.reviews.map((r) => [prKey(r.repo, r.number), r]));
  const projects = shownProjects(snapshot.projects).map((project): ProjectStatus => {
    const agents = snapshot.agents.filter((a) => a.projectId === project.id);
    const board = snapshot.boards.find((b) => b.projectId === project.id);
    const prs = board?.prs ?? [];
    const goals = project.goals ?? [];
    const needs: string[] = [];
    for (const agent of agents) {
      if (agent.status === 'waiting') needs.push(`${agent.name} has a hand up${agent.permission ? `: ${truncate(agent.permission.summary, ACTIVITY)}` : ''}`);
      if (agent.status === 'error') needs.push(`${agent.name} hit a problem${agent.error ? `: ${truncate(agent.error, ACTIVITY)}` : ''}`);
    }
    for (const pr of prs) {
      const ref = `${pr.repo}#${pr.number}`;
      const review = reviews.get(prKey(pr.repo, pr.number));
      if (pr.mergeable === 'CONFLICTING') needs.push(`${ref} conflicts with ${pr.baseBranch}`);
      if (review?.followUp?.kind === 'needs-you') needs.push(`${ref} failed QA and needs you: ${truncate(review.followUp.reason, ACTIVITY)}`);
      if (review?.status === 'error') needs.push(`${ref}: QA couldn’t finish`);
      if (qaBadge(review, pr).state === 'passed' && pr.checks !== 'failing' && pr.checks !== 'pending' && pr.mergeable !== 'CONFLICTING' && !pr.isDraft) {
        needs.push(`${ref} passed QA: ready to merge`);
      }
    }
    const draft = snapshot.drafts.find((d) => d.projectId === project.id);
    if (draft?.status === 'ready') needs.push(`An issue draft is waiting at Ops: “${truncate(draft.title ?? draft.idea, TITLE)}”`);
    if (draft?.status === 'failed') needs.push(`The Ops station's draft of “${truncate(draft.idea, TITLE)}” failed`);
    return {
      id: project.id,
      name: project.name,
      repos: project.repos,
      agents: agents.map((a) => ({
        name: a.name,
        task: a.task,
        repo: a.repo,
        issue: a.task === 'lead' ? truncate(`Goal “${a.lead?.title ?? a.issue.title}”, slice ${a.lead?.slice ?? 1}, with the captain`, TITLE) : truncate(`#${a.issue.number} ${a.issue.title}`, TITLE),
        status: a.status,
        activity: truncate(statusLine(a), ACTIVITY),
        ...(a.pr && { pr: a.pr.number }),
        ...(!a.cloud && { worktree: worktree(a.id) }),
      })),
      openIssues: board?.issues.length ?? 0,
      prs: prs.slice(0, MAX_PRS).map((pr) => ({
        repo: pr.repo,
        number: pr.number,
        title: truncate(pr.title, TITLE),
        author: pr.author,
        draft: pr.isDraft,
        qa: qaBadge(reviews.get(prKey(pr.repo, pr.number)), pr).label,
        checks: pr.checks,
        ...(pr.failedChecks.length > 0 && { failedChecks: pr.failedChecks.map((c) => c.name).slice(0, 5) }),
        conflicts: pr.mergeable === 'CONFLICTING',
      })),
      ...(prs.length > MAX_PRS && { morePrs: prs.length - MAX_PRS }),
      needsCaptain: needs,
      ...(board?.error && { boardError: truncate(board.error, ACTIVITY) }),
      closedGoals: goals.slice(0, MAX_GOALS).map((g) => closedGoal(g, prStates)),
      ...(goals.length > MAX_GOALS && { moreGoals: goals.length - MAX_GOALS }),
    };
  });
  return { projects };
}

/** Where each project's checkout goes once `open_project` has fetched it: under `base` (the session's cwd when it's empty). */
export function projectList(projects: ChatProject[], base = ''): string {
  if (!projects.length) return 'There are no projects aboard yet.';
  return projects
    .map((p) => {
      const folders = repoFolders(p.repos);
      const repos = p.repos.length ? p.repos.map((r) => `\`${base}${p.id}/${folders.get(r)}/\` (${r})`).join(', ') : 'no repositories yet';
      return `- ${p.name}, id \`${p.id}\`: ${repos}`;
    })
    .join('\n');
}
