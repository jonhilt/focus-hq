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
 * Where Focus stands on your plan and your API key, as its new sessions sign in: 'login', your plan; 'key', your
 * API key; 'fallback', your plan, then the key while the plan's usage limit is reached.
 */
export interface SignIn {
  mode: 'login' | 'key' | 'fallback';
  /** New sessions start on the key right now. */
  onKey: boolean;
  /** What the key has spent since your plan's limit was reached, and the most it may spend each time. */
  keySpentUsd: number;
  keyBudgetUsd: number;
}
