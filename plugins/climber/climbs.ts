import { Effect } from 'effect';
import { type Agent, errorMessage, GitHub, newId, type PluginHost, type PluginState } from '../../plugin-api/server';
import type { ScorecardService } from '../scorecard/api';
import { climbBrief, climbHome, climbLog, climbStep } from './climb';
import { CLIMB_BRANCH, CLIMB_ENDS_KEPT, CLIMBER_ID, climbingEngineer, freshClimb, type Climb } from './shared';

/** How many of main's latest scorecards a brief looks through, to see whether past gains held. */
const SCORECARDS_READ = 30;

/**
 * Main engineering's climber (README.md): while the captain keeps climbing switched on, one climb at a time on the
 * office's own repo, all of them by one engineer (`climbingEngineer`, at `CLIMBER_ID`), in a fresh session each time. A
 * climb is the plugin's `climb` brief: they measure, fix the worst gap and the office opens their pull request like any
 * developer's, but it never merges by itself. The next climb starts once it's merged or closed; a climb that ends
 * without a pull request switches climbing off, saying why.
 */
export class Climbs {
  private readonly climb: PluginState<Climb>;

  /** Main's scorecards, from the scorecard plugin, which the climber requires. */
  private readonly scorecards: ScorecardService;

  constructor(private readonly host: PluginHost) {
    this.scorecards = host.uses<ScorecardService>('scorecard');
    this.climb = host.state(freshClimb);
  }

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
          this.host.print(agent, `✻ Couldn’t read the past climbs from GitHub, so the brief has none: ${err.message}`);
          return [];
        })),
      );
      // this climb's own pull request isn't open yet; one left open from before is still part of the record
      const noise = this.scorecards.noise();
      const log = climbLog(prs.filter((p) => p.branch !== agent.branch), this.climb.get().ends ?? [], status.login, {
        history: this.scorecards.history(SCORECARDS_READ),
        direction: (m, before) => this.scorecards.direction(m, before),
        formatValue: (value, format) => this.scorecards.formatValue(value, format),
      });
      return climbBrief(agent, this.host.ledger(), Date.now(), log, noise);
    });
  }

  current(): Climb {
    return this.climb.get();
  }

  /** The captain's switch: climbs on the project with the office's own repo (the demo's first project's). */
  keepClimbing(on: boolean): Climb {
    const home = climbHome(this.host.projects(), this.host.ownRepo(), this.host.demo);
    if (on && !home) throw new Error('Connect the office’s own repository to a project first: that’s what the climber works on');
    this.climb.set({ keepClimbing: on, stoppedWhy: undefined, ...(on && home) });
    this.settle();
    return this.current();
  }

  /**
   * Looks at the climb under way: notes its pull request once it's open (so the climb outlives its climber going
   * home), starts the next when climbing is on and none is open, and switches climbing off when the last one ended
   * without a pull request.
   */
  settle(): void {
    const climb = this.climb.get();
    // between climbs, the engineer may still be finishing the last one
    const climber = this.host.agent(climb.agentId ?? CLIMBER_ID);
    if (climb.agentId && climber?.pr && !climb.pr) this.climb.set({ pr: { number: climber.pr.number, url: climber.pr.url } });
    const step = climbStep(this.climb.get(), climber);
    if (step.kind === 'start') this.start();
    if (step.kind === 'stop') {
      const end = { at: Date.now(), outcome: step.outcome, why: step.why };
      this.climb.set({ keepClimbing: false, agentId: undefined, stoppedWhy: step.why, last: { outcome: step.outcome, at: end.at }, ends: [...(climb.ends ?? []), end].slice(-CLIMB_ENDS_KEPT) });
      this.host.toast('info', `Climbing switched off: ${step.why}`, climb.agentId);
    }
  }

  /** The office opened (or updated) a climber's pull request: the climb holds on to it, whatever happens to the climber next. */
  opened(agentId: string, pr: { number: number; url: string }): void {
    const climb = this.climb.get();
    if (climb.agentId !== agentId || climb.pr?.number === pr.number) return;
    this.climb.set({ pr: { number: pr.number, url: pr.url } });
  }

  /** A pull request merged or closed: when it was the climb's, the climb is over, and the next one starts if climbing is on. */
  prClosed(repo: string, number: number, merged: boolean): void {
    const climb = this.climb.get();
    const climber = climb.agentId ? this.host.agent(climb.agentId) : undefined;
    const pr = climb.pr?.number ?? climber?.pr?.number;
    if (climb.repo !== repo || pr !== number) return;
    this.climb.set({ agentId: undefined, pr: undefined, last: { pr: number, outcome: merged ? 'merged' : 'closed', at: Date.now() } });
    this.settle();
  }

  private start(): void {
    const { projectId, repo, cycles } = this.climb.get();
    try {
      if (!projectId || !repo) throw new Error('No repository to climb');
      // the same engineer every climb, starting afresh: nothing left over from the last session
      this.host.forget(CLIMBER_ID);
      const agent = this.host.seat(projectId, repo, {
        id: CLIMBER_ID,
        kind: 'climb',
        title: 'Climbing the scorecard',
        branch: `${CLIMB_BRANCH}${newId('climb').slice(-6)}`,
        baseBranch: 'main',
      }, climbingEngineer());
      this.climb.set({ agentId: agent.id, pr: undefined, cycles: cycles + 1 });
    } catch (err) {
      this.climb.set({ keepClimbing: false, stoppedWhy: `Couldn’t start a climb: ${errorMessage(err)}` });
    }
  }
}
