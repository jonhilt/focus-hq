// Each open goal's flow as it goes (README.md): worked out again from its lead's transcript and the ledger as the
// lead's turns start and end, QA gives a verdict and its pull requests land, and kept in the plugin's state for the
// goal's screens. The rules are in flow.ts; this is when to run them.
import { type Agent, errorMessage, goalRecord, hasLeadWork, type LedgerEvent, type PluginHost, type PluginState } from '../../plugin-api/server';
import { goalFlow, leadFlow, transcriptMoments } from './flow';
import type { FlowPluginState, LeadFlow } from './shared';

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

export class Flows {
  /** The leads in the middle of a turn: a transcript can't tell a long tool call from a turn that's over. */
  private readonly busy = new Set<string>();
  /** The goals whose flow is being worked out, and those asked for again meanwhile. */
  private readonly flowing = new Set<string>();
  private readonly again = new Set<string>();

  constructor(
    private readonly host: PluginHost,
    private readonly state: PluginState<FlowPluginState>,
  ) {}

  /** Every open goal's flow, worked out afresh: as the office starts, one transcript at a time (they can be tens of MB). */
  async all(): Promise<void> {
    for (const agent of this.host.agents()) if (agent.task === 'lead' && hasLeadWork(agent)) await this.refresh(agent.id);
  }

  turn(agent: Agent, phase: 'start' | 'end'): void {
    this.prune();
    if (agent.task !== 'lead' || !hasLeadWork(agent)) return;
    if (phase === 'start') this.busy.add(agent.id);
    else this.busy.delete(agent.id);
    void this.refresh(agent.id);
  }

  ledgerRecorded(event: LedgerEvent): void {
    this.prune();
    const lead = goalMoved(event, this.host.agents());
    if (lead) void this.refresh(lead);
  }

  /** Whether `id`'s goal is still open: its lead is still in the office, at work on it. */
  private readonly open = (id: string): boolean => !!this.host.agent(id)?.lead;

  /** Drops the flows of goals that have closed since, so browsers stop being sent them. */
  private prune(): void {
    const leads = withoutClosed(this.state.get().leads, this.open);
    if (leads) this.state.set({ leads });
  }

  /**
   * Works out where an open goal's time has gone so far, and what it's waiting on now. One at a time per goal; asked
   * again meanwhile, it runs once more after. The goal is read again once its transcript has been, so what the office
   * did about the line in the ledger that asked (a pull request landing) is in it. Settles once this run is done.
   */
  refresh(agentId: string): Promise<void> {
    if (this.flowing.has(agentId)) {
      this.again.add(agentId);
      return Promise.resolve();
    }
    this.flowing.add(agentId);
    const work = async () => {
      const sessionId = this.host.agent(agentId)?.sessionId;
      const text = sessionId && (await this.host.transcript(sessionId));
      // as the goal is now: its lead may have moved on, or gone home, while the transcript was read
      const agent = this.host.agent(agentId);
      if (!text || !agent || !hasLeadWork(agent) || agent.cloud) return;
      const now = Date.now();
      const flow = leadFlow(goalFlow({ ...goalRecord(agent, now), projectId: agent.projectId }, transcriptMoments(text), this.host.ledger(), this.busy.has(agentId)), now);
      if (flow) this.state.set({ leads: withFlow(this.state.get().leads, agentId, flow, this.open) });
    };
    return work()
      .catch((err: unknown) => console.warn(`Couldn't work out the flow of ${agentId}'s goal: ${errorMessage(err)}`))
      .finally(() => {
        this.flowing.delete(agentId);
        if (this.again.delete(agentId)) void this.refresh(agentId);
      });
  }
}
