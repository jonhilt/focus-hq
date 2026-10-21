import type { Agent, PluginHost, Settings } from '../../plugin-api/server';
import { errorMessage, hasLeadWork } from '../../plugin-api/server';
import { JUDGE_VERSION, judgePrompt, judgeSystemPrompt, parseVerdict } from './judge';
import { atUsageLimit, turnTail } from './turn';

// The chief of staff (README.md): as a goal's lead ends a turn, in a project it's switched on for, it judges where the
// turn goes, writes its verdict in the ledger and hands it to the captain's inbox, which files the turn by it (a card,
// an interrupt, or its words ready for the captain to send). It sends nothing itself: the captain does, from the inbox.

/** Who judges a turn: a Haiku session (`ClaudeJudge`), the demo's scripted stand-in, or a fake in a test. */
export interface Judge {
  /** The model it judges with, as the ledger names it when the session doesn't say. */
  readonly model: string;
  judge(req: { system: string; prompt: string; settings: Settings }): Promise<{ structured: unknown; costUsd?: number; model?: string }>;
}

/** What the chief of staff needs of the focus. */
export type ChiefHost = Pick<PluginHost, 'on' | 'transcript' | 'record' | 'ledger' | 'settings'> & { goals: Pick<PluginHost['goals'], 'judged'> };

export class ChiefOfStaff {
  /** The turns being judged now, by session and last line: a turn that ends twice is judged once. */
  private readonly judging = new Set<string>();

  /** `standingOrders` reads the captain's standing orders as they are now: undefined when there are none. */
  constructor(
    private readonly host: ChiefHost,
    private readonly judge: Judge,
    private readonly standingOrders: () => string | undefined,
  ) {}

  /** Whether it judges this agent's turns: a goal lead's, in a project it's on for. */
  judges(agent: Agent): boolean {
    return agent.task === 'lead' && hasLeadWork(agent) && this.host.on(agent.projectId);
  }

  /** An agent's turn started or ended: a goal lead's that ended, in a project it's on for, is judged in the background. */
  turn(agent: Agent, phase: 'start' | 'end'): Promise<void> | undefined {
    if (phase !== 'end' || !this.judges(agent) || !hasLeadWork(agent) || !agent.sessionId) return undefined;
    const { sessionId } = agent;
    return this.judgeTurn(agent, sessionId, agent.lead.title, Date.now()).catch((err: unknown) => console.warn(`[chief-of-staff] judging ${agent.name}’s turn failed: ${errorMessage(err)}`));
  }

  private async judgeTurn(agent: Agent, sessionId: string, goal: string, since: number): Promise<void> {
    const jsonl = await this.host.transcript(sessionId);
    const tail = jsonl === undefined ? undefined : turnTail(jsonl);
    // a turn the lead said nothing in, or that your plan's limit stopped (Ops carries those on), isn't judged
    if (!tail || atUsageLimit(tail.text)) return;
    const key = `${sessionId}:${tail.uuid}`;
    if (this.judging.has(key) || this.judged(sessionId, tail.uuid)) return;
    this.judging.add(key);
    try {
      const result = await this.judge.judge({ system: judgeSystemPrompt(this.standingOrders()), prompt: judgePrompt(goal, tail.text), settings: this.host.settings() });
      const verdict = parseVerdict(result.structured);
      if (!verdict) throw new Error(`the judge gave no verdict: ${JSON.stringify(result.structured)}`);
      this.host.record(agent.projectId, {
        kind: 'cos-verdict', sessionId, agent: agent.name, goal, turnUuid: tail.uuid, route: verdict.route, why: verdict.why,
        ...(verdict.message && { message: verdict.message }), model: result.model ?? this.judge.model, version: JUDGE_VERSION,
        ...(result.costUsd !== undefined && { costUsd: result.costUsd }),
      });
      this.host.goals.judged(agent.id, verdict, since);
    } finally {
      this.judging.delete(key);
    }
  }

  /** Whether the ledger has a verdict on this turn already: from before a restart, say. */
  private judged(sessionId: string, turnUuid: string): boolean {
    return this.host.ledger().some((e) => e.kind === 'cos-verdict' && e.sessionId === sessionId && e.turnUuid === turnUuid);
  }
}
