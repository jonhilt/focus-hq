import { type CallLine, type CallState, type CallStatus, type CallStep, numberOne, type NumberOneChat, type NumberOneMessage } from './shared';
import { type CrewView } from '../../plugin-api/client';

/** Number One's bubble: thinking with what they're doing, waiting for you to start or to answer, or lost the thread. */
export function numberOneView(chat: NumberOneChat | null): CrewView {
  const crew = numberOne();
  const base = { name: crew.name, avatar: crew.avatar, tag: 'XO' };
  switch (chat?.status) {
    case 'thinking':
      return { ...base, status: 'working', icon: '💭', line: chat.activity, thinking: true };
    case 'failed':
      return { ...base, status: 'error', line: 'Lost the thread – say again?' };
    case 'waiting':
    case undefined:
      return chat?.messages.length
        ? { ...base, status: 'waiting', icon: '🖖', line: 'Your turn' }
        : { ...base, status: 'waiting', line: 'Ready when you are' };
  }
}

/**
 * What to say when a reply Number One was thinking over lands (`before` is how the chat stood until now): an answer, or
 * that they lost the thread. Nothing for anything else.
 */
export function replyNews(before: NumberOneChat['status'] | undefined, chat: NumberOneChat | null): { level: 'info' | 'error'; text: string } | null {
  if (before !== 'thinking' || !chat || chat.status === 'thinking') return null;
  const name = numberOne().name;
  return chat.status === 'waiting' ? { level: 'info', text: `🖖 ${name} has an answer for you` } : { level: 'error', text: `${name} lost the thread: ${chat.error ?? ''}` };
}

const STEP: Record<CallStep, string> = {
  listening: 'Listening',
  routing: 'Working it out…',
  confirming: 'Waiting for your yes',
  dictating: 'Waiting for your words',
  acting: 'Doing it…',
  ended: 'Call ended',
};

/** What the strip says the call is doing. */
export function stepLabel(call: Pick<CallState, 'step' | 'pending'>): string {
  return call.step === 'routing' && call.pending ? 'Checking your answer…' : STEP[call.step];
}

const DIAL_TITLE = 'Talk to Number One hands-free: ask how things stand, start the next queued goal, or talk a goal or a project through and make it a goal';

/**
 * Number One's call strip: the Call button (greyed, with why, until Ops can take one) and the last call's
 * captions; or, while a call is on (placed here or on another screen), how it's going and what waits on the captain.
 */
export type CallStrip =
  | { kind: 'idle'; canDial: boolean; dialTitle: string; ended: { note: string; error: boolean; lines: CallLine[] } | null }
  | { kind: 'live'; id: string; step: CallStep; label: string; topic: string | null; pending: string | null; capture: string | null; lines: CallLine[] };

/** What the call strip shows, from whether Ops can take a call and the call under way (or the last one). */
export function callStrip(status: CallStatus | undefined): CallStrip {
  const call = status?.call;
  if (call && call.step !== 'ended') {
    return {
      kind: 'live', id: call.id, step: call.step, label: `📞 ${stepLabel(call)}`, lines: call.lines,
      topic: call.topic ? `Talking through: ${call.topic}` : null,
      pending: call.pending ? `${call.pending} Say yes, or make it so.` : null,
      capture: call.capture || null,
    };
  }
  const ended = call?.lines.length ? { note: call.error ?? 'The last call:', error: !!call.error, lines: call.lines } : null;
  return { kind: 'idle', canDial: !!status && !status.missing, dialTitle: status?.missing ?? DIAL_TITLE, ended };
}

/** Whether the call this browser is on (`mine`, by id) is over: Ops has no call, a different one, or this one ended. */
export function callOver(mine: string, call: CallState | null | undefined): boolean {
  return !call || call.id !== mine || call.step === 'ended';
}

/** What Number One's chat panel says around the messages: who's typing, the box's hint, a failed turn, and the cost. */
export interface ChatPanel {
  messages: NumberOneMessage[];
  thinking: boolean;
  placeholder: string;
  /** What the chat is for, before anything has been said. */
  intro: string | null;
  /** What Number One is doing while they think. */
  typing: string | null;
  failed: string | null;
  /** Whether New conversation has anything to forget. */
  canStartAfresh: boolean;
  cost: string;
}

/** The chat panel's wording, from the chat as it stands and whether voice mode is on. */
export function chatPanel(chat: NumberOneChat | null, voice: boolean): ChatPanel {
  const thinking = chat?.status === 'thinking';
  const messages = chat?.messages ?? [];
  const said = messages.length > 0;
  return {
    messages,
    thinking,
    placeholder: voice
      ? 'Press Mic or Ctrl+M and talk, then press again (or hold it and let go): it goes as soon as it’s transcribed. Or type it.'
      : `Ask ${numberOne().name} anything… (Enter to send, Shift+Enter for a new line)`,
    intro: said || thinking ? null : 'Ask how something works in any project, what’s going on aboard, or think an idea through. Nothing you say here turns into work unless you send it on.',
    typing: thinking ? chat.activity : null,
    failed: chat?.status === 'failed' ? `${chat.error ?? 'Something went wrong'}. Say something to carry on.` : null,
    canStartAfresh: said || thinking,
    cost: chat?.costUsd ? `$${chat.costUsd.toFixed(2)} so far` : '',
  };
}
