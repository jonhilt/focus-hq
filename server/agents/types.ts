import type { MergeHeads, MergeTrial } from '../../shared/mergeCheck';
import type { AgentStatus, Autonomy, BrowserFrame, Effort, Settings, TermLine, Workflow, WorkflowAgent } from '../../shared/types';
import type { ZodType } from 'zod';
import type { ArtifactInput, NoteInput, QuestionInput } from './lead';
import type { LeadTool } from '../plugins/contract';
import type { SinceVerdict } from './retest';
import type { CommandRun } from './qaProof';
import type { PackageFacts } from '../packageManager';
import type { BackgroundEvent } from './backgroundTasks';
import type { ShipInput } from './recap';

/** What Claude Code says about a subagent the session started: started, busy with something, finished. */
export type HelperEvent =
  /** `parent`: the helper that started it, when a helper hands on part of its own work. */
  | { kind: 'started'; id: string; description: string; type?: string; parent?: string }
  | { kind: 'activity'; id: string; activity: string }
  /** The model it runs on, from its first message (Claude Code reports nothing else about it). */
  | { kind: 'model'; id: string; model: string }
  | { kind: 'ended'; id: string; ok: boolean; summary?: string };

/**
 * A script the session ran from its scratch dir (to try something out), as a probe: started when the command starts,
 * ended with how it went (it exited cleanly or not) and the first line it printed.
 */
export type ProbeEvent =
  | { kind: 'started'; id: string; description: string; type: 'script' }
  | { kind: 'ended'; id: string; ok: boolean; summary?: string };

/**
 * What Claude Code says about a workflow the session ran: started, how its phases and agents stand (the whole of it,
 * each time one of its agents starts or finishes), finished.
 */
export type WorkflowEvent =
  /** `script`: its source, when the Workflow call carried it (not when it named a saved workflow or a script's path). */
  | { kind: 'started'; id: string; name: string; description: string; script?: string }
  | { kind: 'progress'; id: string; phases: Workflow['phases']; agents: WorkflowAgent[]; roll: Workflow['roll']; usage?: WorkflowUsage }
  | { kind: 'ended'; id: string; ok: boolean; usage?: WorkflowUsage }
  /**
   * Where Claude Code writes its agents' transcripts (agent-<agentId>.jsonl), on this machine, and where it saved the
   * script it runs.
   */
  | { kind: 'transcripts'; id: string; dir: string; scriptPath?: string }
  /** The phases the script's meta declares, once Ops has read a script it only had the path of. */
  | { kind: 'plan'; id: string; plan: NonNullable<Workflow['plan']> };

/** What a workflow has used so far, as a task's progress and its ending count it. */
export type WorkflowUsage = NonNullable<Workflow['usage']>;

export interface RunHooks {
  lines(lines: Omit<TermLine, 't'>[]): void;
  /** status null = keep the current status. */
  activity(status: AgentStatus | null, activity: string): void;
  browser(frame: BrowserFrame): void;
  /** A screenshot the agent took on purpose (mcp__browser__screenshot), on top of the frame every action streams. */
  screenshot(frame: BrowserFrame): void;
  /** Claude Code reported the session; a local one says where its credential came from (`apiKeySource`: ANTHROPIC_API_KEY, apiKeyHelper, none…). */
  session(sessionId: string, keySource?: string): void;
  cost(totalUsd: number): void;
  /** The session signs in with your API key (true) or your plan (false), as it starts. */
  signIn?(onKey: boolean): void;
  /** A subagent of the session started, got busy or finished. */
  helper?(event: HelperEvent): void;
  /** A script run from the scratch dir started or finished (the session's own, not a subagent's). */
  probe?(event: ProbeEvent): void;
  /** The session's own `git commit` succeeded, with its message when the command gave it. */
  commit?(message?: string): void;
  /**
   * A subagent's own lines (`id` as in its HelperEvents): its transcript, kept apart from the session's. Without it they
   * go, indented, in the session's own lines.
   */
  helperLines?(id: string, lines: Omit<TermLine, 't'>[]): void;
  /** A command or monitor the session left running in the background started, or ended, or where its output goes. */
  background?(event: BackgroundEvent): void;
  /** A workflow the session ran started, moved on or finished. */
  workflow?(event: WorkflowEvent): void;
  /** How full the session's context window is, at the end of a turn. */
  context?(usage: { percent: number; tokens: number; max: number }): void;
  /**
   * The session called one of Claude Code's task tools (TodoWrite, TaskCreate, …): what it sent, and what came back as
   * the tool's structured output and as text. The agent's task list follows it (`applyTaskTool`).
   */
  taskTool?(name: string, input: Record<string, unknown>, result: unknown, resultText: string): void;
  /** The agent raises its hand. Resolves true when the manager approves. */
  permission(tool: string, summary: string, signal: AbortSignal): Promise<boolean>;
}

export interface RunRequest {
  agentId: string;
  agentName: string;
  cwd: string;
  prompt: string;
  systemAppend: string;
  resumeSessionId?: string;
  settings: Settings;
  /** What the session may do without asking: the agent's own mode, else Focus's (`effectiveAutonomy`). */
  autonomy: Autonomy;
  /** Missing = the model's default effort. */
  effort?: Effort;
  /** The model chosen for this agent. Missing = `settings.model`. */
  model?: string;
  /** JSON schema for a structured final answer (the QA officer's report). */
  outputSchema?: Record<string, unknown>;
  /** Ops' own tools for this session (a goal's lead's), exposed to Claude Code as mcp__office__*. */
  tools?: OpsTools;
  /**
   * Run in a Claude Code cloud session that works on `branch` and pushes it. `resumeSessionId` is then the cloud
   * session's id, and `systemAppend` goes into the first message.
   */
  cloud?: { branch: string };
  /** What the demo ship's scripted stand-in writes up, for a plugin's brief (`BriefSpec.demo`): a real session ignores it. */
  scripted?: { title: string; summary: string };
}

/** A tool's answer with pictures for Claude to look at: JPEGs, after the words. */
export interface ToolReply {
  text: string;
  images: Uint8Array[];
}

/** Tools Ops lends a session. Each returns what happened, in words, for Claude to read. */
export interface OpsTools {
  /** Ships the slice: pushes every repo with new commits, and opens or updates its pull request. */
  ship(input: ShipInput): Promise<string>;
  /** Updates the goal's note (and title). Throws, in words, when the note would get too long. */
  note(input: NoteInput): Promise<string>;
  /** Puts a visual on the lead's station's screen, or replaces the one with that id. Throws, in words, when it's refused. */
  show(input: ArtifactInput): Promise<string>;
  /** Puts a question to the captain with visual options, on the lead's station's screen. Their pick comes back as a message. */
  ask(input: QuestionInput): Promise<string>;
  /** The lead thinks the goal is done: the captain closes it, or carries on. */
  proposeClose(input: { reason: string }): Promise<string>;
  /** Tools the plugins switched on add (plugins/contract.ts `leadTools`), bound to this lead. */
  extra?: ExtraTool[];
}

/** A plugin's tool at a lead's station, bound to that lead. */
export interface ExtraTool {
  name: string;
  description: string;
  input: Record<string, ZodType>;
  run(input: Record<string, unknown>): Promise<string | ToolReply>;
  /** The input the demo's scripted lead calls it with (`LeadTool.demo`). */
  demo?: LeadTool['demo'];
}

/** What a run the captain stopped reports, and how a stopped review is told apart from one that failed. */
export const STOPPED_BY_CAPTAIN = 'Stopped by the captain';

/** What a run your plan's usage limit stopped reports, to carry on with your API key. */
export const LIMIT_REACHED = "Your plan's usage limit is reached";

export interface RunOutcome {
  ok: boolean;
  /** Claude's final message: becomes the pull request description. */
  summary: string;
  /** The structured final answer, when the run asked for one. */
  structured?: unknown;
  error?: string;
  aborted?: boolean;
  /** Claude Code got as far as reporting the session. A cloud session that couldn't be reattached to never does. */
  started?: boolean;
  /** Your plan's usage limit stopped the session, which can carry on with your API key. */
  limited?: boolean;
}

export interface AgentSession {
  /** Queue a follow-up message. Returns false if the session already wound down. */
  send(text: string): boolean;
  /** Changes how hard Claude thinks, from the session's next request on. */
  setEffort?(effort: Effort): void;
  /** Changes what it may do without asking. Returns false when it can only apply from the session's next turn. */
  setAutonomy?(autonomy: Autonomy): boolean;
  /** Stops one of its background commands or monitors. Resolves false when there's no session to ask. */
  stopTask?(taskId: string): Promise<boolean>;
  stop(): void;
  done: Promise<RunOutcome>;
}

export interface AgentRunner {
  start(req: RunRequest, hooks: RunHooks): AgentSession;
  /** Opens a terminal on the captain's screen, in `cwd`, that starts a cloud session. Missing where there's no terminal to open. */
  cloudTerminal?(req: CloudTerminalRequest): Promise<CloudTerminal>;
}

export interface CloudTerminalRequest {
  agentId: string;
  agentName: string;
  cwd: string;
  /** The new session's first message: what it's for, while Ops gets ready to send the work. */
  description: string;
}

/** A terminal Ops opened to start a cloud session. */
export interface CloudTerminal {
  /** What it has shown so far ('' until anything), where the session's id turns up; undefined when Ops can't see it. */
  read(): Promise<string | undefined>;
}

/** How a branch in a checkout stands with origin: whether origin has it, and how many commits it hasn't got. */
export interface BranchState {
  onOrigin: boolean;
  unpushed: number;
}

/** Git operations on an agent's checkout. Faked in demo mode. */
/** What came of merging a pull request's base branch into it on Ops' side: pushed, nothing to do, or a job for an agent. */
/**
 * Ops' own merge of a PR's base branch: pushed (`auto` lists the conflicted files it settled by rule, see
 * `MergeRule`), nothing to merge, or left for an agent: `files` are the paths that conflicted, and `broke` the check
 * that failed on a merge that went through (`npm run typecheck`, say).
 */
export type BaseMerge =
  | { kind: 'merged'; sha: string; from: string; auto?: string[] }
  | { kind: 'up-to-date' }
  | { kind: 'conflicts'; files: string[]; broke?: string };

export interface WorkspaceOps {
  /**
   * A worktree on `branch`, starting from the remote branch `startPoint`. If a workspace of an agent who isn't
   * `aboard` still has the branch, it's removed; if a colleague's has it, this fails.
   */
  create(repo: string, agentId: string, branch: string, startPoint: string, aboard: (agentId: string) => boolean, local?: string): Promise<string>;
  remove(repo: string, agentId: string): Promise<void>;
  /**
   * Installs the dependencies in a checkout, from its lockfiles, unless they haven't changed since the last install there.
   * Never rejects: a failure comes back as a note for the agent working there.
   */
  install(dir: string): Promise<string | undefined>;
  dir(agentId: string): string;
  hasUncommittedChanges(dir: string): Promise<boolean>;
  commitsAhead(dir: string, baseBranch: string): Promise<number>;
  /** The commit checked out in `dir`. */
  head(dir: string): Promise<string>;
  /** The commits on HEAD not on the base branch nor in `shipped`, oldest first. */
  unshippedCommits(dir: string, baseBranch: string, shipped?: string): Promise<string[]>;
  /** The files HEAD changes against origin's `baseBranch` (a review's checkout): what QA's report accounts for. Missing where there are no real checkouts. */
  changedFiles?(dir: string, baseBranch: string): Promise<string[]>;
  /** Moves `dir`'s checkout onto a new `branch` at origin's (freshly fetched) `baseBranch`. */
  freshBranch(dir: string, branch: string, baseBranch: string): Promise<void>;
  /** Renames the branch checked out in `dir` (the slice's working name, at its first ship); fails if `to` is taken. */
  renameBranch(dir: string, from: string, to: string): Promise<void>;
  /** Applies `commits` on top of HEAD; fails, leaving HEAD as it was, if they don't apply cleanly. */
  cherryPick(dir: string, commits: string[]): Promise<void>;
  push(dir: string, branch: string): Promise<void>;
  /**
   * Makes sure origin has `branch`, for a cloud session to clone: pushes `dir`'s commit if it isn't there yet, and
   * otherwise brings `dir` up to it (work a cloud session already pushed is never overwritten).
   */
  publish(dir: string, branch: string): Promise<void>;
  /** Brings `dir` up to the remote `branch`, where a cloud agent pushed its work. */
  pull(dir: string, branch: string): Promise<void>;
  /** Merges origin's `baseBranch` into origin's `branch` on Ops' side, and pushes it if git needed no help. */
  mergeBase(repo: string, branch: string, baseBranch: string): Promise<BaseMerge>;
  /** Whether origin's `branch` has commits `dir`'s HEAD doesn't. */
  missingRemoteCommits(dir: string, branch: string): Promise<boolean>;
  /** A worktree on `branch` as it was left, nothing reset: Ops' own branch (brought up to GitHub's), else GitHub's. */
  reopen(repo: string, agentId: string, branch: string, aboard: (agentId: string) => boolean): Promise<string>;
  /** Commits everything uncommitted in `dir` as `message`, skipping hooks; false when there was nothing to commit. */
  snapshot(dir: string, message: string): Promise<boolean>;
  /** Whether origin has `branch`, and how many of `dir`'s commits it hasn't got (counting from `baseBranch` while it hasn't). */
  branchState(dir: string, branch: string, baseBranch: string): Promise<BranchState>;
  /** A detached checkout of a pull request's head in the agent's workspace (for QA). Returns the commit ('' if unknown). */
  checkoutPullRequest(repo: string, id: string, number: number): Promise<string>;
  /** What came onto a pull request since QA's verdict on `sha`; null when git can't tell (`sha` is gone, say). */
  sinceVerdict(repo: string, number: number, baseBranch: string, sha: string): Promise<SinceVerdict | null>;
  /** Runs the project's checks on the pull request at `head`: null when it has none Ops knows how to run. */
  runChecks(repo: string, number: number, head: string): Promise<ChecksRun | null>;
  /** The base branch's head and pull request `number`'s, freshly fetched into Ops' clone: what a merge check is about. */
  mergeHeads(repo: string, number: number, baseBranch: string): Promise<MergeHeads>;
  /**
   * The merge check: `head` merged onto `base` (both already fetched), and the repo's checks run on the merge commit
   * (`mergeCheckScripts`, from the project's `chosen` scripts). Never pushed.
   */
  tryMerge(repo: string, heads: MergeHeads, chosen?: readonly string[]): Promise<MergeTrial>;
  /** Runs a command (no shell) in a checkout: its exit code (null if it timed out or couldn't start) and all it printed. Never rejects. Missing where there are no real checkouts. */
  runIn?(dir: string, args: string[], timeoutMs: number): Promise<CommandRun>;
  /** A file in a checkout, named from its root: its contents, or undefined when it isn't there (or is outside it). Missing where there are no real checkouts. */
  readIn?(dir: string, file: string): Promise<string | undefined>;
  /** What a checkout's root says about its checks (package.json, lockfiles, CLAUDE.md); undefined when there's no such folder. Missing where there are no real checkouts. */
  packageFacts?(dir: string): Promise<PackageFacts | undefined>;
  /** The same of Ops' own clone of `repo`; undefined until it has one. Missing where there are no real checkouts. */
  cloneFacts?(repo: string): Promise<PackageFacts | undefined>;
}

/** Ops' own run of a PR's checks: each command, and the end of its output when it failed. */
export interface ChecksRun {
  sha: string;
  results: { command: string; ok: boolean; output?: string }[];
}
