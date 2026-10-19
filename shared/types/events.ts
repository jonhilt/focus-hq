// What the server tells the browser: the snapshot it starts from, and the events after it.

import type { ReportCard } from '../ledger';
import type { PersonalEntry } from '../personalLog';
import type { Agent, BrowserFrame, TermLine } from './agents';
import type { IssueDraft } from './drafts';
import type { Board, GitHubStatus } from './github';
import type { PluginStates } from './plugins';
import type { StudioSession } from './studio';
import type { Preview, PreviewLog } from './previews';
import type { Project, Settings } from './projects';
import type { QaReview } from './qa';
import type { Usage } from './usage';
import type { VoiceStatus } from './voice';

export interface ServerInfo {
  mode: 'live' | 'demo';
  /** Commit the server runs. Browsers reload when it changes, so an auto update reaches the client too. */
  version: string;
  github: GitHubStatus;
  settings: Settings;
  deskCount: number;
  /** The plugins switched on (FOCUS_PLUGINS), by id. */
  plugins: string[];
  /** In a demo office, how fast its pretend agents go (1 is `pnpm run demo`'s; shared/demoPace.ts). */
  demoPace?: number;
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
  /** The studio holodeck's conversation, and the video and takes it's built. */
  studio: StudioSession;
  reviews: QaReview[];
  voice: VoiceStatus;
  /** The ledger's last 30 days, summed up for the chief engineer's screen. */
  report: ReportCard;
  /** Your plan's usage and how the office signs in, for main engineering. */
  usage: Usage;
  /** Each plugin's state, by plugin id (docs/plugins.md). */
  plugins: PluginStates;
  /** The captain's personal log, oldest first: everything in it, done and dropped included. */
  personalLog: PersonalEntry[];
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
  | { type: 'studio'; session: StudioSession }
  | { type: 'review'; review: QaReview }
  | { type: 'review-removed'; repo: string; number: number }
  | { type: 'report'; report: ReportCard }
  | { type: 'usage'; usage: Usage }
  /** A plugin's state changed. */
  | { type: 'plugin'; id: string; state: unknown }
  | { type: 'voice'; voice: VoiceStatus }
  /** The captain's personal log changed: all of it. */
  | { type: 'personal-log'; entries: PersonalEntry[] }
  /** projectId, or the agent's, lets the browser drop toasts about a hidden project. */
  | { type: 'toast'; level: 'info' | 'success' | 'error'; text: string; agentId?: string; projectId?: string };
