import { isRecord } from './records';

// The captain's answer to an agent, from its panel (docs/plugins.md, `PluginParts.captainAnswered`): what they said, in
// one of the few ways an agent is answered. Pure, for the server and the plugins that hear of it.

/** Approve or decline a raised hand, pick a question's option (with what they add), say something, or close the goal. */
export type CaptainAnswer = { allow: boolean } | { option: string; note?: string } | { text: string } | { close: true };

/**
 * Whether an answer went through, from what Ops replied: not when it came back to ask about the cost of picking a
 * conversation back up (`costly`), or warning before closing a goal (`warn`).
 */
export const landed = (reply: unknown): boolean => !(isRecord(reply) && ('costly' in reply || 'warn' in reply));
