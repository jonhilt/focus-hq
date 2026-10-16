// Your API key as a fallback for your Claude plan: what picking a conversation back up on it costs, and the captain's say.

/**
 * What picking an agent's conversation back up on your API key would cost: Claude re-reads all of it, at full price,
 * before doing anything else.
 */
export interface ResumeCost {
  /** About how many dollars the re-read costs. */
  usd: number;
  /** How long the conversation is. */
  tokens: number;
  /** When your plan's usage limit resets, and the agent could carry on with it instead. */
  resetsAt: number;
}

/** 'key': carry on with the API key now, whatever it costs. 'wait': the message waits until your plan's limit resets. */
export type ResumeHow = 'key' | 'wait';

/** What came of a message to an agent: sent (or waiting for the plan's limit), or a question for the captain first. */
export type MessageReply = { sent: true } | { costly: ResumeCost };

/**
 * What came of a question about a lead's briefing: it went to the lead, who answers as they write; the quick answerer
 * answered it (the lead was busy); or, as for any message, a question for the captain first.
 */
export type BriefingReply = { by: 'lead' } | { by: 'quick'; text: string } | { costly: ResumeCost };
