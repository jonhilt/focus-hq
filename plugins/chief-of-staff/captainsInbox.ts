import type { Agent, Attention, CaptainAnswer, PluginGoals, PluginHost, ResumeHow } from '../../plugin-api/server';
import { errorMessage, landed, openQuestion, shownProjects } from '../../plugin-api/server';
import { answerText, type Decide, decideRefusal, type DecidedVia, type Inbox as InboxView, type InboxItem, inboxItem, recentDecisions, waiting } from './inbox';
import { type LandedAnswer, landedAnswerText, type LandedItem, landedItems, landedMessage, landedWhere } from './landed';
import { acked, held } from './lanes';
import { readOf, SENDER } from './shared';

// The captain's inbox, as the API serves it (docs/ledger.md#the-captains-inbox-api): what needs them across the shown
// projects, the same list Comms shows, and each answer recorded in the ledger as a `captain-decision`, whether it came
// from Comms, an agent's panel (`answered`), or a bot on the API. It keeps nothing itself: what's open is worked out
// from the agents and boards each time, and what was decided is the ledger's.

/** What the inbox needs of Focus. */
export type InboxHost = Pick<PluginHost, 'projects' | 'agent' | 'agents' | 'boardPrs' | 'reviews' | 'recentLines' | 'ledger' | 'record'> & {
  goals: Pick<PluginGoals, 'resolvePermission' | 'answer' | 'closeGoal' | 'message' | 'mark' | 'readTurn'>;
};

export class Inbox {
  /** `autoSends` says whether a project lets the chief of staff send its words by itself (`autoSendFor`). */
  constructor(
    private readonly host: InboxHost,
    private readonly autoSends: (projectId: string) => boolean,
  ) {}

  /** The goals' leads in the shown projects: what the bot hears they've shown. */
  leads(): Agent[] {
    const shown = new Set(shownProjects(this.host.projects()).map((p) => p.id));
    return this.host.agents().filter((a) => a.task === 'lead' && shown.has(a.projectId));
  }

  private waiting(agents = this.host.agents()): Attention[] {
    const projects = shownProjects(this.host.projects());
    const shown = new Set(projects.map((p) => p.id));
    const aboard = agents.filter((a) => shown.has(a.projectId));
    const prs = projects.flatMap((project) => this.host.boardPrs(project.id).map((pr) => ({ projectId: project.id, pr })));
    return waiting(aboard, prs, this.host.reviews(), aboard.filter((a) => a.task === 'lead'), Date.now());
  }

  /** What's waiting, each as an item and as the hail it is. */
  private items(agents?: Agent[]): { a: Attention; item: InboxItem }[] {
    const now = Date.now();
    const reviews = this.host.reviews();
    return this.waiting(agents).map((a) => ({ a, item: inboxItem(a, reviews, now, 'agent' in a ? this.host.recentLines(a.agent.id, 200) : undefined) }));
  }

  view(): InboxView {
    const ledger = this.host.ledger();
    return { open: this.items().map(({ item }) => item), landed: this.landedNow(ledger), decided: recentDecisions(ledger, Date.now()) };
  }

  /** What landed in Show in the shown projects that the captain hasn't heard of yet (landed.ts). */
  private landedNow(ledger = this.host.ledger()): LandedItem[] {
    const shown = new Set(shownProjects(this.host.projects()).map((p) => p.id));
    return landedItems(ledger, shown, Date.now(), (id) => this.host.agent(id)?.name);
  }

  /**
   * Answers a slice that landed in Show, and records it: Got it, or words for its lead (Redirect) or the lead undoing
   * it as their next slice (Revert), each going to them as the captain's message. Words need the goal still open.
   */
  decideLanded(id: string, answer: LandedAnswer, via: DecidedVia): { ok: true } {
    const item = this.landedNow().find((l) => l.id === id);
    if (!item) throw new Error('That’s no longer waiting on you');
    const text = landedMessage(item, answer);
    if (text) {
      const lead = item.leadId ? this.host.agent(item.leadId) : undefined;
      if (lead?.task !== 'lead') throw new Error(`${item.goal ? `“${item.goal}”` : 'Its goal'} is closed: nobody's there to hear it. Revert or follow up on GitHub instead.`);
      const reply = this.host.goals.message(lead.id, text);
      if (!landed(reply)) throw new Error(`${lead.name} couldn’t take it now: try again in a moment`);
    }
    this.host.record(item.projectId, {
      kind: 'captain-decision', agent: item.who, ...(item.goal && { goal: item.goal }),
      item: { id: item.id, kind: 'landed', what: `${landedWhere(item)} landed in Show` }, answer: landedAnswerText(answer), via,
    });
    return { ok: true };
  }

  /** Answers an item by its id, as the captain would from Comms, and records it. */
  async decide(id: string, d: Decide, via: DecidedVia, how?: ResumeHow): Promise<unknown> {
    const found = this.items().find(({ item }) => item.id === id);
    if (!found) throw new Error('That’s no longer waiting on you');
    const refusal = decideRefusal(found.item, d);
    if (refusal) throw new Error(refusal);
    const { a, item } = found;
    if (!('agent' in a)) throw new Error('A pull request is decided on the board');
    const reply = await this.act(a.agent, d, item.cos?.message ?? '', how);
    // Ops asking about cost comes back as it is, to answer again with `how`; otherwise, just that it went through
    if (!landed(reply)) return reply;
    this.record(a.agent, item, d, via);
    return { ok: true };
  }

  /**
   * The captain answered an agent from its panel (`PluginParts.captainAnswered`): when that answered something waiting
   * on them, as the agent stood `before` it, it's recorded. A message to a lead at work answers nothing in the inbox,
   * and isn't; nor does a message answer a raised hand.
   */
  answered(before: Agent, answer: CaptainAnswer): void {
    const found = this.items([before]).find(({ a, item }) => 'agent' in a && a.agent.id === before.id && !decideRefusal(item, answer));
    if (found) this.record(before, found.item, answer, 'office');
  }

  private record(agent: Agent, item: InboxItem, d: Decide, via: DecidedVia): void {
    const answer = answerText(d);
    if (!answer) return;
    const goal = agent.lead?.title;
    this.host.record(agent.projectId, { kind: 'captain-decision', agent: agent.name, ...(goal && { goal }), item: { id: item.id, kind: item.kind, what: item.what }, answer, via });
  }

  /**
   * Sends the chief of staff's words to each lead whose turn it would carry on or send back, once they're due
   * (`CosRead.sendsAt`) and their project still lets it, recorded as decided by the chief of staff. Run every few seconds.
   */
  async autoSend(now = Date.now()): Promise<void> {
    // one run at a time: a send that's slow to land isn't sent twice
    if (this.sending) return;
    this.sending = true;
    try {
      await this.sendDue(now);
    } finally {
      this.sending = false;
    }
  }

  private sending = false;

  private async sendDue(now: number): Promise<void> {
    const due = this.items().filter(({ a, item }) => {
      if (a.kind !== 'turn' || item.lane !== 'ready') return false;
      const sendsAt = readOf(a.agent)?.sendsAt;
      return sendsAt !== undefined && sendsAt <= now && this.autoSends(a.agent.projectId);
    });
    for (const { item } of due) {
      await this.decide(item.id, { send: true }, 'chief-of-staff').catch((err: unknown) => console.warn(`[chief-of-staff] sending its words failed: ${errorMessage(err)}`));
    }
  }

  /** Holds the chief of staff's words on an item, so they wait for the captain rather than going by themselves. */
  hold(id: string): void {
    const found = this.items().find(({ item }) => item.id === id);
    if (!found || found.a.kind !== 'turn') throw new Error('That’s no longer waiting on you');
    this.holdFor(found.a.agent.id);
  }

  /** Holds its words for a lead, if they were going by themselves: a project that stops letting it, say. */
  holdFor(agentId: string): void {
    const read = readOf(this.host.agent(agentId));
    const kept = held(read);
    if (read && kept) this.host.goals.mark(agentId, kept, read.at);
  }

  /**
   * The captain acknowledged a lead's turn (Got it): it's read, and marked so (`CosRead.acked`), which takes it off
   * their queue and stops its words going by themselves, until the lead's next turn clears the mark. Nothing's sent.
   */
  private acknowledge(agent: Agent): void {
    const read = readOf(agent);
    const ended = agent.finishedAt ?? Date.now();
    this.host.goals.readTurn(agent.id);
    if (!this.host.goals.mark(agent.id, acked(read, ended, Date.now()), read?.at ?? ended)) throw new Error('That turn can’t be acknowledged now: the lead is at work again');
  }

  /** Does what the captain decided. `words` are the chief of staff's, for `send`. */
  private act(agent: Agent, d: Decide, words: string, how?: ResumeHow): unknown {
    const { goals } = this.host;
    if ('ack' in d) {
      this.acknowledge(agent);
      return undefined;
    }
    if ('allow' in d) return goals.resolvePermission(agent.id, agent.permission?.id ?? '', d.allow);
    if ('option' in d) return goals.answer(agent.id, openQuestion(agent)?.id ?? '', d.option, d.note, how);
    if ('close' in d) return goals.closeGoal(agent.id);
    if ('send' in d) return goals.message(agent.id, words, { from: SENDER, how });
    return goals.message(agent.id, d.text, { how });
  }
}
