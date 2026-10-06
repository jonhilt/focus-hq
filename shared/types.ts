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
  /** How the board's Merge button, and auto-merge, merge a pull request. */
  mergeMethod: 'squash' | 'merge' | 'rebase';
  /** Pull requests and QA reports on GitHub name the agent who did the work and mention Focus. */
  attribution: boolean;
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
  /** PRs the office opened merge by themselves once QA passed their head commit and checks are green (missing = off). */
  autoMerge?: boolean;
  /** What QA must check on every PR of this project, on top of the usual review. Goes into the QA officer's prompt. */
  qaBrief?: string;
  createdAt: number;
}

/**
 * Shell commands for ▶ Preview, run in the PR's checkout. Placeholders: {dir} (the PR's checkout), {dir:<repo>} (that
 * repo's checkout, at the repo's chosen PR: the clicked one, a PR linked to it through a feature label, or one picked in
 * the preview panel; else its default branch), {port}, {pr}, {repo}.
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
  /** The office closed a PR for it because the approach was wrong, so it's open for another go. */
  closedPr?: ClosedPr;
}

/** A PR the room's operations officer closed, remembered on the issue it was meant to close. */
export interface ClosedPr {
  repo: string;
  issue: number;
  pr: number;
  officer: string;
  /** What was wrong with the approach, for whoever builds it next. */
  note: string;
  at: number;
}

export type ChecksState = 'passing' | 'failing' | 'pending' | 'none';

/** A check on a pull request that failed. */
export interface FailedCheck {
  name: string;
  url?: string;
  /** The GitHub Actions run it's part of, which `gh run rerun --failed` can re-run. Missing for other CI. */
  runId?: number;
}

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
  /** The checks that failed, while `checks` is 'failing'. */
  failedChecks: FailedCheck[];
  /** Issues in the same repo it closes ("Closes #N", or linked on GitHub). */
  closes: number[];
  createdAt: string;
  /** Last activity on GitHub. Missing when the provider can't tell. */
  updatedAt?: string;
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
 * pull request that failed QA, (the room's QA officer) a pull request to review and test, or (the project's lead) the
 * captain's own Claude Code session across all the project's repos.
 */
export type AgentTask = 'issue' | 'conflicts' | 'fix' | 'review' | 'lead';

/** The QA officer doesn't sit at one of the room's desks but at the QA station by the pull requests table. */
export const QA_DESK = -1;

/** Nor does the project's lead, who has the group desk. */
export const LEAD_DESK = -2;

/** A pull request the project's lead shipped, and what became of it. */
export interface LeadPr {
  repo: string;
  number: number;
  url: string;
  /** The commit last shipped to it, so shipping again leaves it alone until there's something new. */
  sha?: string;
  /** Missing while it's open. */
  outcome?: 'merged' | 'closed';
}

/** A subagent the project's lead handed a piece of work to (Claude Code's Agent tool), seated at the group desk while it works. */
export interface Helper {
  /** The Agent tool call that started it. */
  id: string;
  /** What the lead asked of it, in a few words. */
  description: string;
  /** The subagent type (general-purpose, Explore, …), when Claude Code says. */
  type?: string;
  status: 'working' | 'done' | 'failed';
  /** What it's doing right now, or how it finished. */
  activity: string;
  startedAt: number;
}

/**
 * The project's lead at work: every repo of the project checked out side by side on the slice's branch, and the pull
 * requests the slice shipped. Once they've all merged or closed, the next slice starts on fresh code.
 */
export interface LeadWork {
  /** Each repo, checked out at ./<folder> in the lead's workspace, and the branch it ships into. */
  repos: { repo: string; folder: string; baseBranch: string }[];
  /** Which slice this is: 1, 2, … */
  slice: number;
  prs: LeadPr[];
}

export interface Agent {
  id: string;
  name: string;
  avatar: Avatar;
  projectId: string;
  repo: string;
  task: AgentTask;
  /** The project's lead's repos and pull requests ('lead' task only). */
  lead?: LeadWork;
  /** The subagents the lead has working for it right now, and any that just finished ('lead' task only). */
  helpers?: Helper[];
  /** For a 'conflicts' or 'fix' task, the pull request itself (GitHub numbers issues and PRs alike). */
  issue: { number: number; title: string; url: string };
  /** Chosen when the agent is hired. Missing = the model's default effort. */
  effort?: Effort;
  /**
   * Works in a Claude Code cloud session instead of on this machine: it pushes its own branch, and `sessionId` is the
   * cloud session's id (session_…). Never set on the QA officer.
   */
  cloud?: boolean;
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

/** Which pull request each repository of a project runs in a preview: its number, or null for the default branch. */
export type PreviewSet = Record<string, number | null>;

export type PreviewRef = { pr: number } | { branch: string };

/** One repository a preview checked out (or is about to). */
export interface PreviewCheckout {
  repo: string;
  ref: PreviewRef;
  /** Missing until it's fetched. Differs from the PR's headSha once someone pushes again. */
  sha?: string;
}

/** Pull requests running on this machine so the manager can try them in their own browser. One per project at a time. */
export interface Preview {
  projectId: string;
  repo: string;
  /** The pull request being previewed: the one ▶ Preview was clicked on. */
  number: number;
  title: string;
  /** Commit of `number` that is checked out. */
  sha?: string;
  /** Every repository's choice, the clicked PR's included. Restart runs the same set again. */
  set: PreviewSet;
  /** The repositories the preview command uses, at their choice from `set`, filled in once the preview has worked them out. */
  checkouts: PreviewCheckout[];
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
  /** Why the planner thinks the idea is too big or too vague for one issue, when they do: the card offers the project's lead. */
  tooBig?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  costUsd?: number;
}

/** Work Number One suggests a chat turn into: the captain sends it to the project's stand or to its lead. */
export interface WorkSuggestion {
  projectId: string;
  idea: string;
}

export interface NumberOneMessage {
  from: 'manager' | 'number-one';
  text: string;
  /** Number One's reply in a line or two, without paths or code. */
  spoken?: string;
  suggest?: WorkSuggestion;
  at: number;
}

/** thinking - Number One is reading or composing a reply; waiting - your turn; failed - the last turn went wrong (say something to try again). */
export type NumberOneStatus = 'thinking' | 'waiting' | 'failed';

/**
 * The captain's chat with Number One, the ship's first officer: questions about any project's code, the ship's live
 * state, or anything else. Read-only: it never turns into work by itself. One conversation, saved across restarts.
 */
export interface NumberOneChat {
  status: NumberOneStatus;
  /** What Number One is doing right now. */
  activity: string;
  messages: NumberOneMessage[];
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
  /** A caption for each screenshot they took on purpose (mcp__browser__screenshot), in the order they took them. */
  captions: string[];
}

/** A screenshot from a QA review, kept as evidence with the report. */
export interface QaScreenshot {
  caption: string;
  /** The image as the office keeps it, served at /api/qa-shots/<file>. */
  file: string;
  /** The image on the repo's QA evidence branch. Missing if the upload failed. */
  url?: string;
}

export type QaStatus = 'queued' | 'testing' | 'passed' | 'failed' | 'error';

/** What a developer was sent back to fix: QA's findings, or the PR's checks failing on GitHub after QA passed it. */
export type FixFor = { kind: 'qa' } | { kind: 'checks'; checks: FailedCheck[] };

/**
 * What the office did about a failed PR it opened: a developer is on it, the room's operations officer is working out
 * why it's stuck, or it gave up and wants you.
 */
export type QaFollowUp =
  | { kind: 'fixing'; agentId: string; agentName: string; fixes: FixFor }
  | { kind: 'triaging'; officer: string; activity: string }
  | { kind: 'needs-you'; reason: string };

/** What the operations officer can do about a stuck PR. */
export type TriageAction = 'retry-qa' | 'send-back' | 'rerun-checks' | 'close' | 'escalate';

/** What the operations officer did about a stuck PR, and why (on an escalation, their diagnosis). */
export interface Triage {
  officer: string;
  action: TriageAction;
  note: string;
  at: number;
}

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
  /** The screenshots that go with the report, in the order they were taken. */
  screenshots?: QaScreenshot[];
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
  /** Times the operations officer has looked at this PR because it was stuck (missing = never). */
  triages?: number;
  /** What they did the last time. */
  triage?: Triage;
  /** Why it's back with QA, when the operations officer sent it back: for the QA officer, this round only. */
  retryNote?: string;
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

/** A speech model download in progress, or the last one that failed. */
export type VoiceDownload = { state: 'running'; bytes: number; total?: number } | { state: 'failed'; error: string };

/**
 * Kokoro, the crew's voices: idle until voice mode (or Settings) asks for it, then loading (downloading
 * the model first, once) and ready, or failed.
 */
export type SpeechEngine =
  | { state: 'idle' }
  | { state: 'loading'; bytes: number; total?: number }
  | { state: 'ready' }
  | { state: 'failed'; error: string };

export interface SpeechStatus {
  /** Whether the model is on this machine, in `path`. */
  downloaded: boolean;
  path: string;
  engine: SpeechEngine;
}

/** Whether dictation can run (whisper.cpp's CLI and its model, both on this machine), and the crew's voices. */
export interface VoiceStatus {
  /** `command` is the resolved path when found, otherwise what was looked for. */
  whisper: { found: boolean; command: string };
  model: { present: boolean; path: string };
  download?: VoiceDownload;
  speech: SpeechStatus;
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
  numberOne: NumberOneChat;
  reviews: QaReview[];
  voice: VoiceStatus;
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
  | { type: 'number-one'; chat: NumberOneChat }
  | { type: 'review'; review: QaReview }
  | { type: 'review-removed'; repo: string; number: number }
  | { type: 'voice'; voice: VoiceStatus }
  | { type: 'toast'; level: 'info' | 'success' | 'error'; text: string; agentId?: string };

export const DESKS_PER_ROOM = 6;
