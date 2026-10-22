import { autonomyChangeLine } from '../../../shared/autonomy';
import { goneReply } from '../../../shared/mergeGate';
import type { Agent, Autonomy, Effort, MessageReply, ResumeHow } from '../../../shared/types';
import { truncate } from '../../util';
import { resumeChoice } from '../apiKey';
import { backgroundStop } from '../lead';
import { STOPPED_BY_CAPTAIN } from '../types';
import { FINISHED, Part, Refused } from './core';

const SENT: MessageReply = { sent: true };

/** The captain's word with an agent: messages, approvals, stopping them, their effort and autonomy, reading a lead's turn, and the plugins' marks on it. */
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

  /**
   * What the agent may do without asking, for them alone (Focus's own setting stays as it is): at once in a local
   * session that's running, from their next turn in a cloud one, and on every later turn and resume.
   */
  setAutonomy(id: string, autonomy: Autonomy): Agent {
    const agent = this.store.agent(id);
    if (agent.autonomy === autonomy) return agent;
    this.update(agent, { autonomy });
    const session = this.rt(id).session;
    const applied = session ? (session.setAutonomy?.(autonomy) ?? false) : undefined;
    this.print(agent, [{ kind: 'system', text: autonomyChangeLine(agent.name, autonomy, applied === undefined ? 'none' : applied ? 'live' : 'next-turn') }]);
    return agent;
  }

  /** The captain has read the lead's latest turn: it stops hailing them, on every screen, until their next one ends. */
  readTurn(id: string): void {
    const agent = this.store.agent(id);
    if (!agent.lead || agent.status !== 'done' || agent.finishedAt === undefined || agent.lead.readTurn === agent.finishedAt) return;
    this.update(agent, { lead: { ...agent.lead, readTurn: agent.finishedAt } });
  }

  /**
   * Plugin `plugin`'s mark on a lead's latest turn (`PluginGoals.mark`): kept until their next turn starts. Refused for
   * anyone but a goal's lead, while a turn is under way (its journal has it open: one a restart cuts off starts again,
   * clearing what was marked) or Focus goes down (a turn it stops then carries on after the restart), and, given
   * `since`, once a turn later than the one it's about has started.
   */
  mark(id: string, plugin: string, data: unknown, since?: number): boolean {
    const agent = this.store.agents.get(id);
    const started = agent?.lead?.turnStarted;
    if (!agent?.lead || this.core.closing || this.store.run(id).open) return false;
    if (since !== undefined && started !== undefined && started > since) return false;
    const { [plugin]: _, ...others } = agent.lead.marks ?? {};
    const marks = data === undefined ? others : { ...others, [plugin]: data };
    this.update(agent, { lead: { ...agent.lead, marks: Object.keys(marks).length ? marks : undefined } });
    return true;
  }

  /**
   * Sends the agent a message: the captain's, or (with `from`) news from someone else aboard. When it would pick their
   * conversation back up on your API key, at a cost worth asking about, the captain's `how` says whether to go ahead or
   * wait for your plan's limit to reset; without it, the captain is asked first, and anyone else's news waits. A
   * goal lead's notes (`Inbox.note`) go with it, whoever's it is.
   */
  message(id: string, text: string, from?: string, how?: ResumeHow): MessageReply {
    const agent = this.store.agent(id);
    const rt = this.rt(id);
    text = text.trim();
    if (!text) return SENT;
    const pickingUp = !(agent.task === 'review' && agent.prGone) && !agent.handover && !rt.session
      && agent.status !== 'queued' && !rt.busy && agent.status !== 'setting-up';
    const cost = pickingUp ? this.core.planLimit.resumeCost(agent) : undefined;
    const choice = resumeChoice(cost?.usd, how, !from);
    if (choice === 'ask' && cost) return { costly: cost };
    this.print(agent, [{ kind: 'manager', text: `▶ ${from ?? 'Captain'}: ${text}` }]);
    // the captain carries on with a goal the lead thought was done
    if (!from && agent.lead?.closing) this.update(agent, { lead: { ...agent.lead, closing: undefined } });
    if (from) text = `[${from}] ${text}`;

    // a QA officer whose PR merged or closed has nothing left to review: their session stays over
    if (agent.task === 'review' && agent.prGone) {
      const reply = goneReply(agent.issue.number, agent.prGone);
      this.print(agent, [{ kind: 'system', text: `✻ ${reply}` }]);
      this.hub.toast('info', `${agent.name}: ${reply}`, agent.id);
      return SENT;
    }

    if (agent.handover) {
      rt.inbox.push(text);
      this.print(agent, [{ kind: 'system', text: `✻ ${agent.name} will read it once their cloud session has started` }]);
      return SENT;
    }
    if (this.sendInto(agent, text)) return SENT;
    if (agent.status === 'queued' || rt.busy || agent.status === 'setting-up') {
      rt.inbox.push(text);
      return SENT;
    }
    rt.inbox.push(text);
    if (choice === 'hold') this.core.planLimit.hold(agent, cost);
    else this.pickUp(agent);
    return SENT;
  }

  /**
   * Sends a message into the agent's session, if one's listening: a lead's notes go with it, ahead of it, and count as
   * heard once they're in, even if the message then isn't. Whether the message went in.
   */
  private sendInto(agent: Agent, text: string): boolean {
    const rt = this.rt(agent.id);
    const notesIn = rt.session && rt.inbox.notes.every((m) => rt.session?.send(m));
    if (notesIn && rt.turn) rt.inbox.notesSent(rt.turn);
    if (!notesIn || !rt.session?.send(text)) return false;
    if (rt.turn) this.store.journal(agent.id, { kind: 'sent', turn: rt.turn, text });
    if (!rt.permission) this.update(agent, { activity: 'Reading your message' });
    return true;
  }

  /**
   * Stops one of a lead's background commands or monitors, and tells the lead, so it doesn't wonder where it went.
   * Refused when the lead's session isn't listening to ask (it's ended, and the command with it).
   */
  async stopBackground(id: string, taskId: string): Promise<{ stopped: boolean }> {
    const stop = backgroundStop(this.store.agents.get(id), taskId);
    const session = this.rt(id).session;
    if (!stop || !session?.stopTask || !(await session.stopTask(taskId))) return { stopped: false };
    this.message(id, stop.note);
    return { stopped: true };
  }

  /**
   * Finished, stopped, failed or on hold: they pick their conversation back up (or start over, with no session to go
   * back to) once there's a free slot, like any agent starting work, hearing what's in their inbox.
   */
  pickUp(agent: Agent): void {
    const rt = this.rt(agent.id);
    rt.nudged = false;
    rt.resume = !!agent.sessionId;
    this.update(agent, { status: 'queued', activity: 'Waiting for a free slot', error: undefined, held: undefined });
    this.core.seating.schedule();
  }

  resolvePermission(id: string, requestId: string, allow: boolean): void {
    const agent = this.store.agent(id);
    const rt = this.rt(id);
    const pending = rt.permission;
    if (!pending || pending.req.id !== requestId) throw new Refused({ message: 'That request is no longer pending' });
    rt.permission = undefined;
    if (rt.turn) this.store.journal(id, { kind: 'answered', turn: rt.turn, allow });
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
    // held for your plan's limit: they don't carry on by themselves when it resets. Focus shutting down isn't the
    // captain's stop: the hold stays in their journal, to hold them again when it starts
    if (agent.held && !this.core.closing) this.update(agent, { held: undefined, activity: STOPPED_BY_CAPTAIN });
    if (agent.handover) {
      void this.core.cloud.stayLocal(id, false).catch(() => undefined);
    } else if (rt.session) {
      // the captain's stop, not Focus shutting down: a restart doesn't undo it
      if (rt.turn && !this.core.closing) this.store.journal(id, { kind: 'stop-requested', turn: rt.turn });
      rt.session.stop();
    } else if (!FINISHED.includes(agent.status)) {
      this.update(agent, { status: 'stopped', activity: STOPPED_BY_CAPTAIN, finishedAt: Date.now() });
      this.core.seating.schedule();
    }
  }
}
