import type { AgentStatus, BrowserFrame, Effort, Settings, TermLine } from '../../shared/types';
import type { NoteInput } from './lead';

/** What Claude Code says about a subagent the session started: started, busy with something, finished. */
export type HelperEvent =
  | { kind: 'started'; id: string; description: string; type?: string }
  | { kind: 'activity'; id: string; activity: string }
  | { kind: 'ended'; id: string; ok: boolean; summary?: string };

export interface RunHooks {
  lines(lines: Omit<TermLine, 't'>[]): void;
  /** status null = keep the current status. */
  activity(status: AgentStatus | null, activity: string): void;
  browser(frame: BrowserFrame): void;
  /** A screenshot the agent took on purpose (mcp__browser__screenshot), on top of the frame every action streams. */
  screenshot(frame: BrowserFrame): void;
  session(sessionId: string): void;
  cost(totalUsd: number): void;
  /** A subagent of the session started, got busy or finished. */
  helper?(event: HelperEvent): void;
  /**
   * A subagent's own lines (`id` as in its HelperEvents): its transcript, kept apart from the session's. Without it they
   * go, indented, in the session's own lines.
   */
  helperLines?(id: string, lines: Omit<TermLine, 't'>[]): void;
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
  /** Missing = the model's default effort. */
  effort?: Effort;
  /** JSON schema for a structured final answer (the QA officer's report). */
  outputSchema?: Record<string, unknown>;
  /** The office's own tools for this session (a goal's lead's), exposed to Claude Code as mcp__office__*. */
  tools?: OfficeTools;
  /**
   * Run in a Claude Code cloud session that works on `branch` and pushes it. `resumeSessionId` is then the cloud
   * session's id, and `systemAppend` goes into the first message.
   */
  cloud?: { branch: string };
}

/** Tools the office lends a session. Each returns what happened, in words, for Claude to read. */
export interface OfficeTools {
  /** Ships the slice: pushes every repo with new commits, and opens or updates its pull request. */
  ship(input: { title: string; summary: string }): Promise<string>;
  /** Updates the goal's note (and title). Throws, in words, when the note would get too long. */
  note(input: NoteInput): Promise<string>;
  /** The lead thinks the goal is done: the captain closes it, or carries on. */
  proposeClose(input: { reason: string }): Promise<string>;
}

/** What a run the captain stopped reports, and how a stopped review is told apart from one that failed. */
export const STOPPED_BY_CAPTAIN = 'Stopped by the captain';

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
}

export interface AgentSession {
  /** Queue a follow-up message. Returns false if the session already wound down. */
  send(text: string): boolean;
  /** Changes how hard Claude thinks, from the session's next request on. */
  setEffort?(effort: Effort): void;
  stop(): void;
  done: Promise<RunOutcome>;
}

export interface AgentRunner {
  start(req: RunRequest, hooks: RunHooks): AgentSession;
}

/** Git operations on an agent's checkout. Faked in demo mode. */
export interface WorkspaceOps {
  /**
   * A worktree on `branch`, starting from the remote branch `startPoint`. If a workspace of an agent who isn't
   * `inOffice` still has the branch, it's removed; if a colleague's has it, this fails.
   */
  create(repo: string, agentId: string, branch: string, startPoint: string, inOffice: (agentId: string) => boolean): Promise<string>;
  remove(repo: string, agentId: string): Promise<void>;
  dir(agentId: string): string;
  hasUncommittedChanges(dir: string): Promise<boolean>;
  commitsAhead(dir: string, baseBranch: string): Promise<number>;
  /** The commit checked out in `dir`. */
  head(dir: string): Promise<string>;
  /** The commits on HEAD not on the base branch nor in `shipped`, oldest first. */
  unshippedCommits(dir: string, baseBranch: string, shipped?: string): Promise<string[]>;
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
  /** A detached checkout of a pull request's head in the agent's workspace (for QA). Returns the commit ('' if unknown). */
  checkoutPullRequest(repo: string, agentId: string, number: number): Promise<string>;
}
