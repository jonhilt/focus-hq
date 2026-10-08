import { Effect } from 'effect';
import { leadFor, leadId } from '../../../shared/crew';
import type { Agent, Effort, QaReport, QueuedGoal } from '../../../shared/types';
import { LEAD_DESK, TEAM_STATIONS } from '../../../shared/types';
import { GitHub } from '../../github/service';
import { newId } from '../../util';
import { afterVerdict, closeCheck, fileGoal, leftLog, freshSessionPrompt, goalBrief, goalEffort, goalRecord, goalReviewerId, goalTitle, landedMidTurnNote, landedNote, leadWorktreeId, moveQueued, nextGoal, pickStation, qaVerdictNote, reopenable, reopenedNote, reopenedWork, sliceBranch, sliceLanded, snapshotMessage, repoBranch } from '../lead';
import { Workspace } from '../services';
import { type ManagerServices, Part, Refused, type WorkError } from './core';

/** Goals and their leads: starting, queueing, reopening and closing goals, and what the lead hears about their pull requests. */
export class Leads extends Part {
  /** The leads whose goal is closing right now: nothing of theirs ships, so a WIP snapshot never reaches a pull request. */
  closingGoals = new Set<string>();

  /**
   * Starts a goal at one of the room's team stations: a lead of its own (the captain's own Claude Code session for the
   * goal), with every repo of the project checked out on the goal's first branch, who hears `text` first. `station`
   * picks the station; otherwise the goal takes the first free one. Later messages go to the lead like any agent's.
   */
  startGoal(projectId: string, text: string, how: { station?: number; effort?: Effort; from?: string } = {}): { agent: Agent } | { queued: QueuedGoal } {
    const project = this.store.project(projectId);
    if (!project.repos.length) throw new Refused({ message: `Connect a repository to ${project.name} first` });
    if (!text.trim()) throw new Refused({ message: 'Tell them what you’re after' });
    const leads = this.store.agentsIn(projectId).filter((a) => a.task === 'lead');
    // goals already waiting go first: a new one joins the line behind them, even if a station has just come free
    if (how.station === undefined && project.goalQueue?.length) return { queued: this.queueGoal(projectId, text, how) };
    const station = pickStation(leads.map((a) => a.lead?.station ?? 0), how.station);
    if (station === undefined) {
      const wanted = how.station;
      if (wanted === undefined) return { queued: this.queueGoal(projectId, text, how) };
      const holder = leads.find((a) => a.lead?.station === wanted);
      throw new Refused({ message: holder ? `Team station ${wanted + 1} already has a goal: ${holder.lead?.title ?? holder.name}` : `${project.name} has team stations 1 to ${TEAM_STATIONS}` });
    }
    const suffix = newId('g').slice(-6);
    const id = leadId(projectId, suffix);
    const crew = leadFor(projectId, suffix, leads.map((a) => a.name));
    const title = goalTitle(text);
    const effort = goalEffort(how.effort, this.store.settings);
    const agent: Agent = {
      id,
      name: crew.name,
      avatar: crew.avatar,
      projectId,
      repo: project.repos[0],
      task: 'lead',
      issue: { number: 0, title, url: '' },
      effort,
      desk: LEAD_DESK,
      status: 'queued',
      activity: `Coming over to team station ${station + 1}`,
      branch: sliceBranch(title, 1, newId('s').slice(-4)),
      baseBranch: 'main',
      lead: { station, title, brief: goalBrief(text), repos: [], slice: 1, prs: [] },
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.core.runtimes.set(id, { inbox: [text.trim()], notes: [], nudged: false, busy: false });
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [
      { kind: 'system', text: `✻ ${crew.name} takes team station ${station + 1} to lead “${title}” across ${project.repos.join(', ')} (${effort} effort)` },
      { kind: 'manager', text: `▶ ${how.from ? `Captain, from ${how.from}` : 'Captain'}: ${text.trim()}` },
    ]);
    this.core.seating.schedule();
    return { agent };
  }

  /**
   * Reopens a closed goal from the room's log at a free team station (`station`, or the first free one): the same lead,
   * so Claude Code finds their conversation again, with every repo checked out on the goal's branch as it was left.
   */
  reopenGoal(projectId: string, goalId: string, station?: number): Agent {
    const project = this.store.project(projectId);
    const goal = (project.goals ?? []).find((g) => g.id === goalId);
    if (!goal) throw new Refused({ message: 'That goal isn’t in the room’s log' });
    if (!reopenable(goal)) throw new Refused({ message: `“${goal.title}” closed before the office kept its branch, so it can’t be reopened` });
    if (this.store.agents.has(goal.id)) throw new Refused({ message: `“${goal.title}” is already under way` });
    const leads = this.store.agentsIn(projectId).filter((a) => a.task === 'lead');
    const free = pickStation(leads.map((a) => a.lead?.station ?? 0), station) ?? pickStation(leads.map((a) => a.lead?.station ?? 0));
    if (free === undefined) throw new Refused({ message: `Every team station in ${project.name} has a goal: close one first` });
    const crew = leadFor(projectId, goal.id.split('_').at(-1)!, leads.map((a) => a.name));
    const agent: Agent = {
      id: goal.id,
      name: leads.some((a) => a.name === goal.leadName) ? crew.name : goal.leadName,
      avatar: crew.avatar,
      projectId,
      repo: goal.repos![0].repo,
      task: 'lead',
      issue: { number: 0, title: goal.title, url: '' },
      effort: goalEffort(undefined, this.store.settings),
      desk: LEAD_DESK,
      status: 'queued',
      activity: `Coming back to team station ${free + 1}`,
      branch: goal.branch!,
      baseBranch: goal.repos![0].baseBranch,
      lead: reopenedWork(goal, free),
      sessionId: goal.sessionId,
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.core.runtimes.set(agent.id, { inbox: [], notes: [], nudged: false, busy: false });
    project.goals = (project.goals ?? []).filter((g) => g.id !== goal.id);
    this.projectsChanged();
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [{ kind: 'system', text: `✻ The captain reopened “${goal.title}”: ${agent.name} comes back to team station ${free + 1}, on ${goal.branch}` }]);
    this.core.seating.schedule();
    return agent;
  }

  /** Puts a goal in line for the next free team station. It waits there for the captain to start it. */
  private queueGoal(projectId: string, text: string, how: { effort?: Effort; from?: string }): QueuedGoal {
    const project = this.store.project(projectId);
    const queued: QueuedGoal = { id: newId('q'), text: text.trim(), effort: how.effort, from: how.from, at: Date.now() };
    const ahead = project.goalQueue?.length ?? 0;
    this.changeQueue(projectId, [...(project.goalQueue ?? []), queued]);
    this.hub.toast('info', `🧭 “${goalTitle(text)}” waits in line for a team station in ${project.name}${ahead ? `, behind ${ahead} other goal${ahead === 1 ? '' : 's'}` : ''}`, undefined, projectId);
    return queued;
  }

  private changeQueue(projectId: string, queue: QueuedGoal[]): void {
    this.store.project(projectId).goalQueue = queue;
    this.projectsChanged();
  }

  private projectsChanged(): void {
    this.store.save();
    this.hub.send({ type: 'projects', projects: this.store.projects });
  }

  /** Starts a queued goal at a free team station, with the captain's last edits to it. */
  startQueued(projectId: string, queueId: string, edits: { text?: string; effort?: Effort; station?: number } = {}): Agent {
    const project = this.store.project(projectId);
    const queued = (project.goalQueue ?? []).find((g) => g.id === queueId);
    if (!queued) throw new Refused({ message: 'That goal is no longer in line' });
    const leads = this.store.agentsIn(projectId).filter((a) => a.task === 'lead');
    // the station the captain started it from, if it's still free; else the first free one
    const taken = leads.map((a) => a.lead?.station ?? 0);
    const station = (edits.station === undefined ? undefined : pickStation(taken, edits.station)) ?? pickStation(taken);
    if (station === undefined) throw new Refused({ message: `Every team station in ${project.name} still has a goal` });
    const started = this.startGoal(projectId, edits.text?.trim() || queued.text, { station, effort: edits.effort ?? queued.effort, from: queued.from });
    if (!('agent' in started)) throw new Refused({ message: 'No team station was free after all' });
    this.changeQueue(projectId, (project.goalQueue ?? []).filter((g) => g.id !== queueId));
    return started.agent;
  }

  dropQueued(projectId: string, queueId: string): void {
    this.changeQueue(projectId, (this.store.project(projectId).goalQueue ?? []).filter((g) => g.id !== queueId));
  }

  moveQueued(projectId: string, queueId: string, by: number): void {
    this.changeQueue(projectId, moveQueued(this.store.project(projectId).goalQueue ?? [], queueId, by));
  }

  /**
   * Closes a goal: commits any uncommitted work as a WIP snapshot on its branch, files it in the room's log and sends its
   * lead home, which frees the station. First says what would be left behind (work GitHub hasn't got, open pull
   * requests, a goal that shipped nothing), unless `force`. A checkout whose work can't be saved keeps the goal open.
   */
  closeGoal(id: string, force = false): Promise<{ closed: true } | { warn: string[] }> {
    return this.runtime.runPromise(Effect.gen({ self: this }, function* () {
      const agent = this.store.agent(id);
      const work = agent.lead;
      if (agent.task !== 'lead' || !work) return yield* new Refused({ message: `${agent.name} isn’t leading a goal` });
      const workspace = yield* Workspace;
      const dir = (folder: string) => workspace.dir(leadWorktreeId(id, folder));
      // a check that fails counts against closing: changes git couldn't look for are treated as there. A reopened goal
      // whose repos were never checked out again has nothing to check: its branch is as it was
      const repos = yield* Effect.forEach(work.reopening ? [] : work.repos, (r) =>
        Effect.all({
          folder: Effect.succeed(r.folder),
          dirty: workspace.hasUncommittedChanges(dir(r.folder)).pipe(Effect.orElseSucceed(() => true)),
          branch: workspace.branchState(dir(r.folder), repoBranch(r, agent.branch), r.baseBranch).pipe(Effect.orElseSucceed(() => undefined)),
          on: Effect.succeed(r.branch),
        }), { concurrency: 'unbounded' });
      const check = closeCheck(work, agent.branch, repos);
      if (check.kind === 'warn' && !force) return { warn: check.reasons };
      this.closingGoals.add(id);
      yield* Effect.forEach(work.repos, (r) =>
        workspace.snapshot(dir(r.folder), snapshotMessage(work.title)).pipe(
          Effect.mapError((err) => new Refused({ message: `Couldn’t commit ./${r.folder}’s uncommitted work as a WIP snapshot (${err.message}), so “${work.title}” stays open` })),
          Effect.tap((saved) => Effect.sync(() => saved && this.print(agent, [{ kind: 'system', text: `✻ Committed ./${r.folder}’s uncommitted work as a WIP snapshot on ${repoBranch(r, agent.branch)}` }]))),
        ), { discard: true }).pipe(Effect.onError(() => Effect.sync(() => this.closingGoals.delete(id))));
      const project = this.store.project(agent.projectId);
      const record = goalRecord(agent, Date.now());
      const before = project.goals ?? [];
      project.goals = fileGoal(before, record);
      // what its lead showed stays with the goal in the log, until the goal drops off the end of it
      for (const gone of leftLog(before, project.goals)) this.store.dropArtifacts(gone.id);
      this.core.ledger.record(project.id, { kind: 'goal-closed', goal: record });
      this.projectsChanged();
      yield* this.core.seating.goHome(id);
      this.closingGoals.delete(id);
      // the goal's reviewer goes home with its lead; a review they were on, or still waiting, goes to the room's QA officer
      const reviewer = goalReviewerId(id);
      for (const r of this.store.reviews.values()) {
        if (r.agentId === reviewer && (r.status === 'testing' || r.status === 'queued')) this.core.reviews.putReview({ ...r, status: 'queued', agentId: undefined });
      }
      yield* this.core.seating.goHome(reviewer);
      this.core.reviews.nextReview(agent.projectId);
      const next = nextGoal(project.goalQueue);
      this.hub.toast('success', next
        ? `🏁 “${work.title}” is closed. Team station ${work.station + 1} is free: next up is “${goalTitle(next.text)}” (L to start it)`
        : `🏁 “${work.title}” is closed, and team station ${work.station + 1} is free`, undefined, project.id);
      return { closed: true as const };
    }));
  }

  /** Checks out every repo of the project side by side, on the goal's first branch, then hands the lead the captain's words. */
  launchLead(agent: Agent): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      const project = this.store.project(agent.projectId);
      yield* this.core.slices.checkOutSlice(agent, project.repos);
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      // a new goal, or one whose conversation couldn't be resumed: the lead hears where it stands
      yield* this.core.sessions.runSession(agent, freshSessionPrompt(agent.lead!, agent.branch, rt.inbox.splice(0), sliceLanded(agent.lead!.prs)));
    });
  }

  /**
   * A reopened goal's lead: its pull requests as GitHub has them now, every repo checked out on the goal's branch as it
   * was left, then the conversation picked back up (or a new one, when there's none to go back to).
   */
  launchReopened(agent: Agent, closedAt: number): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      // a pull request may have merged or closed while the goal was closed, with no lead to hear about it
      const prs = yield* Effect.forEach(agent.lead!.prs, (p) =>
        p.outcome ? Effect.succeed(p) : github.pullRequestState(p.repo, p.number).pipe(
          Effect.map((state) => (state === 'OPEN' ? p : { ...p, outcome: state === 'MERGED' ? 'merged' as const : 'closed' as const })),
          Effect.orElseSucceed(() => p),
        ));
      for (const r of agent.lead!.repos) {
        this.update(agent, { activity: `Checking out ${r.repo}` });
        this.print(agent, [{ kind: 'system', text: `✻ Checking out ${r.repo} at ./${r.folder} on ${repoBranch(r, agent.branch)}, as it was left` }]);
        yield* workspace.reopen(r.repo, leadWorktreeId(agent.id, r.folder), repoBranch(r, agent.branch), (id) => this.store.agents.has(id));
      }
      this.update(agent, { lead: { ...agent.lead!, prs, reopening: undefined } });
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      const note = [reopenedNote(agent.lead!, agent.branch, closedAt), ...rt.inbox.splice(0)].join('\n\n');
      yield* this.core.sessions.runSession(agent, agent.sessionId ? note : freshSessionPrompt(agent.lead!, agent.branch, [note], sliceLanded(prs)), agent.sessionId);
    });
  }

  /** The lead whose open pull request this is, if any. */
  leadWith(repo: string, number: number): Agent | undefined {
    return [...this.store.agents.values()].find((a) => a.task === 'lead' && a.lead?.prs.some((p) => p.repo === repo && p.number === number && !p.outcome));
  }

  /** QA's verdict on one of the lead's pull requests: a fail wakes the lead to fix it, a couple of times at most. */
  leadHearsVerdict(repo: string, number: number, from: string, report: QaReport, failedRounds: number): void {
    const lead = this.leadWith(repo, number);
    if (!lead) return;
    const text = qaVerdictNote(repo, number, report);
    const step = afterVerdict(report.verdict, failedRounds);
    if (step === 'wake') return this.core.comms.message(lead.id, text, from);
    // no turn spent on it: the lead hears it with the captain's next message
    this.noteForLead(lead, from, text);
    if (step === 'needs-you') this.hub.toast('error', `🙋 QA failed ${repo.split('/')[1]}#${number} ${failedRounds} times: ${lead.name} needs you to look`, lead.id);
  }

  /**
   * News for a lead that needn't cost them a turn: it waits for the end of the one they're in (an inbox that fills during
   * a turn carries them on into another), then goes with whatever they hear next.
   */
  noteForLead(lead: Agent, from: string, text: string): void {
    this.print(lead, [{ kind: 'manager', text: `▶ ${from}: ${text}` }]);
    const rt = this.rt(lead.id);
    (rt.busy ? (rt.afterTurn ??= []) : rt.inbox).push(`[${from}] ${text}`);
  }

  /** The lead's pull request was merged or closed. Once the slice's have all landed, the lead hears about it. */
  leadPrClosed(repo: string, number: number, merged: boolean): boolean {
    const lead = this.leadWith(repo, number);
    if (!lead?.lead) return false;
    const prs = lead.lead.prs.map((p) => (p.repo === repo && p.number === number ? { ...p, outcome: merged ? ('merged' as const) : ('closed' as const) } : p));
    this.update(lead, { lead: { ...lead.lead, prs } });
    this.print(lead, [{ kind: merged ? 'success' : 'system', text: `${merged ? '🎉' : '✻'} ${repo}#${number} was ${merged ? 'merged' : 'closed'}` }]);
    if (sliceLanded(prs)) {
      this.core.ledger.digestSession(lead, prs.map((p) => ({ repo: p.repo, pr: p.number })));
      // a lead in the middle of a turn carries on: their repos only move at the start of the next one
      this.core.comms.message(lead.id, (this.rt(lead.id).busy ? landedMidTurnNote : landedNote)(lead.lead), 'Office');
    }
    return true;
  }

  /** The leads' pull requests still open, for the office to notice when they're merged or closed on GitHub. */
  leadPrs(projectId: string): { repo: string; number: number }[] {
    return this.store.agentsIn(projectId).flatMap((a) => (a.task === 'lead' ? (a.lead?.prs ?? []).filter((p) => !p.outcome) : []));
  }
}
