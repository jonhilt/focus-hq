import type { AgentStatus, BrowserFrame, Effort, Settings, TermLine } from '../../shared/types';

export interface RunHooks {
  lines(lines: Omit<TermLine, 't'>[]): void;
  /** status null = keep the current status. */
  activity(status: AgentStatus | null, activity: string): void;
  browser(frame: BrowserFrame): void;
  /** A screenshot the agent took on purpose (mcp__browser__screenshot), on top of the frame every action streams. */
  screenshot(frame: BrowserFrame): void;
  session(sessionId: string): void;
  cost(totalUsd: number): void;
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
  /**
   * Run in a Claude Code cloud session that works on `branch` and pushes it. `resumeSessionId` is then the cloud
   * session's id, and `systemAppend` goes into the first message.
   */
  cloud?: { branch: string };
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
  stop(): void;
  done: Promise<RunOutcome>;
}

export interface AgentRunner {
  start(req: RunRequest, hooks: RunHooks): AgentSession;
}

/** Git operations on an agent's checkout. Faked in demo mode. */
export interface WorkspaceOps {
  /** A worktree on `branch`, starting from the remote branch `startPoint`. */
  create(repo: string, agentId: string, branch: string, startPoint: string): Promise<string>;
  remove(repo: string, agentId: string): Promise<void>;
  dir(agentId: string): string;
  hasUncommittedChanges(dir: string): Promise<boolean>;
  commitsAhead(dir: string, baseBranch: string): Promise<number>;
  /** The commit checked out in `dir`. */
  head(dir: string): Promise<string>;
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
