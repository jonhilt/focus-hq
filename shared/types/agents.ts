// Agents: who they are, what they're doing, and where they sit.

import type { LeadWork } from './goals';

export type AgentStatus =
  | 'queued' // hired, waiting for a free slot
  | 'setting-up' // cloning the repo / creating a worktree
  | 'working' // Claude is coding
  | 'testing' // Claude is driving the browser
  | 'waiting' // hand raised: needs the manager to approve a tool call, or to start their cloud session (`handover`)
  | 'pushing' // pushing the branch and opening the pull request
  | 'done' // pull request is open
  | 'error'
  | 'stopped';

export const ACTIVE_STATUSES: AgentStatus[] = ['setting-up', 'working', 'testing', 'waiting', 'pushing'];

export type TermKind = 'system' | 'text' | 'thinking' | 'tool' | 'output' | 'error' | 'success' | 'manager';

export interface TermLine {
  t: number;
  kind: TermKind;
  text: string;
}

export interface BrowserFrame {
  url: string;
  title?: string;
  /** JPEG data URL from a real browser. */
  image?: string;
  /** Demo mode: the client draws a pretend page instead of a screenshot. */
  mock?: { heading: string; accent: string; step: number };
  at: number;
}

/** Starfleet divisions, told apart by uniform colour: command red, operations gold, sciences blue. */
export type Division = 'command' | 'operations' | 'sciences';
/** Pips on the collar: an ensign wears one, a lieutenant two. */
export type Rank = 'ensign' | 'lieutenant';
export type Species = 'human' | 'vulcan' | 'bajoran' | 'andorian' | 'orion' | 'trill';
export type Hairstyle = 'crop' | 'bowl' | 'bun' | 'ponytail' | 'curls' | 'bald';

export interface Avatar {
  division: Division;
  rank: Rank;
  species: Species;
  /** A tone that suits the species: Andorians are blue, Orions green. */
  skin: string;
  hair: string;
  hairstyle: Hairstyle;
  /** `implant` is a cybernetic eyepiece. */
  accessory: 'none' | 'glasses' | 'implant';
}

export interface PermissionRequest {
  id: string;
  tool: string;
  summary: string;
  at: number;
}

/** How hard Claude thinks on a task (the Agent SDK's `effort` option). */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

/**
 * What an agent was seated for: an issue to resolve, an open pull request whose branch conflicts with its base, an open
 * pull request that failed QA, (the room's QA officer) a pull request to review and test, or (a goal's lead) the
 * captain's own Claude Code session for one goal, across all the project's repos.
 */
export type AgentTask = 'issue' | 'conflicts' | 'fix' | 'review' | 'lead';

/**
 * What the office did about a pull request's merge conflicts: merged its base branch in by itself (`auto`: the conflicted
 * files it settled by the repo's rules), found it already had everything (GitHub hadn't caught up), or handed it to an agent.
 */
export type ConflictsOutcome = { kind: 'merged'; auto?: string[] } | { kind: 'up-to-date' } | { kind: 'agent'; agent: Agent };

/** The QA officer doesn't sit at one of the room's desks but at the QA station in the control ring. */
export const QA_DESK = -1;

/** Nor does a goal's lead, who sits at one of the room's team stations (`LeadWork.station`). */
export const LEAD_DESK = -2;

/** How many goals a room can work on at once: each has its own team station, and a lead at it. */
export const TEAM_STATIONS = 4;

/** One item of the task list an agent keeps for itself with Claude Code's task tools (TodoWrite, TaskCreate, TaskUpdate). */
export interface ClaudeTask {
  id: string;
  subject: string;
  status: 'pending' | 'in_progress' | 'completed';
  /** What it says while it's doing it ("Running tests"). */
  activeForm?: string;
}

/** A subagent a goal's lead handed a piece of work to (Claude Code's Agent tool), seated at the goal's team station while it works. */
export interface Helper {
  /** The Agent tool call that started it. */
  id: string;
  /** What the lead asked of it, in a few words. */
  description: string;
  /** The subagent type (general-purpose, Explore, …), when Claude Code says. */
  type?: string;
  /** The model it runs on, from its first message: missing until it's sent one. */
  model?: string;
  /** The helper that started it, when a helper handed on part of its own work (`id` as theirs). */
  parent?: string;
  /**
   * The effort it thinks at. Claude Code doesn't report a subagent's, and they inherit their session's, so this is the
   * lead's when the helper started.
   */
  effort?: Effort;
  status: 'working' | 'done' | 'failed';
  /** What it's doing right now, or how it finished. */
  activity: string;
  startedAt: number;
}

/** One of a workflow's agents, as Claude Code reports it: queued until the workflow has a slot free to start it. */
export interface WorkflowAgent {
  /** Its place in the workflow: Claude Code numbers them in the order they were queued. */
  index: number;
  /** The label the workflow's script gave it (review:bugs). */
  label: string;
  /** The `index` of the phase it's in: 0 for one started before the script named any phase. */
  phase: number;
  status: 'queued' | 'working' | 'done' | 'failed';
  model?: string;
  /** What it was asked, while it works; how it finished, once it has. */
  activity: string;
  /** When it finished, as Claude Code timed it. */
  finishedAt?: number;
  /** Claude Code's id for it, once it has started: its transcript is named after it. */
  agentId?: string;
}

/**
 * One of a workflow's phases: a label its agents run under, not a step (a pipeline's phases run side by side), and how
 * many of its agents stand where.
 */
export interface WorkflowPhase {
  index: number;
  title: string;
  /** A child workflow the script ran inside this one: its agents, under its name. */
  child?: boolean;
  queued: number;
  working: number;
  done: number;
  failed: number;
}

/**
 * A workflow a goal's lead ran (Claude Code's Workflow tool): a script that runs up to 16 agents at once (fewer on a
 * machine with fewer cores), queueing the rest, up to a thousand over its run. It has a transporter room of its own,
 * where the agents at work stand on the pads.
 */
export interface Workflow {
  /** Claude Code's task id for it. */
  id: string;
  /** The script's name (review-changes). */
  name: string;
  /** What it's for, from the script. */
  description: string;
  status: 'running' | 'done' | 'failed';
  /** Every phase it has, in order, with how many of its agents are queued, working, done and failed. */
  phases: WorkflowPhase[];
  /** The agents at work now, and the ones that finished most recently (not every one it has run, which could be a thousand). */
  agents: WorkflowAgent[];
  startedAt: number;
}

/**
 * A command a goal's lead left running in the background (Claude Code's Bash with run_in_background), or a monitor
 * watching for something (its Monitor tool): a probe floating by the lead's chair while it runs.
 */
export interface BackgroundTask {
  /** Claude Code's task id for it. */
  id: string;
  kind: 'shell' | 'monitor';
  /** The command line, or what a monitor is watching for. */
  description: string;
  status: 'running' | 'done' | 'failed' | 'stopped';
  startedAt: number;
  endedAt?: number;
  /** How it ended, as Claude Code put it (the exit code, or that it was stopped). */
  summary?: string;
}

/**
 * An agent waiting for a Claude Code cloud session to take over: the captain moved them to the cloud, or Claude Code
 * wouldn't start the session of a cloud hire without a terminal. The captain starts one (in a terminal the office opens,
 * or on claude.ai) and the office attaches to it, which Claude Code does without a terminal.
 */
export interface CloudHandover {
  since: number;
  /** They haven't started: the cloud session gets their task, rather than work in progress to carry on. */
  fresh: boolean;
  /** Their conversation on this machine, to go back to if the captain keeps them here. */
  localSessionId?: string;
  /** When the office opened a terminal starting the session; it watches the terminal for the session's id. */
  terminalAt?: number;
}

export interface Agent {
  id: string;
  name: string;
  avatar: Avatar;
  projectId: string;
  repo: string;
  task: AgentTask;
  /** A goal's lead's station, repos and pull requests ('lead' task only). */
  lead?: LeadWork;
  /** The subagents the lead has working for it right now, and any that just finished ('lead' task only). */
  helpers?: Helper[];
  /** The workflows the lead has running right now, and any that just finished ('lead' task only). */
  workflows?: Workflow[];
  /** The commands and monitors the lead has running in the background, and any that just ended ('lead' task only). */
  background?: BackgroundTask[];
  /** How full the agent's context window was at the end of its last turn, as Claude Code reports it. */
  context?: { percent: number; tokens: number; max: number };
  /** A goal's own QA reviewer: the goal (its lead's id) whose pull requests they review. Missing on the room's QA officer. */
  reviewFor?: string;
  /** A QA officer's pull request merged or closed while it was theirs: their session is over and a message can't resume it. */
  prGone?: 'merged' | 'closed';
  /** The task list the agent keeps for itself with Claude Code's task tools, as it stands. Missing until it keeps one. */
  tasks?: ClaudeTask[];
  /** For a 'conflicts' or 'fix' task, the pull request itself (GitHub numbers issues and PRs alike). */
  issue: { number: number; title: string; url: string };
  /** Chosen when the agent is hired. Missing = the model's default effort. */
  effort?: Effort;
  /** Claude model chosen for this agent when it was seated (a conflicts agent's). Missing = the office's `model` setting. */
  model?: string;
  /**
   * Works in a Claude Code cloud session instead of on this machine: it pushes its own branch, and `sessionId` is the
   * cloud session's id (session_…). Never set on the QA officer.
   */
  cloud?: boolean;
  /** Waiting for a cloud session to take over their work, which the captain starts (`CloudHandover`). */
  handover?: CloudHandover;
  /**
   * On hold while your plan's usage limit is reached: picking their conversation back up on your API key would cost more
   * than the office spends without asking. They carry on at `until`, when it resets, or when the captain says to.
   */
  held?: { until: number };
  /**
   * Which of the room's DESKS_PER_ROOM desks they sit at; QA_DESK and LEAD_DESK for QA and leads. An agent saved when
   * rooms had more desks can be off the floor (a desk number past them) until they next start (`offTheFloor`).
   */
  desk: number;
  status: AgentStatus;
  /** Short human description of what the agent is doing right now. */
  activity: string;
  branch: string;
  baseBranch: string;
  sessionId?: string;
  pr?: { number: number; url: string };
  permission?: PermissionRequest;
  costUsd: number;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

/** A room's individual desks, for quick issue work; goals have team stations of their own (TEAM_STATIONS). */
export const DESKS_PER_ROOM = 2;
