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

/**
 * What a room's walls show. Every theme but 'office' turns the walls and ceiling into a window on a
 * landscape built around the room, so the desks look like they sit in the middle of it.
 */
export const ROOM_THEMES = ['beach', 'forest', 'desert', 'moon', 'city', 'library', 'office'] as const;
export type RoomTheme = (typeof ROOM_THEMES)[number];

export interface Project {
  id: string;
  name: string;
  color: string;
  /** Scenery around the room. Missing on projects made before themes existed; the client then picks one from the id. */
  theme?: RoomTheme;
  /** GitHub repositories as "owner/name". */
  repos: string[];
  /** How many agents may work on this project at the same time (the room always has DESKS_PER_ROOM desks). */
  maxAgents: number;
  /** Automatically hire agents for open issues when desks are free. */
  autoAssign: boolean;
  /** When auto-assigning, only pick issues carrying this label (empty = any issue). */
  autoLabel: string;
  /** Board shows only PRs you (the gh account) or your agents opened, hiding teammates' PRs. */
  onlyMyPrs?: boolean;
  /** How ▶ Preview runs this project's pull requests. */
  preview?: PreviewConfig;
  /** The QA officer tests every PR the office opens or updates (missing = on). */
  autoQa?: boolean;
  /** A PR the office opened that fails QA goes back to a developer to fix (missing = on). */
  autoSendBack?: boolean;
  /** What QA must check on every PR of this project, on top of the usual review. Goes into the QA officer's prompt. */
  qaBrief?: string;
  createdAt: number;
}

/**
 * Shell commands for ▶ Preview, run in the PR's checkout. Placeholders: {dir} (the PR's checkout), {dir:<repo>} (that
 * repo's checkout: the PR's code if the PR is in it, else its default branch), {port}, {pr}, {repo}.
 */
export interface PreviewConfig {
  /** Starts the site(s). Empty = install and run the package.json dev script of the PR's repo. */
  command?: string;
  /** Tears down what `command` left running (containers, background servers). Runs on stop and before every start. */
  stopCommand?: string;
  /**
   * Polled while starting. Its JSON is this stack's state or a list of stacks ({"sessions": [...]}, ours is the one
   * mentioning our checkouts); its "phase" shows as progress, and a listed stack dropping out fails the preview.
   */
  statusCommand?: string;
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
  /** Commit at the head of the PR branch. */
  headSha?: string;
  baseBranch: string;
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
 * pull request that failed QA, or (the room's QA officer) a pull request to review and test.
 */
export type AgentTask = 'issue' | 'conflicts' | 'fix' | 'review';

/** The QA officer doesn't sit at one of the room's desks but at the QA station by the pull requests table. */
export const QA_DESK = -1;

export interface Agent {
  id: string;
  name: string;
  avatar: Avatar;
  projectId: string;
  repo: string;
  task: AgentTask;
  /** For a 'conflicts' or 'fix' task, the pull request itself (GitHub numbers issues and PRs alike). */
  issue: { number: number; title: string; url: string };
  /** Chosen when the agent is hired. Missing = the model's default effort. */
  effort?: Effort;
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

export type PreviewStatus = 'starting' | 'running' | 'failed' | 'stopping';

export interface PreviewLink {
  /** e.g. "web" when the command printed JSON like {"urls": {"web": "http://…"}}. */
  name?: string;
  url: string;
  /** Last check: answering, answering with a 5xx, or not answering at all. */
  health?: 'up' | 'error' | 'down';
  /** HTTP status of the last check. */
  code?: number;
}

/** A log file in the folder a preview command reported as "logs". */
export interface PreviewLogFile {
  name: string;
  size: number;
  modified: number;
}

/** A pull request running on this machine so the manager can try it in their own browser. One per project at a time. */
export interface Preview {
  projectId: string;
  repo: string;
  /** The pull request being previewed. */
  number: number;
  title: string;
  /** Commit that is checked out. Differs from the PR's headSha once someone pushes again. */
  sha?: string;
  status: PreviewStatus;
  /** What it's doing right now ("Installing dependencies", "Up at http://localhost:5173/"…). */
  activity: string;
  /** The command line that runs the site(s). */
  command?: string;
  /** Free port offered to the command as {port} and $FOCUS_PREVIEW_PORT. */
  port?: number;
  /** Local sites the command brought up. The first one is the main link. */
  links: PreviewLink[];
  /** Where the command keeps its own logs, if it said so in its JSON output. */
  logs?: string;
  /** Up, but not happily: e.g. the command exited 1 reporting the stack as "unhealthy". */
  warning?: string;
  startedAt: number;
  error?: string;
}

/** A stretch of a preview's output. `first` numbers the first line since the preview started, so pieces can be stitched. */
export interface PreviewLog {
  startedAt: number;
  first: number;
  lines: string[];
}

/** The crew member at a room's ＋ New issue stand who turns a rough idea into a well-specified issue. One per project. */
export interface Planner {
  name: string;
  avatar: Avatar;
}

export type DraftStatus = 'drafting' | 'ready' | 'failed';

/**
 * An issue the planner is writing, or has written, for a project. Lives in memory until it's filed or discarded, so it
 * waits at the stand if you walk away. One per project at a time.
 */
export interface IssueDraft {
  projectId: string;
  status: DraftStatus;
  /** The manager's rough idea, as they typed it. */
  idea: string;
  /** What the planner is doing right now ("Reading src/cart.ts"). */
  activity: string;
  /** The project repository the planner thinks the issue belongs in. */
  repo?: string;
  title?: string;
  /** Markdown: context, what to build, acceptance criteria, out of scope, assumptions. */
  body?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  costUsd?: number;
}

/** The brief a briefing builds up, shown on the observation lounge's wall screen. One line per entry. */
export interface Brief {
  /** What we're building, in a sentence. */
  summary: string;
  /** The problem it solves and why it matters now. */
  why: string;
  /** Who it's for. */
  who: string;
  scope: string[];
  outOfScope: string[];
  acceptance: string[];
  openQuestions: string[];
}

export const EMPTY_BRIEF: Brief = { summary: '', why: '', who: '', scope: [], outOfScope: [], acceptance: [], openQuestions: [] };

export interface BriefingMessage {
  from: 'manager' | 'officer' | 'system';
  text: string;
  at: number;
}

/**
 * thinking - the officer is reading code or composing a reply; waiting - your turn; wrapping-up - writing the issue;
 * done - the issue is at the project's stand; failed - the last turn went wrong (say something to try again).
 */
export type BriefingStatus = 'thinking' | 'waiting' | 'wrapping-up' | 'done' | 'failed';

/**
 * A back-and-forth in the observation lounge between the manager and a project's operations officer about a bigger
 * or fuzzier feature, ending in one well-specified issue. One at a time, saved across restarts.
 */
export interface Briefing {
  id: string;
  projectId: string;
  /** What the manager called the briefing about. */
  idea: string;
  status: BriefingStatus;
  /** What the officer is doing right now. */
  activity: string;
  messages: BriefingMessage[];
  brief: Brief;
  startedAt: number;
  updatedAt: number;
  costUsd: number;
  error?: string;
}

export interface QaCheck {
  name: string;
  result: 'pass' | 'fail' | 'skip';
  /** What they did and what they saw. */
  details: string;
}

/** The QA officer's verdict on one pull request, as they report it at the end of their session. */
export interface QaReport {
  verdict: 'pass' | 'fail';
  summary: string;
  /** Each acceptance criterion, review point or scenario checked. */
  checks: QaCheck[];
  /** Test suites, builds and other commands run, with what came out. */
  commands: { command: string; result: string }[];
  /** On a fail: what the developer should fix. */
  fixInstructions?: string;
}

export type QaStatus = 'queued' | 'testing' | 'passed' | 'failed' | 'error';

/** What the office did about a failed verdict on a PR it opened: a developer is on it, or it gave up and wants you. */
export type QaFollowUp = { kind: 'fixing'; agentId: string; agentName: string } | { kind: 'needs-you'; reason: string };

/** The latest QA review of a pull request. Kept until the PR is merged or closed. */
export interface QaReview {
  projectId: string;
  repo: string;
  number: number;
  title: string;
  status: QaStatus;
  /** The commit QA checked out and tested. */
  sha?: string;
  report?: QaReport;
  /** The QA report posted on the pull request. */
  commentUrl?: string;
  /** The QA officer's session for this review, while their record is around. */
  agentId?: string;
  error?: string;
  /** An agent of the office opened the PR, so a failed verdict may go back to a developer. Teammates' PRs never do. */
  openedByOffice?: boolean;
  /** Rounds of QA this PR has failed so far, this one included once it's in (missing = none). */
  failedRounds?: number;
  /** The round before this one, so a re-test checks those findings first and focuses on what changed since. */
  lastRound?: { sha?: string; report: QaReport };
  followUp?: QaFollowUp;
  requestedAt: number;
  finishedAt?: number;
}

export interface GitHubStatus {
  ok: boolean;
  login?: string;
  error?: string;
}

export interface ServerInfo {
  mode: 'live' | 'demo';
  /** Commit the server runs. Browsers reload when it changes, so an auto update reaches the client too. */
  version: string;
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
  previews: Preview[];
  drafts: IssueDraft[];
  briefing: Briefing | null;
  reviews: QaReview[];
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
  | { type: 'preview'; projectId: string; preview: Preview | null }
  | { type: 'preview-log'; projectId: string; log: PreviewLog }
  | { type: 'draft'; projectId: string; draft: IssueDraft | null }
  | { type: 'briefing'; briefing: Briefing | null }
  | { type: 'review'; review: QaReview }
  | { type: 'review-removed'; repo: string; number: number }
  | { type: 'toast'; level: 'info' | 'success' | 'error'; text: string; agentId?: string };

export const DESKS_PER_ROOM = 6;
