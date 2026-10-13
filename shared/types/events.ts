// What the server tells the browser: the snapshot it starts from, and the events after it.

import type { ReportCard } from '../ledger';
import type { Agent, BrowserFrame, TermLine } from './agents';
import type { CallState, CallStatus } from './call';
import type { Climb } from './climb';
import type { IssueDraft } from './drafts';
import type { Board, GitHubStatus } from './github';
import type { NumberOneChat } from './numberOne';
import type { StudioSession } from './studio';
import type { Preview, PreviewLog } from './previews';
import type { Project, Settings } from './projects';
import type { QaReview } from './qa';
import type { Retro } from './retros';
import type { Scorecards } from './scorecard';
import type { Usage } from './usage';
import type { VoiceStatus } from './voice';

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
  numberOne: NumberOneChat;
  /** The studio holodeck's conversation, and the video and takes it's built. */
  studio: StudioSession;
  reviews: QaReview[];
  voice: VoiceStatus;
  /** Whether the office can take a call, and the one under way. */
  call: CallStatus;
  /** The ledger's last 30 days, summed up for the chief engineer's screen. */
  report: ReportCard;
  /** The chief engineer's latest retro. */
  retro: Retro;
  /** The latest scorecards, for main engineering. */
  scorecards: Scorecards;
  /** Your plan's usage and how the office signs in, for main engineering. */
  usage: Usage;
  /** Main engineering's climber: the captain's switch and the climb under way. */
  climb: Climb;
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
  | { type: 'studio'; session: StudioSession }
  | { type: 'review'; review: QaReview }
  | { type: 'review-removed'; repo: string; number: number }
  | { type: 'report'; report: ReportCard }
  | { type: 'retro'; retro: Retro }
  | { type: 'scorecards'; scorecards: Scorecards }
  | { type: 'usage'; usage: Usage }
  | { type: 'climb'; climb: Climb }
  | { type: 'voice'; voice: VoiceStatus }
  | { type: 'call'; call: CallState | null }
  /** projectId, or the agent's, lets the browser drop toasts about a hidden project. */
  | { type: 'toast'; level: 'info' | 'success' | 'error'; text: string; agentId?: string; projectId?: string };
