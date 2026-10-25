import { Effect, FiberMap } from 'effect';
import { hiredName, randomAvatar } from '../../../shared/crew';
import { type Closer } from '../../../shared/ledger';
import { prKey } from '../../../shared/qa';
import type { Agent, Effort, Planner } from '../../../shared/types';
import { ACTIVE_STATUSES, AWAY_DESK } from '../../../shared/types';
import { newId, slugify } from '../../util';
import { leadWorktreeId, snapshotMessage } from '../lead';
import { offTheFloor, pickDesk } from '../desks';
import { deskless, whoStarts } from '../schedule';
import { Workspace } from '../services';
import { FINISHED, Part, Refused } from './core';

/** Hiring and seating agents, starting them as slots free up, and sending them home. */
export class Seating extends Part {
  private leaving = new Set<string>();

  /** `cloud` puts them in a Claude Code cloud session instead of on this machine. */
  hire(projectId: string, repo: string, issue: { number: number; title?: string; url?: string }, how: { effort?: Effort; cloud?: boolean } = {}): Agent {
    const id = newId('agent');
    const title = issue.title ?? `Issue #${issue.number}`;
    const closed = this.store.closedPrs.get(prKey(repo, issue.number));
    if (closed) {
      // the last attempt was closed as the wrong approach: the new developer hears why
      this.rt(id).inbox.push(`${closed.officer} closed an earlier attempt at this issue (PR #${closed.pr}) because the approach was wrong: ${closed.note}`);
      this.store.removeClosedPr(repo, issue.number);
      this.boardChanged(projectId);
    }
    return this.seat(projectId, repo, {
      id,
      task: 'issue',
      issue: { number: issue.number, title, url: issue.url ?? `https://github.com/${repo}/issues/${issue.number}` },
      branch: `focus/${issue.number}-${slugify(title, 30) || 'issue'}-${id.slice(-4)}`,
      baseBranch: 'main',
      effort: how.effort,
      cloud: how.cloud || undefined,
    });
  }

  /** The agent aboard whose PR this is: the one who opened it, or one seated on it since. */
  prOwner(repo: string, number: number): Agent | undefined {
    return [...this.store.agents.values()].find((a) => a.task !== 'review' && a.repo === repo && a.pr?.number === number);
  }

  /** One of Focus's agents opened the PR (QA's review remembers it after they've gone home). */
  openedByOffice(repo: string, number: number): boolean {
    return !!this.store.reviews.get(prKey(repo, number))?.openedByOffice
      || [...this.store.agents.values()].some((a) => (a.task === 'issue' || a.task === 'brief') && a.repo === repo && a.pr?.number === number);
  }

  /** Someone aboard is working on the PR right now, or queued to. */
  busyOn(repo: string, number: number): boolean {
    const owner = this.prOwner(repo, number);
    return !!owner && !FINISHED.includes(owner.status);
  }

  /** `crew` is who sits down when it's always the same person (a plugin's, on its brief); otherwise someone new is hired. */
  seat(projectId: string, repo: string, work: Pick<Agent, 'id' | 'task' | 'brief' | 'issue' | 'branch' | 'baseBranch' | 'pr' | 'effort' | 'model' | 'cloud'>, crew?: Planner): Agent {
    const project = this.store.project(projectId);
    if (!project.repos.includes(repo)) throw new Refused({ message: `${repo} is not connected to ${project.name}` });
    // QA reviewing the PR, or a goal's lead, isn't working on it the way a developer would; a brief has no issue to share
    const sameWork = (a: Agent) => work.task === 'brief'
      ? a.id === work.id
      : a.task !== 'review' && a.task !== 'lead' && a.task !== 'brief' && a.repo === repo && a.issue.number === work.issue.number;
    const existing = [...this.store.agents.values()].find((a) => sameWork(a) && !FINISHED.includes(a.status));
    if (existing) throw new Refused({ message: work.task === 'brief' ? `${existing.name} is still at work` : `${existing.name} is already working on #${work.issue.number}` });

    // some briefs are worked away from the room's desks (main engineering's climber)
    const desk = this.core.plugins.brief(work.brief)?.away ? AWAY_DESK : this.freeDesk(projectId);
    const avatar = crew?.avatar ?? randomAvatar();
    const name = crew?.name ?? hiredName(projectId, avatar.rank, [...this.store.agents.values()].map((a) => a.name), Math.random());
    const agent: Agent = {
      name,
      avatar,
      projectId,
      repo,
      ...work,
      desk,
      status: 'queued',
      activity: 'Waiting for a free slot',
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.store.putAgent(agent);
    this.store.journal(agent.id, { kind: 'waiting' });
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [{ kind: 'system', text: `${work.brief ? `──────── ✻ ${name} starts on ${repo}: ${work.brief.icon} ${work.brief.label}` : `✻ ${name} joined ${project.name} to work on ${repo}#${work.issue.number}`} (${work.model ? `${work.model}, ` : ''}${work.effort ?? 'default'} effort${work.cloud ? ', in the cloud' : ''})` }]);
    this.schedule();
    return agent;
  }

  /** A desk in the room, sending home whoever finished first when they're all taken (`pickDesk`). */
  private freeDesk(projectId: string): number {
    const pick = pickDesk(this.store.agentsIn(projectId));
    if (!pick) throw new Refused({ message: 'Every desk on this holodeck is taken by a working agent' });
    if (pick.evict) this.background(this.goHome(pick.evict.id));
    return pick.desk;
  }

  /**
   * Starts queued agents while there is room under the global and per-project limits (`whoStarts`). QA goes first, and
   * doesn't count against a room's limit: finished work gets reviewed before new work starts.
   */
  schedule(): void {
    // shutting down: nobody new starts, whoever's in line starts when Focus does
    if (this.core.closing) return;
    const { start, wait } = whoStarts([...this.store.agents.values()], this.store.projects, this.store.settings.maxConcurrent);
    for (const { agent, why } of wait) this.update(agent, { activity: why });
    for (const agent of start) {
      // still finishing their last piece of work: they start once it's over (runFor looks again then)
      if (FiberMap.hasUnsafe(this.runs, agent.id)) continue;
      // saved at a desk the room no longer has: they take one now, or wait for one
      if (offTheFloor(agent)) {
        const pick = pickDesk(this.store.agentsIn(agent.projectId));
        if (!pick) {
          this.update(agent, { activity: 'Waiting for a free desk' });
          continue;
        }
        if (pick.evict) this.background(this.goHome(pick.evict.id));
        this.update(agent, { desk: pick.desk });
      }
      this.runFor(agent.id, this.core.sessions.launch(agent));
    }
  }

  dismiss(id: string): Promise<void> {
    return this.runtime.runPromise(this.goHome(id));
  }

  /** Sends the agent home: their work stops (and with it their Claude Code session) and their checkouts go. */
  goHome(id: string): Effect.Effect<void, never, Workspace> {
    return Effect.gen({ self: this }, function* () {
      const agent = this.store.agents.get(id);
      if (!agent) return;
      this.core.ledger.digestSession(agent, this.core.ledger.prsOf(agent));
      // off the ship first, so their work, as it's interrupted, finds them gone
      this.core.runtimes.get(id)?.session?.stop();
      this.core.runtimes.delete(id);
      for (const h of agent.helpers ?? []) this.store.dropLines(h.id);
      this.store.removeAgent(id);
      this.hub.send({ type: 'agent-removed', id });
      yield* FiberMap.remove(this.runs, id);
      this.schedule();
      const workspace = yield* Workspace;
      const checkouts = agent.lead ? agent.lead.repos.map((r) => ({ repo: r.repo, id: leadWorktreeId(id, r.folder) })) : [{ repo: agent.repo, id }];
      // whatever a lead wrote since the goal closed (its session only stopped just now) goes on the branch too
      const title = agent.lead?.title;
      yield* Effect.forEach(checkouts, (c) =>
        (title ? Effect.ignore(workspace.snapshot(workspace.dir(c.id), snapshotMessage(title))) : Effect.void).pipe(Effect.andThen(workspace.remove(c.repo, c.id))), { discard: true });
    });
  }

  /** Called when a PR an agent opened was merged or closed. The agent packs up and goes home. `headSha` is the commit that merged, when Ops knows it. */
  prClosed(repo: string, number: number, merged: boolean, by: Closer = 'github', headSha?: string): void {
    this.core.ledger.recordLanding(repo, number, merged, by, headSha);
    this.core.reviews.reviewGone(repo, number, merged);
    const goals = this.core.goalPrs.landed(repo, number, merged);
    // every plugin hears of every pull request landing, a goal's too, once the goal knows
    this.core.plugins.prClosed(repo, number, merged);
    if (goals) return;
    const agent = this.prOwner(repo, number);
    if (!agent || this.leaving.has(agent.id)) return;
    this.leaving.add(agent.id);
    this.print(agent, [{ kind: 'success', text: merged ? `🎉 PR #${number} was merged!` : `PR #${number} was closed` }]);
    this.update(agent, { activity: merged ? '🎉 Merged! Packing up' : 'PR closed – packing up' });
    if (merged) this.hub.toast('success', `🎉 Merged ${repo}#${number} – ${agent.name} heads home`, agent.id);
    this.background(Effect.sleep('6 seconds').pipe(
      Effect.andThen(Effect.sync(() => this.leaving.delete(agent.id))),
      Effect.andThen(this.goHome(agent.id)),
    ));
  }

  /** Issues already claimed by an agent who is still aboard. */
  claimed(repo: string): Set<number> {
    return new Set([...this.store.agents.values()].filter((a) => a.repo === repo).map((a) => a.issue.number));
  }

  freeSlots(projectId: string): number {
    const project = this.store.project(projectId);
    const busy = this.store.agentsIn(projectId).filter((a) => !deskless(a) && (a.status === 'queued' || ACTIVE_STATUSES.includes(a.status))).length;
    return Math.max(0, project.maxAgents - busy);
  }
}
