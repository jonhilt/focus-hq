// Types shared between the server and the browser client.

export type AgentStatus =
  | 'queued' // hired, waiting for a free slot
  | 'setting-up' // cloning the repo / creating a worktree
  | 'working' // Claude is coding
  | 'testing' // Claude is driving the browser
  | 'waiting' // hand raised: needs the manager to approve a tool call
  | 'pushing' // pushing the branch and opening the pull request
  | 'done' // pull request is open
  | 'error'
  | 'stopped';

export const ACTIVE_STATUSES: AgentStatus[] = ['setting-up', 'working', 'testing', 'waiting', 'pushing'];

export type Autonomy = 'ask' | 'auto' | 'full';

export interface Settings {
  /** Max agents running at once across every project (protects your subscription limits). */
  maxConcurrent: number;
  /**
   * ask  - edits and common dev commands run freely, anything else makes the agent raise its hand.
   * auto - Claude Code's auto mode classifier decides.
   * full - bypass all permission checks.
   */
  autonomy: Autonomy;
  /** Claude model for agents. Empty = Claude Code's default for your account. */
  model: string;
  /** Agents auto-merge nothing; this is the merge method used by the board's Merge button. */
  mergeMethod: 'squash' | 'merge' | 'rebase';
}

export interface Project {
  id: string;
  name: string;
  color: string;
  /** GitHub repositories as "owner/name". */
  repos: string[];
  /** How many agents may work on this project at the same time (the room always has DESKS_PER_ROOM desks). */
  maxAgents: number;
  /** Automatically hire agents for open issues when desks are free. */
  autoAssign: boolean;
  /** When auto-assigning, only pick issues carrying this label (empty = any issue). */
  autoLabel: string;
  createdAt: number;
}

export interface Issue {
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  author?: string;
  createdAt: string;
}

export type ChecksState = 'passing' | 'failing' | 'pending' | 'none';

export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  url: string;
  branch: string;
  author?: string;
  isDraft: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  reviewDecision?: string;
  checks: ChecksState;
  createdAt: string;
}

export interface Board {
  projectId: string;
  issues: Issue[];
  prs: PullRequest[];
  updatedAt: number;
  error?: string;
}

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

export interface Avatar {
  shirt: string;
  hair: string;
  skin: string;
  accessory: 'none' | 'glasses' | 'headphones' | 'cap' | 'bow';
}

export interface PermissionRequest {
  id: string;
  tool: string;
  summary: string;
  at: number;
}

export interface Agent {
  id: string;
  name: string;
  avatar: Avatar;
  projectId: string;
  repo: string;
  issue: { number: number; title: string; url: string };
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

export interface GitHubStatus {
  ok: boolean;
  login?: string;
  error?: string;
}

export interface ServerInfo {
  mode: 'live' | 'demo';
  github: GitHubStatus;
  settings: Settings;
  deskCount: number;
}

export interface Snapshot {
  info: ServerInfo;
  projects: Project[];
  agents: Agent[];
  boards: Board[];
  /** Recent terminal lines per agent id. */
  lines: Record<string, TermLine[]>;
  browser: Record<string, BrowserFrame>;
}

export type ServerEvent =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'info'; info: ServerInfo }
  | { type: 'projects'; projects: Project[] }
  | { type: 'agent'; agent: Agent }
  | { type: 'agent-removed'; id: string }
  | { type: 'lines'; id: string; lines: TermLine[] }
  | { type: 'browser'; id: string; frame: BrowserFrame | null }
  | { type: 'board'; board: Board }
  | { type: 'toast'; level: 'info' | 'success' | 'error'; text: string; agentId?: string };

export const DESKS_PER_ROOM = 6;
