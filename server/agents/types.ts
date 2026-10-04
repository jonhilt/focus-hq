import type { AgentStatus, BrowserFrame, Settings, TermLine } from '../../shared/types';

export interface RunHooks {
  lines(lines: Omit<TermLine, 't'>[]): void;
  /** status null = keep the current status. */
  activity(status: AgentStatus | null, activity: string): void;
  browser(frame: BrowserFrame): void;
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
}

export interface RunOutcome {
  ok: boolean;
  /** Claude's final message: becomes the pull request description. */
  summary: string;
  error?: string;
  aborted?: boolean;
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
  push(dir: string, branch: string): Promise<void>;
}
