import type { Agent, Attention, PullRequest, QaReview } from '../../plugin-api/shared';
import { needsYou, turnRead } from '../../plugin-api/shared';
import type { Decide, InboxItem } from './inbox';
import { laneOf } from './laneRules';
import { readOf } from './shared';
import { gradeOf, toasts } from './watchRules';
import { headlineOf } from './askRules';

// The captain's inbox's decisions (docs/ledger.md#the-captains-inbox-api): what waits on them and in what order, whether
// an answer fits the item it answers, and where a lead's turn stands for them, with the toast as it changes. Pure, so
// it's tested (inboxRules.test.ts).

/** Whether the captain acknowledged a lead's latest turn (Got it): it's off their queue until the lead's next turn. */
export const acknowledged = (lead: Pick<Agent, 'lead'>): boolean => readOf(lead)?.acked !== undefined;

/**
 * Everything waiting on the captain: what needs them (`needsYou`, in the `needs-you` lane), most urgent first, then the
 * leads whose turn they've read but not answered, then the turns it has words ready for or is still reading (`laneOf`).
 * A turn they acknowledged isn't among them: it waits for their next message, but asks nothing more of them.
 */
export function waiting(agents: Agent[], prs: { projectId: string; pr: PullRequest & { resolver?: Agent } }[], reviews: ReadonlyMap<string, QaReview>, leads: Agent[], now: number): Attention[] {
  const all = needsYou(agents, prs, reviews).filter((a) => a.kind !== 'turn' || !acknowledged(a.agent));
  const hailing = new Set(all.flatMap((a) => ('agent' in a ? [a.agent.id] : [])));
  const read = leads.filter((l) => !hailing.has(l.id) && turnRead(l) && !acknowledged(l)).map((agent): Attention => ({ kind: 'turn', agent }));
  return [...all.filter((a) => laneOf(a, now) === 'needs-you'), ...read, ...all.filter((a) => laneOf(a, now) !== 'needs-you')];
}

/** Why a decision doesn't answer this kind of item, if it doesn't: a hand is allowed or not, a pull request is the board's. */
export function decideRefusal({ kind, cos }: Pick<InboxItem, 'kind' | 'cos'>, d: Decide): string | null {
  if ('send' in d) return cos && (cos.route === 1 || cos.route === 4) ? null : 'Only a turn the chief of staff has words ready for can be sent them';
  if ('ack' in d) return kind === 'turn' ? null : 'Only a lead’s turn is acknowledged: answer the rest';
  if ('answer' in d) return kind === 'turn' && cos ? null : 'Only a lead’s turn the chief of staff has read is answered ask by ask';
  if ('move' in d) return kind === 'turn' && cos ? null : 'Only work the chief of staff found in a lead’s turn is moved';
  if (kind === 'qa' || kind === 'conflicts') return 'A pull request is decided on the board: merge, close or send it back there';
  if (kind === 'hand') return 'allow' in d ? null : 'A raised hand is approved or declined: allow true or false';
  if ('allow' in d) return 'Only a raised hand is approved or declined';
  if ('option' in d && kind !== 'question') return 'Only a question has options to pick';
  if ('close' in d && kind !== 'wrap-up') return 'Only a goal ready to close can be closed';
  return null;
}

/** Where a goal's lead's turn stands for the captain: at work, being read, or ended and judged (or not judged at all). */
export type TurnStage = 'working' | 'reading' | 'ready' | 'card' | 'interrupt' | 'waiting';

export function turnStage(lead: Pick<Agent, 'status' | 'lead'>): TurnStage {
  if (lead.status !== 'done') return 'working';
  const read = readOf(lead);
  if (!read) return 'waiting';
  if (!read.judged) return 'reading';
  return ({ 1: 'ready', 2: 'card', 3: 'interrupt', 4: 'ready' } as const)[read.judged.route];
}

/**
 * The toast as a lead's turn comes to the captain, if it does: a turn no chief of staff reads, a card, or an interrupt.
 * One it would carry on or send back, or is still reading, says nothing: it's in Comms, off the badge.
 */
export function turnNews(before: TurnStage | undefined, lead: Pick<Agent, 'name' | 'status' | 'lead'>): { level: 'info' | 'error'; text: string } | null {
  const now = turnStage(lead);
  if (!before || before === now) return null;
  const judged = readOf(lead)?.judged;
  const ask = judged ? headlineOf(judged.asks) : '';
  if (now === 'interrupt') return { level: 'error', text: `🚨 ${lead.name}: ${ask}` };
  if (now === 'card') return { level: 'info', text: `🗂 ${lead.name}: ${ask}` };
  if (now === 'waiting' && before === 'working') return { level: 'info', text: `🖖 ${lead.name} is waiting for you` };
  return null;
}

/**
 * The toast as a lead's turn comes to the captain (`turnNews`), on watch or not: while a goal is at the conn, only its
 * own turns and hails toast; the rest wait as counts on their berths (`toasts`, README.md#the-watch).
 */
export function turnToast(before: TurnStage | undefined, lead: Pick<Agent, 'id' | 'name' | 'status' | 'lead'>, conn: string | undefined): { level: 'info' | 'error'; text: string } | null {
  const news = turnNews(before, lead);
  return news && toasts(conn, lead.id, gradeOf(readOf(lead)?.judged)) ? news : null;
}
