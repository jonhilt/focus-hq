// What the server tells the browser: the snapshot it starts from, and the events after it.

import type { ReportCard } from '../ledger';
import type { PersonalEntry } from '../personalLog';
import type { AvailablePlugin, PluginsPinnedBy } from '../shipPlugins';
import type { Agent, BrowserFrame, TermLine } from './agents';
import type { BotStatus } from './bot';
import type { IssueDraft } from './drafts';
import type { Board, GitHubStatus } from './github';
import type { PluginStates } from './plugins';
import type { Preview, PreviewLog } from './previews';
import type { PinnedSettings, Project, Settings } from './projects';
import type { QaReview } from './qa';
import type { VoiceStatus } from './voice';

export interface ServerInfo {
  mode: 'live' | 'demo';
  /** Commit the server runs. Browsers reload when it changes, so an auto update reaches the client too. */
  version: string;
  github: GitHubStatus;
  /** The captain's settings, with any an environment variable sets (`settingsPinned`) as it sets them. */
  settings: Settings;
  /** The settings an environment variable sets, each by its name: the browser can't change them. */
  settingsPinned: PinnedSettings;
  deskCount: number;
  /** The plugins switched on, by id. */
  plugins: string[];
  /** How the plugins switched on for the whole ship were chosen, for the ready room's Plugins tab to change them. */
  shipPlugins: ShipPlugins;
  /** A bot speaking for the captain: where each of its settings comes from (none of its secrets). */
  bot: BotStatus;
  /** In a demo ship, how fast its pretend agents go (1 is `pnpm run demo`'s; shared/demoPace.ts). */
  demoPace?: number;
}

export interface ShipPlugins {
  /** What keeps the captain's choice (`Settings.plugins`) from deciding, if anything. */
  pinnedBy: PluginsPinnedBy | null;
  /** The plugins Focus started with, by id: when the captain's choice differs, it waits on a restart. */
  startedWith: string[];
  /** Every plugin of Focus's own, and what each requires. */
  available: AvailablePlugin[];
  /** Focus runs under its supervisor (`pnpm start`, `pnpm run dev`), so it can restart itself from the browser. */
  canRestart: boolean;
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
  reviews: QaReview[];
  voice: VoiceStatus;
  /** The ledger's last 30 days, summed up for the chief engineer's screen. */
  report: ReportCard;
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
  | { type: 'review'; review: QaReview }
  | { type: 'review-removed'; repo: string; number: number }
  | { type: 'report'; report: ReportCard }
  /** A plugin's state changed. */
  | { type: 'plugin'; id: string; state: unknown }
  | { type: 'voice'; voice: VoiceStatus }
  /** The captain's personal log changed: all of it. */
  | { type: 'personal-log'; entries: PersonalEntry[] }
  /** projectId, or the agent's, lets the browser drop toasts about a hidden project. */
  | { type: 'toast'; level: 'info' | 'success' | 'error'; text: string; agentId?: string; projectId?: string };
