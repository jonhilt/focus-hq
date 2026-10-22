// The plugin API's part for the 3D ship's browser page (docs/plugins.md): the contract a plugin's client.ts
// default-exports, a read-only view of Focus's state and its own routes (browser.ts, shared with the phone's), and the
// station's UI kit.
import type { KokoroVoice } from '../shared/voice';
import { api } from '../client/src/net/api';

export * from './shared';
export * from './browser';
export type { ClientPlugin, EngineeringGo, EngineeringPart, EngineeringView, GoalPart, GoalStrip, GoalTagPlace, HallHost, HudStat, HallScreen, PluginSpace, ScreenPart, ScreenView, ShipHost, ShipPart, StationSays } from '../client/src/plugins';
export { goalTags, pluginState } from '../client/src/plugins';
export type { Ui } from '../client/src/ui/context';
export { busy, fill, h, timeAgo } from '../client/src/ui/dom';
export { confirmDialog } from '../client/src/ui/confirmDialog';
/** Starting an idea as a goal, or handing it to one under way (the goals list's own control). */
export { handOffControl } from '../client/src/ui/goals';
/**
 * Answering an agent as the captain, as their panel does, each asking first what their panel asks (carrying on on the
 * API key, closing a goal that would leave work behind); Ops hears each as the captain's answer (`captainAnswered`).
 */
export { answerLead, messageAgent } from '../client/src/ui/resume';
export { closeGoal } from '../client/src/ui/goals';
export const allowTool = (agentId: string, requestId: string, allow: boolean): Promise<unknown> => api.permission(agentId, requestId, allow);
/** Whether agent `id`'s panel is open: the captain's looking at them. */
export { agentPanelOpen } from '../client/src/ui/agentPanel';
/** The captain's voice: dictating into a field, and talking with a crew member aloud. */
export { type MicMode, micPerRecording, withMic } from '../client/src/ui/dictation';
export { CrewSpeaker, voicePrefs, VoiceSession, voiceToggle } from '../client/src/ui/voiceMode';
/** The crew's voices: whether Kokoro's ready on this ship, the browser's best voice for a language, and a line said in a Kokoro voice (a WAV). */
export { bestBrowserVoice, kokoroReady } from '../client/src/ui/crewVoice';
export const speak = (text: string, voice: KokoroVoice, signal: AbortSignal, urgency?: 'now' | 'ahead'): Promise<Blob> => api.speak(text, voice, signal, urgency);
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
export type { Place } from '../client/src/world/ship';
export type { Box } from '../client/src/world/msd';
export { LCARS, LCARS_FONT, LCARS_STATUS } from '../client/src/world/starship';
