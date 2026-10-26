import type { Agent, LedgerEvent } from '../../plugin-api/shared';
import type { LeadFlow } from './shared';

// Which open goal's flow a line in the ledger moves on, and which goals' flows the plugin keeps (README.md): flows.ts
// works each out again when they say. Pure, so it's tested (flowsRules.test.ts).

/** The ledger's lines that move a goal from one state to another: QA's verdict on one of its pull requests, and one landing. */
const MOVES: ReadonlySet<LedgerEvent['kind']> = new Set(['qa-verdict', 'merged', 'closed']);

/** The goal a line in the ledger moves on, by its lead's id: the open goal with that pull request in its slice. */
export function goalMoved(event: LedgerEvent, agents: Agent[]): string | undefined {
  if (!MOVES.has(event.kind) || !('repo' in event) || !('pr' in event)) return undefined;
  return agents.find((a) => a.task === 'lead' && a.lead?.prs.some((p) => p.repo === event.repo && p.number === event.pr))?.id;
}

/** The goals' flows with `id`'s new one, leaving out any whose goal isn't open any more (`open` says). */
export function withFlow(leads: Record<string, LeadFlow>, id: string, flow: LeadFlow, open: (id: string) => boolean): Record<string, LeadFlow> {
  return Object.fromEntries([...Object.entries(leads).filter(([lead]) => lead !== id && open(lead)), [id, flow]]);
}

/** The goals' flows without those whose goal isn't open any more (`open` says), or undefined when every one still is. */
export function withoutClosed(leads: Record<string, LeadFlow>, open: (id: string) => boolean): Record<string, LeadFlow> | undefined {
  const kept = Object.entries(leads).filter(([lead]) => open(lead));
  return kept.length === Object.keys(leads).length ? undefined : Object.fromEntries(kept);
}
