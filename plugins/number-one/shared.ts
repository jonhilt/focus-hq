// Number One: the plugin's state, as its server part keeps it and the browser shows it, and who Number One
// is: their name, look and voice.
import { type CrewVoice, fixedCrew, type Planner } from '../../plugin-api/shared';

/** The plugin's id: in FOCUS_PLUGINS, its state's key and its routes' prefix. */
export const NUMBER_ONE = 'number-one';

/**
 * Number One, the ship's first officer in the ready room: one for the whole ship, who talks anything through with the
 * captain, reading any project's code and the ship's live state. Command, like the captain, and a commander: the look
 * is rolled from the same key it always was.
 */
export function numberOne(): Planner {
  return { ...fixedCrew(NUMBER_ONE, 'command', 'lieutenant', 'Adair'), name: 'Cmdr. Adair' };
}

/** Number One's voice in voice mode: one of the officers' British voices, at a pitch of their own, so they never sound like a room's crew. */
export const NUMBER_ONE_VOICE: CrewVoice = { kokoro: 'bm_george', lang: 'en-GB', pitch: 0.9 };

// ---------------------------------------------------------------- the chat

/** Work Number One suggests a chat turn into: the captain sends it to the project's Ops station or to its lead. */
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
  /** What Number One jotted down in the captain's personal log, as the captain asked. */
  logged?: string;
  at: number;
}

/** thinking - Number One is reading or composing a reply; waiting - your turn; failed - the last turn went wrong (say something to try again). */
export type NumberOneStatus = 'thinking' | 'waiting' | 'failed';

/**
 * The captain's chat with Number One, the ship's first officer: questions about any project's code, the ship's live
 * state, or anything else. Read-only: it never turns into work by itself. One conversation, saved across restarts, with
 * the session it resumes (`sessionId`).
 */
export interface NumberOneChat {
  status: NumberOneStatus;
  /** What Number One is doing, as of the chat's last change (`NumberOneState.activity` says what they're doing right now). */
  activity: string;
  messages: NumberOneMessage[];
  updatedAt: number;
  costUsd: number;
  error?: string;
  /** Number One's Claude Code session, so the next message resumes it. */
  sessionId?: string;
}

export const freshChat = (): NumberOneChat => ({ status: 'waiting', activity: '', messages: [], updatedAt: Date.now(), costUsd: 0 });

/** The saved chat as it picks up after a restart: a turn in flight when Focus shut down ends, and the chat stays usable. */
export function chatAfterRestart(saved: NumberOneChat): NumberOneChat {
  if (saved.status !== 'thinking') return saved;
  return { ...saved, status: 'failed', activity: 'Interrupted', error: 'Interrupted when Focus shut down. Ask again.' };
}

// ---------------------------------------------------------------- calls

// Calls: the captain talking to Number One hands-free. OpenAI's gpt-live-1 holds the conversation, Jev picks what the
// captain asked for, and a state machine keeps each task on rails.

/** Where a call's task stands: the machine's state, for the captain to see. */
export type CallStep = 'listening' | 'routing' | 'confirming' | 'dictating' | 'acting' | 'ended';

/** A line of the call's captions: the captain, the ship's voice, or a note from Ops on what it did. */
export interface CallLine {
  who: 'captain' | 'ship' | 'office';
  text: string;
  at: number;
}

export interface CallState {
  /** The Live session's id. */
  id: string;
  step: CallStep;
  /** What waits on the captain's yes, as the ship asked it. */
  pending?: string;
  /** What the call is talking through, once the voice model's been briefed. */
  topic?: string;
  /** What the ship is waiting for the captain's words on: a new goal, or a message for a lead. */
  capture?: string;
  lines: CallLine[];
  /** Why the call ended, when it ended badly. */
  error?: string;
}

/** Whether Ops can take a call (both keys set), and the call under way, if any. */
export interface CallStatus {
  /** Why it can't, worded for the Call button's tooltip; undefined when it can. */
  missing?: string;
  call: CallState | null;
}

// ---------------------------------------------------------------- the plugin's state

/** What's saved in state.json: the chat. */
export interface NumberOneSaved {
  chat: NumberOneChat;
}

/** What isn't saved, since it changes too often or means nothing after a restart: what Number One is doing this moment, and the call. */
export interface NumberOneLive {
  /** What Number One is doing right now while they think: empty when the chat's own `activity` says it. */
  activity: string;
  call: CallStatus;
}

/** The plugin's state as the browser has it: both, side by side (their keys never meet). */
export type NumberOneState = NumberOneSaved & NumberOneLive;

/** The chat as it stands this moment: what Number One is doing now, while they think, over what was saved. */
export function chatNow(state: Partial<NumberOneState> | undefined): NumberOneChat | null {
  const chat = state?.chat;
  if (!chat) return null;
  return chat.status === 'thinking' && state.activity ? { ...chat, activity: state.activity } : chat;
}
