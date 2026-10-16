import { clock } from '../../../shared/clock';
import type { BriefingSpot } from '../../../shared/artifacts';
import type { BriefingReply, ResumeCost, ResumeHow } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { chooseDialog } from './confirmDialog';

/** What the captain is asked before an agent picks a long conversation back up on the API key. */
export function resumeQuestion(name: string, cost: ResumeCost, now = Date.now()): string {
  const tokens = cost.tokens >= 1000 ? `${Math.round(cost.tokens / 1000)}k` : String(cost.tokens);
  return [
    `Your Claude plan's usage limit is reached until ${clock(cost.resetsAt, now)}, so ${name} would carry on with your API key.`,
    `Picking their conversation back up means Claude re-reads all of it (${tokens} tokens) at full price before doing anything else: about ${usd(cost.usd)}.`,
    `Or your message waits, and ${name} reads it when your plan's limit resets.`,
  ].join('\n\n');
}

const usd = (amount: number) => `$${amount.toFixed(2)}`;

/** Asks the captain whether the agent carries on with the key now, or waits for the plan's limit; undefined if neither. */
export async function askResume(name: string, cost: ResumeCost): Promise<ResumeHow | undefined> {
  const choice = await chooseDialog({
    title: 'Carry on with your API key?',
    message: resumeQuestion(name, cost),
    confirmLabel: `Carry on now (~${usd(cost.usd)})`,
    altLabel: `Wait till ${clock(cost.resetsAt)}`,
  });
  return choice === 'confirm' ? 'key' : choice === 'alt' ? 'wait' : undefined;
}

/**
 * Sends the agent the captain's message. On your API key, when it would pick a long conversation back up, they're
 * asked first whether to carry on now or wait for the plan's limit to reset. Resolves to whether it went (or waits).
 */
export async function messageAgent(id: string, name: string, text: string): Promise<boolean> {
  const reply = await api.message(id, text);
  if (!('costly' in reply)) return true;
  const how = await askResume(name, reply.costly);
  if (!how) return false;
  await api.message(id, text, how);
  return true;
}

/** The captain's pick of a lead's question, asked first like `messageAgent` when hearing it would cost them on the key. */
export async function answerLead(id: string, question: string, option: string, note?: string): Promise<void> {
  const reply = await api.answer(id, question, option, note);
  if (!('costly' in reply)) return;
  const how = await askResume(state.agents.get(id)?.name ?? 'The lead', reply.costly);
  if (how) await api.answer(id, question, option, note, how);
}

/**
 * The captain's question about a lead's briefing, asked first like `messageAgent` when it would cost them on the key.
 * Undefined when they chose not to send it.
 */
export async function askAboutBriefing(id: string, briefing: string, spot: BriefingSpot | undefined, question: string): Promise<Exclude<BriefingReply, { costly: unknown }> | undefined> {
  const reply = await api.askBriefing(id, briefing, spot, question);
  if (!('costly' in reply)) return reply;
  const how = await askResume(state.agents.get(id)?.name ?? 'The lead', reply.costly);
  if (!how) return undefined;
  const asked = await api.askBriefing(id, briefing, spot, question, how);
  return 'costly' in asked ? undefined : asked;
}
