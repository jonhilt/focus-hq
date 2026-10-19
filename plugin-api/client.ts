// The plugin API's browser part (docs/plugins.md): the contract a plugin's client.ts default-exports, a read-only view
// of the office's state, its own routes, and the station's UI kit. The browser's own state and REST client stay the
// core's: a plugin reads what `office` shows and calls only its own routes.
import type { ReportCard } from '../shared/ledger';
import type { Agent, IssueDraft, Project, TermLine } from '../shared/types';
import type { KokoroVoice } from '../shared/voice';
import { api } from '../client/src/net/api';
import { state } from '../client/src/net/state';

export * from './shared';
export type { ClientPlugin, EngineeringGo, EngineeringPart, EngineeringView, GoalPart, GoalStrip, GoalTagPlace, HallHost, HudStat, HallScreen, PluginSpace, ScreenPart, ScreenView, ShipHost, ShipPart, StationSays } from '../client/src/plugins';
export { pluginState } from '../client/src/plugins';
export type { Ui } from '../client/src/ui/context';
export { busy, fill, h, timeAgo } from '../client/src/ui/dom';
export { confirmDialog } from '../client/src/ui/confirmDialog';
/** Starting an idea as a goal, or handing it to one under way (the goals list's own control). */
export { handOffControl } from '../client/src/ui/goals';
/** The captain's voice: dictating into a field, and talking with a crew member aloud. */
export { type MicMode, micPerRecording, withMic } from '../client/src/ui/dictation';
export { CrewSpeaker, voicePrefs, VoiceSession, voiceToggle } from '../client/src/ui/voiceMode';
/** The crew's voices: whether Kokoro's ready on this office, the browser's best voice for a language, and a line said in a Kokoro voice (a WAV). */
export { bestBrowserVoice, kokoroReady } from '../client/src/ui/crewVoice';
export const speak = (text: string, voice: KokoroVoice, signal: AbortSignal, urgency?: 'now' | 'ahead'): Promise<Blob> => api.speak(text, voice, signal, urgency);
/** Asks the captain how to pick a long conversation back up on your API key (a message's `costly` answer): undefined if they'd rather not. */
export { askResume } from '../client/src/ui/resume';
/** A crew member in 3D, and what they sit on and cast. */
export { Character, type CrewView } from '../client/src/world/character';
export { chair } from '../client/src/world/props';
export { contactShadow } from '../client/src/world/contactShadow';
export { type Seat, seatYaw } from '../client/src/world/layout';
export { Switch } from '../client/src/ui/panels';
/** Markdown made safe to show, and the station's bars of the open frictions. */
export { markdownHtml } from '../client/src/ui/terminal';
export { frictionBars } from '../client/src/ui/frictionBars';
/** The LCARS kit, for what a plugin draws on a canvas (the MSD, a goal board's strip, a hall's screen). */
export { canvasTexture, fitText, makeCanvas, UI_FONT } from '../client/src/world/canvas';
/** What a plugin's ship part needs to stand things in the holodeck and in a space of its own. */
export { OVERLAY_LAYER } from '../client/src/world/frame';
export { Hologram, hover } from '../client/src/world/hologram';
export { around, SPACE } from './layout';
export type { Place } from '../client/src/world/office';
export type { Box } from '../client/src/world/msd';
export { LCARS, LCARS_FONT, LCARS_STATUS } from '../client/src/world/starship';

/** The office as the browser has it now, read-only: what a plugin's views may show. */
export const office = {
  get projects(): readonly Project[] {
    return state.projects;
  },
  /** An agent by id, as the browser has them now. */
  agent: (id: string): Readonly<Agent> | undefined => state.agents.get(id),
  /** Every agent aboard, of every project, as the browser has them now. */
  get agents(): readonly Readonly<Agent>[] {
    return [...state.agents.values()];
  },
  /** The demo office: fake GitHub and scripted agents. */
  get demo(): boolean {
    return state.info?.mode === 'demo';
  },
  project: (id: string): Readonly<Project> | undefined => state.project(id),
  /** The issue draft waiting, or being written, at project `projectId`'s Ops station. */
  draft: (projectId: string): Readonly<IssueDraft> | undefined => state.drafts.get(projectId),
  /** Calls `fn` whenever the projects change; returns what stops it. */
  onProjects: (fn: () => void): (() => void) => state.on('projects', fn),
  /** Calls `fn` with each agent's new terminal lines as they come; returns what stops it. */
  onLines: (fn: (agentId: string, lines: readonly TermLine[]) => void): (() => void) => state.on('lines', ({ id, lines }) => fn(id, lines)),
  /** Asks project `projectId`'s Ops officer to write `idea` up as an issue (it waits at their station). */
  draftIssue: (projectId: string, idea: string): Promise<unknown> => api.draftIssue(projectId, idea),
  /** The ledger's report card as the office last sent it: none until it has. */
  get report(): Readonly<ReportCard> | null {
    return state.report;
  },
};

/** Calls `fn` whenever plugin `id`'s state changes in the browser; returns what stops it. */
export const onPluginState = (id: string, fn: () => void): (() => void) => state.on('plugin', (changed) => changed === id && fn());

/** Calls one of plugin `id`'s own routes (`/api/plugins/<id><path>`), POSTing `body`; rejects with the office's word on why. */
export const callPlugin = <T>(id: string, path: string, body?: unknown): Promise<T> => api.plugin<T>(id, path, body);
