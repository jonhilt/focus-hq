import { Duration, Effect } from 'effect';
import { clock } from '../../../shared/clock';
import type { Agent, ResumeCost } from '../../../shared/types';
import { afterLimit, keyFallback, rereadUsd, UNKNOWN_RESET_MS } from '../apiKey';
import { type ManagerServices, Part, type WorkError } from './core';

/** What an agent the plan's limit stopped mid-turn hears when they carry on, on the key or once it resets. */
export const CARRY_ON_AFTER_LIMIT = 'Ops paused you mid-turn when its Claude usage limit was reached. Carry on where you left off.';

/**
 * Your plan's usage limit, reached: who carries on with your API key straight away, and who waits for it to reset,
 * because picking their conversation back up on the key would cost more than Ops spends without asking.
 */
export class PlanLimit extends Part {
  /** What picking the agent's conversation back up costs, while new sessions start on the key; undefined on your plan. */
  resumeCost(agent: Agent): ResumeCost | undefined {
    const resetsAt = keyFallback.resetsAt();
    if (keyFallback.mode !== 'fallback' || !resetsAt || !keyFallback.onKey() || !agent.sessionId || agent.cloud || !agent.context) return undefined;
    const tokens = agent.context.tokens;
    return { usd: rereadUsd(tokens, agent.model || this.store.settings.model), tokens, resetsAt };
  }

  /**
   * The plan's limit stopped the agent mid-turn (`prompt` was the turn's): they carry on with the key, or wait for the
   * limit to reset.
   */
  limited(agent: Agent, prompt: string): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.suspend(() => {
      const cost = this.resumeCost(agent);
      // without a conversation to go back to, the turn starts over
      const carryOn = agent.sessionId ? CARRY_ON_AFTER_LIMIT : prompt;
      if (afterLimit(cost?.usd, keyFallback.onKey()) === 'carry-on') {
        this.print(agent, [{ kind: 'system', text: '✻ Carrying on with your API key' }]);
        return this.core.sessions.runSession(agent, carryOn, agent.sessionId);
      }
      this.rt(agent.id).inbox.unshift(carryOn);
      this.update(agent, { status: 'stopped', finishedAt: Date.now() });
      this.hold(agent, cost);
      this.core.seating.schedule();
      return Effect.void;
    });
  }

  /**
   * Holds the agent until the plan's limit resets, with what's in their inbox to hear then. `cost` is what carrying on
   * with the key would have cost.
   */
  hold(agent: Agent, cost: ResumeCost | undefined): void {
    const until = keyFallback.resetsAt() ?? Date.now() + UNKNOWN_RESET_MS;
    const already = agent.held?.until === until;
    this.update(agent, { held: { until }, activity: `On hold until your plan's usage limit resets at ${clock(until)}` });
    if (already) return;
    const why = !keyFallback.onKey()
      ? `: your API key's budget of $${keyFallback.budgetUsd} is spent`
      : cost ? `: picking their conversation back up on your API key would cost about $${cost.usd.toFixed(2)}` : '';
    this.print(agent, [{ kind: 'system', text: `✻ On hold until your plan's usage limit resets at ${clock(until)}${why}. Send them a message to carry on sooner.` }]);
    this.hub.toast('info', `⏸ ${agent.name} waits for your plan's usage limit to reset at ${clock(until)}`, agent.id);
    this.releaseAt(agent.id, until);
  }

  /**
   * After a restart, an agent the journal says was on hold: held again till `until`, with what's in their inbox to hear
   * then, or carrying on now if the limit's reset meanwhile.
   */
  holdUntil(agent: Agent, until: number): void {
    if (until <= Date.now()) {
      this.print(agent, [{ kind: 'system', text: "✻ Your plan's usage limit reset while Focus was stopped: carrying on" }]);
      this.core.comms.pickUp(agent);
      return;
    }
    this.update(agent, { held: { until }, activity: `On hold until your plan's usage limit resets at ${clock(until)}` });
    this.print(agent, [{ kind: 'system', text: `✻ Still on hold until your plan's usage limit resets at ${clock(until)}. Send them a message to carry on sooner.` }]);
    this.releaseAt(agent.id, until);
  }

  /** At `until`, the held agent carries on, unless the limit's been reached again meanwhile. */
  private releaseAt(id: string, until: number): void {
    this.background(Effect.sleep(Duration.millis(Math.max(0, until - Date.now()) + 1000)).pipe(Effect.andThen(Effect.sync(() => {
      const agent = this.store.agents.get(id);
      if (!agent?.held) return;
      const later = keyFallback.resetsAt();
      if (later) {
        if (later !== agent.held.until) this.hold(agent, undefined);
        return;
      }
      this.print(agent, [{ kind: 'system', text: "✻ Your plan's usage limit has reset: carrying on" }]);
      this.core.comms.pickUp(agent);
    }))));
  }
}
