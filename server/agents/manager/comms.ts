import { goneReply } from '../../../shared/mergeGate';
import type { Agent, Effort } from '../../../shared/types';
import { truncate } from '../../util';
import { STOPPED_BY_CAPTAIN } from '../types';
import { FINISHED, Part, Refused } from './core';

/** The captain's word with an agent: messages, approvals, stopping them, their effort, and reading a lead's turn. */
export class Comms extends Part {
  /** How hard the agent thinks from now on: from its next request if it's working, else from its next turn. */
  setEffort(id: string, effort: Effort): Agent {
    const agent = this.store.agent(id);
    if (agent.effort === effort) return agent;
    this.update(agent, { effort });
    this.rt(id).session?.setEffort?.(effort);
    this.print(agent, [{ kind: 'system', text: `✻ The captain set ${agent.name}'s effort to ${effort}` }]);
    return agent;
  }

  /** The captain has read the lead's latest turn: it stops hailing them, on every screen, until their next one ends. */
  readTurn(id: string): void {
    const agent = this.store.agent(id);
    if (!agent.lead || agent.status !== 'done' || agent.finishedAt === undefined || agent.lead.readTurn === agent.finishedAt) return;
    this.update(agent, { lead: { ...agent.lead, readTurn: agent.finishedAt } });
  }

  /** Sends the agent a message: the captain's, or (with `from`) news from someone else aboard. */
  message(id: string, text: string, from?: string): void {
    const agent = this.store.agent(id);
    const rt = this.rt(id);
    text = text.trim();
    if (!text) return;
    this.print(agent, [{ kind: 'manager', text: `▶ ${from ?? 'Captain'}: ${text}` }]);
    // the captain carries on with a goal the lead thought was done
    if (!from && agent.lead?.closing) this.update(agent, { lead: { ...agent.lead, closing: undefined } });
    if (from) text = `[${from}] ${text}`;

    // a QA officer whose PR merged or closed has nothing left to review: their session stays over
    if (agent.task === 'review' && agent.prGone) {
      const reply = goneReply(agent.issue.number, agent.prGone);
      this.print(agent, [{ kind: 'system', text: `✻ ${reply}` }]);
      this.hub.toast('info', `${agent.name}: ${reply}`, agent.id);
      return;
    }

    if (agent.handover) {
      rt.inbox.push(text);
      this.print(agent, [{ kind: 'system', text: `✻ ${agent.name} will read it once their cloud session has started` }]);
      return;
    }
    if (rt.session?.send(text)) {
      if (!rt.permission) this.update(agent, { activity: 'Reading your message' });
      return;
    }
    if (agent.status === 'queued' || rt.busy || agent.status === 'setting-up') {
      rt.inbox.push(text);
      return;
    }
    // Finished, stopped or failed: pick the conversation back up (or start over, with no session to go back to) once
    // there's a free slot, like any agent starting work.
    rt.nudged = false;
    rt.inbox.push(text);
    rt.resume = !!agent.sessionId;
    this.update(agent, { status: 'queued', activity: 'Waiting for a free slot', error: undefined });
    this.core.seating.schedule();
  }

  resolvePermission(id: string, requestId: string, allow: boolean): void {
    const agent = this.store.agent(id);
    const rt = this.rt(id);
    const pending = rt.permission;
    if (!pending || pending.req.id !== requestId) throw new Refused({ message: 'That request is no longer pending' });
    rt.permission = undefined;
    this.print(agent, [{ kind: 'manager', text: `${allow ? '✔ Approved' : '✘ Declined'} by the captain: ${pending.req.summary}` }]);
    this.update(agent, {
      status: pending.resume,
      permission: undefined,
      activity: allow ? `Approved: ${truncate(pending.req.summary, 60)}` : 'Finding another way',
    });
    pending.resolve(allow);
  }

  stop(id: string): void {
    const agent = this.store.agent(id);
    const rt = this.rt(id);
    if (agent.handover) {
      void this.core.cloud.stayLocal(id, false).catch(() => undefined);
    } else if (rt.session) {
      rt.session.stop();
    } else if (!FINISHED.includes(agent.status)) {
      this.update(agent, { status: 'stopped', activity: STOPPED_BY_CAPTAIN, finishedAt: Date.now() });
      this.core.seating.schedule();
    }
  }
}
