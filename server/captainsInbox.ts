import { columns } from '../shared/board';
import { shownProjects } from '../shared/hidden';
import { answerText, type Decide, decideRefusal, type DecidedVia, type Inbox as InboxView, inboxItem, landed, recentDecisions, waiting } from '../shared/captainsInbox';
import { openQuestion } from '../shared/artifacts';
import type { Attention } from '../shared/tricorder';
import type { Agent } from '../shared/types';
import type { Office } from './office';
import type { Store } from './store';

// The captain's inbox, as the API serves it (docs/ledger.md#the-captains-inbox-api): what needs them across the shown projects,
// the same list Comms shows, and each answer recorded in the ledger as a `captain-decision`, whether it came from Comms,
// an agent's panel, or a bot on the API. It keeps nothing itself: what's open is worked out from the agents and boards
// each time, and what was decided is the ledger's.

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
    return waiting(agents, prs, this.store.reviews, agents.filter((a) => a.task === 'lead'));
  }

  view(): InboxView {
    return { open: this.waiting().map((a) => inboxItem(a, this.store.reviews)), decided: recentDecisions(this.store.ledger, Date.now()) };
  }

  /** Answers an item by its id, as the captain would from Comms, and records it. */
  async decide(id: string, d: Decide, via: DecidedVia): Promise<unknown> {
    const a = this.waiting().find((w) => inboxItem(w, this.store.reviews).id === id);
    if (!a) throw new Error('That’s no longer waiting on you');
    const refusal = decideRefusal(a.kind, d);
    if (refusal) throw new Error(refusal);
    if (!('agent' in a)) throw new Error('A pull request is decided on the board');
    const { agent } = a;
    const reply = await this.answering(agent.id, d, via, () => this.act(agent, d));
    // the office asking about cost comes back as it is, to answer again with `how`; otherwise, just that it went through
    return landed(reply) ? { ok: true } : reply;
  }

  private act(agent: Agent, d: Decide): unknown {
    const agents = this.office.agents;
    if ('allow' in d) return agents.resolvePermission(agent.id, agent.permission?.id ?? '', d.allow);
    if ('option' in d) return agents.answer(agent.id, openQuestion(agent)?.id ?? '', d.option, d.note);
    if ('close' in d) return agents.closeGoal(agent.id);
    return agents.message(agent.id, d.text);
  }

  /**
   * The captain answers an agent (`act`, decided `d`): when that answers something waiting on them, it's recorded once
   * it's gone through. A message to a lead at work answers nothing in the inbox, and isn't; nor does a message answer
   * a raised hand.
   */
  async answering<T>(agentId: string, d: Decide, via: DecidedVia, act: () => T | Promise<T>): Promise<T> {
    // what it answers, as it stood before the answer changed it
    const a = this.waiting().find((w) => 'agent' in w && w.agent.id === agentId && !decideRefusal(w.kind, d));
    const item = a && 'agent' in a && { ...inboxItem(a, this.store.reviews), name: a.agent.name, goal: a.agent.lead?.title, projectId: a.agent.projectId };
    const reply = await act();
    const answer = answerText(d);
    if (item && answer && landed(reply)) {
      this.office.agents.record(item.projectId, { kind: 'captain-decision', agent: item.name, ...(item.goal && { goal: item.goal }), item: { id: item.id, kind: item.kind, what: item.what }, answer, via });
    }
    return reply;
  }
}
