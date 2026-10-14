import { Effect } from 'effect';
import type { Agent, Climb, Scorecard, ScorecardNoise } from '../../../shared/types';
import { climbingEngineer } from '../../../shared/crew';
import { CLIMB_BRANCH, CLIMB_ENDS_KEPT, CLIMBER_ID } from '../../../shared/types';
import { errorMessage, newId } from '../../util';
import { GitHub } from '../../github/service';
import { climbBrief, climbLog, climbStep } from '../climb';
import { Part, Refused } from './core';

/** How many of main's latest scorecards a brief looks through, to see whether past gains held. */
const SCORECARDS_READ = 30;

/**
 * Main engineering's climber (docs/climber.md): while the captain keeps climbing switched on, one climb at a time on the
 * office's own repo, all of them by one engineer (`climbingEngineer`, at `CLIMBER_ID`), in a fresh session each time. A
 * climb is a `climb` task: they measure, fix the worst gap and the office opens their pull request like any developer's,
 * but it never merges by itself. The next climb starts once it's merged or
 * closed; a climb that ends without a pull request switches climbing off, saying why.
 */
export class Climbs extends Part {
  /** Where a climb's brief reads main's scorecards and the noise floor from (the office's own, set as it starts). */
  scorecards: { history(limit: number): Scorecard[]; noise(): ScorecardNoise | undefined } = { history: () => [], noise: () => undefined };

  /**
   * The climb's first message: the brief, with every climb before it as GitHub and the office remember them (the
   * captain's own words on each, and whether a merged gain has held on main). GitHub failing costs the log, not the climb.
   */
  brief(agent: Agent): Effect.Effect<string, never, GitHub> {
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const status = yield* github.status;
      const prs = yield* github.pullRequestsFrom(agent.repo, CLIMB_BRANCH).pipe(
        Effect.catch((err) => Effect.sync(() => {
          this.print(agent, [{ kind: 'system', text: `✻ Couldn’t read the past climbs from GitHub, so the brief has none: ${err.message}` }]);
          return [];
        })),
      );
      // this climb's own pull request isn't open yet; one left open from before is still part of the record
      const noise = this.scorecards.noise();
      const log = climbLog(prs.filter((p) => p.branch !== agent.branch), this.store.climb.ends ?? [], status.login, this.scorecards.history(SCORECARDS_READ), noise);
      return climbBrief(agent, this.store.ledger, Date.now(), log, noise);
    });
  }

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
      const end = { at: Date.now(), outcome: step.outcome, why: step.why };
      this.set({ keepClimbing: false, agentId: undefined, stoppedWhy: step.why, last: { outcome: step.outcome, at: end.at }, ends: [...(climb.ends ?? []), end].slice(-CLIMB_ENDS_KEPT) });
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
