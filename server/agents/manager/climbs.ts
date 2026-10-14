import type { Climb } from '../../../shared/types';
import { climbingEngineer } from '../../../shared/crew';
import { CLIMB_BRANCH, CLIMBER_ID } from '../../../shared/types';
import { errorMessage, newId } from '../../util';
import { climbStep } from '../climb';
import { Part, Refused } from './core';

/**
 * Main engineering's climber (docs/climber.md): while the captain keeps climbing switched on, one climb at a time on the
 * office's own repo, all of them by one engineer (`climbingEngineer`, at `CLIMBER_ID`), in a fresh session each time. A
 * climb is a `climb` task: they measure, fix the worst gap and the office opens their pull request like any developer's,
 * but it never merges by itself. The next climb starts once it's merged or
 * closed; a climb that ends without a pull request switches climbing off, saying why.
 */
export class Climbs extends Part {
  current(): Climb {
    return this.store.climb;
  }

  /** The captain's switch. `home` is where the climbs are: the project and repo the office itself runs from. */
  keepClimbing(on: boolean, home: { projectId: string; repo: string } | undefined): Climb {
    if (on && !home) throw new Refused({ message: 'Connect the office’s own repository to a project first: that’s what the climber works on' });
    this.set({ keepClimbing: on, stoppedWhy: undefined, ...(on && home) });
    this.settle();
    return this.current();
  }

  /**
   * Looks at the climb under way: notes its pull request once it's open (so the climb outlives its climber going
   * home), starts the next when climbing is on and none is open, and switches climbing off when the last one ended
   * without a pull request.
   */
  settle(): void {
    const climb = this.store.climb;
    // between climbs, the engineer may still be finishing the last one
    const climber = this.store.agents.get(climb.agentId ?? CLIMBER_ID);
    if (climb.agentId && climber?.pr && !climb.pr) this.set({ pr: { number: climber.pr.number, url: climber.pr.url } });
    const step = climbStep(this.store.climb, climber);
    if (step.kind === 'start') this.start();
    if (step.kind === 'stop') {
      this.set({ keepClimbing: false, agentId: undefined, stoppedWhy: step.why, last: { outcome: step.outcome, at: Date.now() } });
      this.hub.toast('info', `Climbing switched off: ${step.why}`, climb.agentId);
    }
  }

  /** The office opened (or updated) a climber's pull request: the climb holds on to it, whatever happens to the climber next. */
  opened(agentId: string, pr: { number: number; url: string }): void {
    if (this.store.climb.agentId !== agentId || this.store.climb.pr?.number === pr.number) return;
    this.set({ pr: { number: pr.number, url: pr.url } });
  }

  /** A pull request merged or closed: when it was the climb's, the climb is over, and the next one starts if climbing is on. */
  prClosed(repo: string, number: number, merged: boolean): void {
    const climb = this.store.climb;
    const climber = climb.agentId ? this.store.agents.get(climb.agentId) : undefined;
    const pr = climb.pr?.number ?? climber?.pr?.number;
    if (climb.repo !== repo || pr !== number) return;
    this.set({ agentId: undefined, pr: undefined, last: { pr: number, outcome: merged ? 'merged' : 'closed', at: Date.now() } });
    this.settle();
  }

  private start(): void {
    const { projectId, repo, cycles } = this.store.climb;
    try {
      if (!projectId || !repo) throw new Refused({ message: 'No repository to climb' });
      // the same engineer every climb, starting afresh: nothing left over from the last session
      this.core.runtimes.delete(CLIMBER_ID);
      const agent = this.core.seating.seat(projectId, repo, {
        id: CLIMBER_ID,
        task: 'climb',
        issue: { number: 0, title: 'Climbing the scorecard', url: '' },
        branch: `${CLIMB_BRANCH}${newId('climb').slice(-6)}`,
        baseBranch: 'main',
      }, climbingEngineer());
      this.set({ agentId: agent.id, pr: undefined, cycles: cycles + 1 });
    } catch (err) {
      this.set({ keepClimbing: false, stoppedWhy: `Couldn’t start a climb: ${errorMessage(err)}` });
    }
  }

  private set(patch: Partial<Climb>): void {
    this.store.climb = { ...this.store.climb, ...patch };
    this.store.save();
    this.hub.send({ type: 'climb', climb: this.store.climb });
  }
}
