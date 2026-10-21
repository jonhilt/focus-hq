import { columns } from '../shared/board';
import { shownProjects } from '../shared/hidden';
import { answerText, type Decide, decideRefusal, type DecidedVia, type Inbox as InboxView, type InboxItem, inboxItem, landed, recentDecisions, waiting } from '../shared/captainsInbox';
import { openQuestion } from '../shared/artifacts';
import type { Attention } from '../shared/tricorder';
import type { Agent, ResumeHow } from '../shared/types';
import type { Office } from './office';
import { errorMessage } from './util';
import type { Store } from './store';

// The captain's inbox, as the API serves it (docs/ledger.md#the-captains-inbox-api): what needs them across the shown projects,
// the same list Comms shows, and each answer recorded in the ledger as a `captain-decision`, whether it came from Comms,
// an agent's panel, or a bot on the API. It keeps nothing itself: what's open is worked out from the agents and boards
// each time, and what was decided is the ledger's.

/** Who the chief of staff's words come from, as the lead hears them. */
const CHIEF_OF_STAFF = 'Chief of Staff';

export class Inbox {
  constructor(
    private readonly store: Store,
    private readonly office: Pick<Office, 'agents' | 'githubLogin'>,
  ) {}

  private waiting(): Attention[] {
    const projects = shownProjects(this.store.projects);
    const shown = new Set(projects.map((p) => p.id));
    const agents = [...this.store.agents.values()].filter((a) => shown.has(a.projectId));
    const login = this.office.githubLogin;
    const prs = projects.flatMap((project) =>
      columns(project, this.store.boards.get(project.id), agents.filter((a) => a.projectId === project.id), login).prs.map((pr) => ({ projectId: project.id, pr })),
    );
    return waiting(agents, prs, this.store.reviews, agents.filter((a) => a.task === 'lead'), Date.now());
  }

  /** What's waiting, each as an item and as the hail it is. */
  private items(): { a: Attention; item: InboxItem }[] {
    const now = Date.now();
    return this.waiting().map((a) => ({ a, item: inboxItem(a, this.store.reviews, now) }));
  }

  view(): InboxView {
    return { open: this.items().map(({ item }) => item), decided: recentDecisions(this.store.ledger, Date.now()) };
  }

  /** Answers an item by its id, as the captain would from Comms, and records it. */
  async decide(id: string, d: Decide, via: DecidedVia, how?: ResumeHow): Promise<unknown> {
    const found = this.items().find(({ item }) => item.id === id);
    if (!found) throw new Error('That’s no longer waiting on you');
    const refusal = decideRefusal(found.item, d);
    if (refusal) throw new Error(refusal);
    const { a, item } = found;
    if (!('agent' in a)) throw new Error('A pull request is decided on the board');
    const { agent } = a;
    const reply = await this.answering(agent.id, d, via, () => this.act(agent, d, item.cos?.message ?? '', how));
    // the office asking about cost comes back as it is, to answer again with `how`; otherwise, just that it went through
    return landed(reply) ? { ok: true } : reply;
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
      const sendsAt = a.agent.lead?.cos?.sendsAt;
      return sendsAt !== undefined && sendsAt <= now && this.store.projects.find((p) => p.id === a.agent.projectId)?.cosAutoSend === true;
    });
    for (const { item } of due) {
      await this.decide(item.id, { send: true }, 'chief-of-staff').catch((err: unknown) => console.warn(`[inbox] sending the chief of staff’s words failed: ${errorMessage(err)}`));
    }
  }

  /** Holds the chief of staff's words on an item, so they wait for the captain rather than going by themselves. */
  hold(id: string): void {
    const found = this.items().find(({ item }) => item.id === id);
    if (!found || found.a.kind !== 'turn') throw new Error('That’s no longer waiting on you');
    this.office.agents.holdSend(found.a.agent.id);
  }

  /** Does what the captain decided. `words` are the chief of staff's, for `send`. */
  private act(agent: Agent, d: Decide, words: string, how?: ResumeHow): unknown {
    const agents = this.office.agents;
    if ('allow' in d) return agents.resolvePermission(agent.id, agent.permission?.id ?? '', d.allow);
    if ('option' in d) return agents.answer(agent.id, openQuestion(agent)?.id ?? '', d.option, d.note, how);
    if ('close' in d) return agents.closeGoal(agent.id);
    if ('send' in d) return agents.message(agent.id, words, CHIEF_OF_STAFF, how);
    return agents.message(agent.id, d.text, undefined, how);
  }

  /**
   * The captain answers an agent (`act`, decided `d`): when that answers something waiting on them, it's recorded once
   * it's gone through. A message to a lead at work answers nothing in the inbox, and isn't; nor does a message answer
   * a raised hand.
   */
  async answering<T>(agentId: string, d: Decide, via: DecidedVia, act: () => T | Promise<T>): Promise<T> {
    // what it answers, as it stood before the answer changed it
    const found = this.items().find(({ a, item }) => 'agent' in a && a.agent.id === agentId && !decideRefusal(item, d));
    const a = found?.a;
    const item = found && a && 'agent' in a && { ...found.item, name: a.agent.name, goal: a.agent.lead?.title, projectId: a.agent.projectId };
    const reply = await act();
    const answer = answerText(d);
    if (item && answer && landed(reply)) {
      this.office.agents.record(item.projectId, { kind: 'captain-decision', agent: item.name, ...(item.goal && { goal: item.goal }), item: { id: item.id, kind: item.kind, what: item.what }, answer, via });
    }
    return reply;
  }
}
