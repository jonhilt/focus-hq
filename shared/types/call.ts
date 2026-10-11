// Calls: the captain talking to Number One hands-free. OpenAI's gpt-live-1 holds the conversation, Jev picks what the
// captain asked for, and a state machine keeps each task on rails (docs/calls.md).

/** Where a call's task stands: the machine's state, for the captain to see. */
export type CallStep = 'listening' | 'routing' | 'confirming' | 'checking' | 'acting' | 'ended';

/** A line of the call's captions: the captain, the ship's voice, or a note from the office on what it did. */
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
  lines: CallLine[];
  /** Why the call ended, when it ended badly. */
  error?: string;
}

/** Whether the office can take a call (both keys set), and the call under way, if any. */
export interface CallStatus {
  /** Why it can't, worded for the Call button's tooltip; undefined when it can. */
  missing?: string;
  call: CallState | null;
}
