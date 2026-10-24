import type { Agent, Lane, LeadNote, PluginHost, Settings } from '../../plugin-api/server';
import { errorMessage, hasLeadWork } from '../../plugin-api/server';
import { judgePrompt, judgeSystemPrompt, judgeVersion, parseVerdict, verdictSchema } from './judge';
import { heldForRead, laneJudgeVersion, lostRaise, LANE_SCHEMA, lanePrompt, laneSystemPrompt, parseLane, pickOf, unreadShip } from './laneJudge';
import type { JevRouting, Router } from './jevRouter';
import { judged, reading, waking } from './lanes';
import { capped, unattendedRounds } from './rounds';
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
  /** `schema` is the answer's shape: a turn's verdict when it's left out. */
  judge(req: { system: string; prompt: string; settings: Settings; schema?: Record<string, unknown> }): Promise<{ structured: unknown; costUsd?: number; model?: string }>;
}

/** What the chief of staff needs of the focus. */
export type ChiefHost = Pick<PluginHost, 'on' | 'projects' | 'agent' | 'agents' | 'transcript' | 'record' | 'ledger' | 'settings'> & { goals: Pick<PluginHost['goals'], 'mark' | 'message' | 'raiseLane'> };

export class ChiefOfStaff {
  /** The turns being judged now, by session and last line: a turn that ends twice is judged once. */
  private readonly judging = new Set<string>();
  /** The ships it's reading the lanes of now, by lead and the commits they're at: each is read once. */
  private readonly readingShips = new Set<string>();
  /** Ops' news for leads whose turn it's still reading, by lead: it wakes them for it once it's judged, if it can then. */
  private readonly deferred = new Map<string, LeadNote[]>();

  /**
   * `standingOrders` reads the captain's standing orders as they are now: undefined when there are none. `autoSends`
   * says whether a project lets it send its words for a lead by itself (`autoSendFor`). `jev` routes the turns of a
   * project the captain switched Route with Jev on for (`jevFor`), the judge writing only the words.
   */
  constructor(
    private readonly host: ChiefHost,
    private readonly judge: Judge,
    private readonly standingOrders: () => string | undefined,
    private readonly autoSends: (projectId: string) => boolean = () => false,
    private readonly jev?: { router: Router; on: (projectId: string) => boolean },
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

  /**
   * The board of a project it's on for was refreshed: it reads the lane of each goal's lead's ship it hasn't read yet
   * (`unreadShip`), and raises it where the captain would want to see it first (README.md#raising-a-ships-lane).
   */
  readShips(projectId: string): Promise<void>[] {
    if (!this.host.on(projectId)) return [];
    const ledger = this.host.ledger();
    // a ship still pushing is read once it's all out
    return this.host.agents().filter((a) => a.projectId === projectId && this.judges(a) && a.status !== 'pushing').flatMap((lead) => {
      // a raise the ledger has but the lead's pull requests lost (to a restart) is taken again
      const lost = lostRaise(lead, ledger);
      if (lost) this.host.goals.raiseLane(lead.id, lost.lane, lost.why);
      const prs = unreadShip(lead, ledger);
      const key = `${lead.id}:${prs.map((p) => `${p.repo}#${p.number}@${p.sha ?? ''}`).join(',')}`;
      if (!prs.length || this.readingShips.has(key)) return [];
      this.readingShips.add(key);
      return [this.readShip(lead, prs).catch((err: unknown) => console.warn(`[chief-of-staff] reading ${lead.name}’s ship failed: ${errorMessage(err)}`)).finally(() => this.readingShips.delete(key))];
    });
  }

  /** Why Ops should hold a goal's lead's pull request for now: its ship's lane isn't read yet, in a project it's on for. */
  mergeHeld(pr: { repo: string; number: number }): string | undefined {
    const lead = this.host.agents().find((a) => a.task === 'lead' && a.lead?.prs.some((p) => p.repo === pr.repo && p.number === pr.number && !p.outcome));
    if (!lead || !this.judges(lead)) return undefined;
    return heldForRead(lead.lead?.prs.find((p) => p.repo === pr.repo && p.number === pr.number), this.host.ledger());
  }

  /** Reads a lead's ship and raises its lane if it would: one it can't read goes in Ask, since an unread one is the captain's. */
  private async readShip(lead: Agent, prs: { repo: string; number: number; sha?: string; lane?: Lane }[]): Promise<void> {
    const work = lead.lead;
    if (!work) return;
    const from = pickOf(prs);
    const { shipped } = work;
    const read = { agent: lead.name, goal: work.title, prs: prs.map((p) => ({ repo: p.repo, pr: p.number, ...(p.sha && { sha: p.sha }) })), from, version: laneJudgeVersion() };
    let lane: Lane = 'ask';
    let why: string;
    try {
      if (!shipped) throw new Error('it shipped with no recap to read');
      const result = await this.judge.judge({
        system: laneSystemPrompt(this.standingOrders()),
        prompt: lanePrompt({ goal: work.title, title: shipped.title, summary: shipped.summary, recap: shipped.recap, lane: from }),
        settings: this.host.settings(),
        schema: LANE_SCHEMA,
      });
      const answer = parseLane(result.structured, from);
      if (!answer) throw new Error(`it gave no lane: ${JSON.stringify(result.structured)}`);
      ({ lane, why } = answer);
      this.host.record(lead.projectId, { kind: 'cos-lane', ...read, to: lane, why, model: result.model ?? this.judge.model, ...(result.costUsd !== undefined && { costUsd: result.costUsd }) });
    } catch (err) {
      why = 'The chief of staff couldn’t read this ship, so it waits for you.';
      this.host.record(lead.projectId, { kind: 'cos-lane', ...read, to: lane, why, model: this.judge.model, failed: errorMessage(err) });
    }
    if (lane !== from) this.host.goals.raiseLane(lead.id, lane, why);
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
      const orders = this.standingOrders();
      const prompt = judgePrompt(goal, tail.text);
      const { routing, failed } = await this.routeWithJev(agent.projectId, prompt, orders);
      const pinned = routing?.route;
      const result = await this.judge.judge({ system: judgeSystemPrompt(orders, pinned), prompt, settings: this.host.settings(), ...(pinned && { schema: verdictSchema(pinned) }) });
      const parsed = parseVerdict(result.structured);
      if (!parsed) throw new Error(`the judge gave no verdict: ${JSON.stringify(result.structured)}`);
      const verdict = pinned ? { ...parsed, route: pinned } : parsed;
      this.host.record(agent.projectId, {
        kind: 'cos-verdict', sessionId, agent: agent.name, goal, turnUuid: tail.uuid, route: verdict.route, why: verdict.why,
        ...(verdict.message && { message: verdict.message }), model: result.model ?? this.judge.model,
        version: routing ? `${judgeVersion()}+${routing.how.version}` : judgeVersion(),
        ...(result.costUsd !== undefined && { costUsd: result.costUsd }),
        ...(routing && { router: { by: 'jev', ...routing.how } }),
        ...(failed && { routerFailed: failed }),
      });
      // after a few rounds in a row without the captain, a turn it would carry on is theirs (rounds.ts)
      const filed = capped(verdict, unattendedRounds(this.host.ledger(), agent));
      const read = judged(readOf(this.host.agent(agent.id)), filed, since, this.autoSends(agent.projectId), Date.now());
      if (read && this.host.goals.mark(agent.id, read, since)) this.wakeDeferred(agent.id);
    } finally {
      this.judging.delete(key);
    }
  }

  /**
   * Jev's route for a turn, in a project the captain switched it on for; why not, when it was asked and couldn't
   * answer (the judge's model routes then, as everywhere else).
   */
  private async routeWithJev(projectId: string, prompt: string, orders: string | undefined): Promise<{ routing?: JevRouting; failed?: string }> {
    if (!this.jev?.on(projectId)) return {};
    try {
      return { routing: await this.jev.router.route(prompt, orders) };
    } catch (err) {
      return { failed: errorMessage(err) };
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
