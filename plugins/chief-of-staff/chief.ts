import type { Agent, LeadNote, PluginHost, Settings } from '../../plugin-api/server';
import { errorMessage, hasLeadWork } from '../../plugin-api/server';
import { JUDGE_VERSION, judgePrompt, judgeSystemPrompt, parseVerdict } from './judge';
import { judged, reading, waking } from './lanes';
import { readOf } from './shared';
import { atUsageLimit, turnTail } from './turn';
import { wakeFor } from './wake';

// The chief of staff (README.md): as a goal's lead ends a turn, in a project it's switched on for, it marks the turn
// as being read, judges where it goes, writes its verdict in the ledger and marks the turn with it (`lead.marks`), so
// the captain's inbox files the turn by it (a card, an interrupt, or its words ready for the captain to send). It sends
// nothing itself but where the captain lets it (`Inbox.autoSend`), and Ops' own carry-ons, which the core leaves to it:
// a QA fail back to the lead, and a slice that's landed (`noted`), unless the captain owes the lead an answer.

/** Who judges a turn: a Haiku session (`ClaudeJudge`), the demo's scripted stand-in, or a fake in a test. */
export interface Judge {
  /** The model it judges with, as the ledger names it when the session doesn't say. */
  readonly model: string;
  judge(req: { system: string; prompt: string; settings: Settings }): Promise<{ structured: unknown; costUsd?: number; model?: string }>;
}

/** What the chief of staff needs of the focus. */
export type ChiefHost = Pick<PluginHost, 'on' | 'projects' | 'agent' | 'transcript' | 'record' | 'ledger' | 'settings'> & { goals: Pick<PluginHost['goals'], 'mark' | 'message'> };

export class ChiefOfStaff {
  /** The turns being judged now, by session and last line: a turn that ends twice is judged once. */
  private readonly judging = new Set<string>();
  /** Ops' news for leads whose turn it's still reading, by lead: it wakes them for it once it's judged, if it can then. */
  private readonly deferred = new Map<string, LeadNote[]>();

  /**
   * `standingOrders` reads the captain's standing orders as they are now: undefined when there are none. `autoSends`
   * says whether a project lets it send its words for a lead by itself (`autoSendFor`).
   */
  constructor(
    private readonly host: ChiefHost,
    private readonly judge: Judge,
    private readonly standingOrders: () => string | undefined,
    private readonly autoSends: (projectId: string) => boolean = () => false,
  ) {}

  /** Whether it judges this agent's turns: a goal lead's, in a project it's on for. */
  judges(agent: Agent): boolean {
    return agent.task === 'lead' && hasLeadWork(agent) && this.host.on(agent.projectId);
  }

  /**
   * An agent's turn started or ended: a goal lead's that ended, in a project it's on for, is marked as being read (held
   * back from the captain's badge until it's judged, for `JUDGING_MS` at most), and judged in the background.
   */
  turn(agent: Agent, phase: 'start' | 'end'): Promise<void> | undefined {
    // a turn under way hears the news it waited for with the message that started it
    if (phase === 'start') this.deferred.delete(agent.id);
    if (phase !== 'end' || !this.judges(agent) || !hasLeadWork(agent)) return undefined;
    const since = Date.now();
    this.host.goals.mark(agent.id, reading(since), since);
    if (!agent.sessionId) return undefined;
    const { sessionId } = agent;
    return this.judgeTurn(agent, sessionId, agent.lead.title, since).catch((err: unknown) => console.warn(`[chief-of-staff] judging ${agent.name}’s turn failed: ${errorMessage(err)}`));
  }

  /**
   * Ops left a goal's lead a note, which waits for the next message they get: in a project it's on for, it wakes them
   * for the ones that need no captain (`wakeFor`), as whoever the note's from, and the note goes ahead of its message.
   * Not while the captain owes them an answer (`waking`): the note goes with the captain's next message, and what
   * waited on the captain stays theirs.
   */
  noted(lead: Agent, note: LeadNote): void {
    if (!this.judges(lead)) return;
    const wakes = waking(lead, Date.now());
    if (wakes === 'once-judged') this.deferred.set(lead.id, [...(this.deferred.get(lead.id) ?? []), note]);
    if (wakes !== 'now') return;
    const project = this.host.projects().find((p) => p.id === lead.projectId);
    const text = project && wakeFor(note, project);
    if (text) this.host.goals.message(lead.id, text, { from: note.from });
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
      const read = judged(readOf(this.host.agent(agent.id)), verdict, since, this.autoSends(agent.projectId), Date.now());
      if (read && this.host.goals.mark(agent.id, read, since)) this.wakeDeferred(agent.id);
    } finally {
      this.judging.delete(key);
    }
  }

  /** The news that waited for its verdict on a lead's turn: it wakes them for it now, if it can (`noted`). */
  private wakeDeferred(leadId: string): void {
    const notes = this.deferred.get(leadId) ?? [];
    this.deferred.delete(leadId);
    for (const note of notes) {
      const lead = this.host.agent(leadId);
      if (lead) this.noted(lead, note);
    }
  }

  /** Whether the ledger has a verdict on this turn already: from before a restart, say. */
  private judged(sessionId: string, turnUuid: string): boolean {
    return this.host.ledger().some((e) => e.kind === 'cos-verdict' && e.sessionId === sessionId && e.turnUuid === turnUuid);
  }
}
