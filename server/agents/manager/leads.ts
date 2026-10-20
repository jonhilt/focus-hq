import { autoSendBackFor, prKey } from '../../../shared/qa';
import { Effect } from 'effect';
import { leadFor, leadId } from '../../../shared/crew';
import type { Agent, Effort, Evidence, LeadAgent, QaReport, QaScreenshot, QueuedGoal } from '../../../shared/types';
import { LEAD_DESK, TEAM_STATIONS } from '../../../shared/types';
import { GitHub } from '../../github/service';
import { errorMessage, newId } from '../../util';
import { takesTitle } from '../goalTitles';
import { afterVerdict, closeCheck, hasLeadWork, fileGoal, freshSessionPrompt, goalBrief, goalEffort, goalRecord, goalReviewerId, goalTitle, landedMidTurnNote, landedNote, leadWorktreeId, moveQueued, nextGoal, pickStation, qaVerdictNote, queuedStart, reopenable, reopenedNote, reopenedWork, sliceBranch, sliceLanded, snapshotMessage, repoBranch, type VerdictBehind } from '../lead';
import { contactToSpinOff, spunOff, spunOffIdea, spunOffIdeaNote } from '../contacts';
import { Workspace } from '../services';
import { EVIDENCE_PER_PR, evidenceFile, landedWaypoint, shieldedWaypoint, tickedSpotCheck } from '../waypoints';
import { type ManagerServices, Part, Refused, type WorkError } from './core';

/** Goals and their leads: starting, queueing, reopening and closing goals, and what the lead hears about their pull requests. */
export class Leads extends Part {
  /** The leads whose goal is closing right now: nothing of theirs ships, so a WIP snapshot never reaches a pull request. */
  closingGoals = new Set<string>();

  /** Titles a new goal from the captain's first words (Haiku, off the demo), to replace the title it starts with. */
  titleGoal?: (brief: string) => Promise<string | undefined>;

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
    const crew = leadFor(projectId, suffix, leads.map((a) => a.name), (project.goals ?? []).map((g) => g.leadName));
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
      lead: { station, title, brief: goalBrief(text), repos: [], slice: 1, prs: [], waypoints: [{ slice: 1, startedAt: Date.now() }] },
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.core.freshRuntime(id, text.trim());
    this.store.putAgent(agent);
    this.store.sliceJournal(id, { kind: 'started', slice: 1, branch: agent.branch });
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [
      { kind: 'system', text: `✻ ${crew.name} takes team station ${station + 1} to lead “${title}” across ${project.repos.join(', ')} (${effort} effort)` },
      { kind: 'manager', text: `▶ ${how.from ? `Captain, from ${how.from}` : 'Captain'}: ${text.trim()}` },
    ]);
    this.core.seating.schedule();
    this.retitle(id, title, text);
    return { agent };
  }

  /** Gives a new goal a title that says what the work is, once `titleGoal` answers, if nobody has retitled it meanwhile. */
  private retitle(id: string, started: string, text: string): void {
    const titler = this.titleGoal;
    if (!titler) return;
    void titler(text).then(
      (proposed) => {
        const agent = this.store.agents.get(id);
        if (!agent || !hasLeadWork(agent) || !takesTitle(agent.lead.title, started, proposed)) return;
        this.update(agent, { lead: { ...agent.lead, title: proposed }, issue: { ...agent.issue, title: proposed } });
        this.print(agent, [{ kind: 'system', text: `✻ The goal is titled “${proposed}”` }]);
      },
      (err: unknown) => {
        const agent = this.store.agents.get(id);
        if (agent) this.print(agent, [{ kind: 'system', text: `✻ Couldn't give the goal a shorter title: ${errorMessage(err)}` }]);
      },
    );
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
    const crew = leadFor(projectId, goal.id.slice(goal.id.lastIndexOf('_') + 1), leads.map((a) => a.name));
    const agent: Agent = {
      id: goal.id,
      name: leads.some((a) => a.name === goal.leadName) ? crew.name : goal.leadName,
      avatar: crew.avatar,
      projectId,
      repo: goal.repos[0].repo,
      task: 'lead',
      issue: { number: 0, title: goal.title, url: '' },
      effort: goalEffort(undefined, this.store.settings),
      desk: LEAD_DESK,
      status: 'queued',
      activity: `Coming back to team station ${free + 1}`,
      branch: goal.branch,
      baseBranch: goal.repos[0].baseBranch,
      lead: reopenedWork(goal, free),
      sessionId: goal.sessionId,
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.core.freshRuntime(agent.id);
    project.goals = (project.goals ?? []).filter((g) => g.id !== goal.id);
    this.projectsChanged();
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [{ kind: 'system', text: `✻ The captain reopened “${goal.title}”: ${agent.name} comes back to team station ${free + 1}, on ${goal.branch}` }]);
    this.core.seating.schedule();
    return agent;
  }

  /** Puts a goal in line for the next free team station. It waits there for the captain to start it. */
  queueGoal(projectId: string, text: string, how: { effort?: Effort; from?: string } = {}): QueuedGoal {
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
    const taken = this.store.agentsIn(projectId).filter((a) => a.task === 'lead').map((a) => a.lead?.station ?? 0);
    const start = queuedStart(project.goalQueue, queueId, taken, edits, project.name);
    if (start.kind === 'refused') throw new Refused({ message: start.message });
    const started = this.startGoal(projectId, start.text, { station: start.station, effort: start.effort, from: start.from });
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
      if (agent.task !== 'lead' || !hasLeadWork(agent)) return yield* new Refused({ message: `${agent.name} isn’t leading a goal` });
      const work = agent.lead;
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
      // a ship under way would open its pull requests after the goal's filed, on no goal: it finishes first. One that
      // starts from here on is refused (`closingGoals`)
      if (this.store.slice(id).phase === 'shipping') return yield* new Refused({ message: `${agent.name} is shipping their slice: close the goal once it’s shipped` });
      this.closingGoals.add(id);
      // on disk before any snapshot's taken: a restart from here finishes the close
      this.markClosing(agent, { at: Date.now() });
      yield* Effect.forEach(work.repos, (r) =>
        workspace.snapshot(dir(r.folder), snapshotMessage(work.title)).pipe(
          Effect.mapError((err) => new Refused({ message: `Couldn’t commit ./${r.folder}’s uncommitted work as a WIP snapshot (${err.message}), so “${work.title}” stays open` })),
          Effect.tap((saved) => Effect.sync(() => saved && this.print(agent, [{ kind: 'system', text: `✻ Committed ./${r.folder}’s uncommitted work as a WIP snapshot on ${repoBranch(r, agent.branch)}` }]))),
        ), { discard: true }).pipe(Effect.onError(() => Effect.sync(() => {
          this.closingGoals.delete(id);
          this.markClosing(agent, undefined);
        })));
      const project = this.store.project(agent.projectId);
      const record = goalRecord(agent, Date.now());
      project.goals = fileGoal(project.goals ?? [], record);
      this.core.ledger.record(project.id, { kind: 'goal-closed', goal: record });
      this.projectsChanged();
      yield* this.core.seating.goHome(id);
      this.closingGoals.delete(id);
      // the goal's reviewer goes home with its lead; a review they were on, or still waiting, goes to the room's QA officer
      const reviewer = goalReviewerId(id);
      for (const r of this.store.reviews.values()) {
        if (r.agentId === reviewer && (r.status === 'testing' || r.status === 'queued')) this.core.reviews.record(prKey(r.repo, r.number), { kind: 'unseated' });
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

  /** The lead's goal as closing (its snapshots under way), or not any more: read afresh, as it may have changed meanwhile. */
  private markClosing(agent: Agent, closeStarted: { at: number } | undefined): void {
    if (agent.lead) this.update(agent, { lead: { ...agent.lead, closeStarted } });
  }

  /**
   * After a restart: a close the office went down in the middle of (`closeStarted`) is finished, rather than the lead
   * picking up a goal whose work is part committed as WIP snapshots. A close that fails then leaves the goal open, and
   * its lead's run picks back up (`recoverAgent`). The leads it's finishing a close for.
   */
  recoverCloses(onKey: boolean): Set<string> {
    const closing = [...this.store.agents.values()].filter((a) => a.task === 'lead' && a.lead?.closeStarted);
    for (const agent of closing) {
      this.print(agent, [{ kind: 'system', text: '✻ Focus restarted part way through closing the goal: finishing that' }]);
      void this.closeGoal(agent.id, true).catch((err: unknown) => {
        this.print(agent, [{ kind: 'error', text: `✘ Couldn't finish closing it: ${errorMessage(err)}` }]);
        this.core.sessions.recoverAgent(agent, onKey);
      });
    }
    return new Set(closing.map((a) => a.id));
  }

  /** Checks out every repo of the project side by side, on the goal's first branch, then hands the lead the captain's words. */
  launchLead(agent: LeadAgent): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      const project = this.store.project(agent.projectId);
      yield* this.core.slices.checkOutSlice(agent, project.repos);
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      // a new goal, or one whose conversation couldn't be resumed: the lead hears where it stands
      yield* this.core.sessions.runSession(agent, freshSessionPrompt(agent.lead, agent.branch, rt.inbox.take(), sliceLanded(agent.lead.prs)));
    });
  }

  /**
   * A reopened goal's lead: its pull requests as GitHub has them now, every repo checked out on the goal's branch as it
   * was left, then the conversation picked back up (or a new one, when there's none to go back to).
   */
  launchReopened(agent: LeadAgent, closedAt: number): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      // a pull request may have merged or closed while the goal was closed, with no lead to hear about it
      const prs = yield* Effect.forEach(agent.lead.prs, (p) =>
        p.outcome ? Effect.succeed(p) : github.pullRequestState(p.repo, p.number).pipe(
          Effect.map((state) => (state === 'OPEN' ? p : { ...p, outcome: state === 'MERGED' ? 'merged' as const : 'closed' as const })),
          Effect.orElseSucceed(() => p),
        ));
      for (const r of agent.lead.repos) {
        this.update(agent, { activity: `Checking out ${r.repo}` });
        this.print(agent, [{ kind: 'system', text: `✻ Checking out ${r.repo} at ./${r.folder} on ${repoBranch(r, agent.branch)}, as it was left` }]);
        yield* workspace.reopen(r.repo, leadWorktreeId(agent.id, r.folder), repoBranch(r, agent.branch), (id) => this.store.agents.has(id));
        yield* this.install(agent, workspace.dir(leadWorktreeId(agent.id, r.folder)));
      }
      this.update(agent, { lead: { ...agent.lead, prs, reopening: undefined } });
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      const note = [reopenedNote(agent.lead, agent.branch, closedAt), ...rt.inbox.take()].join('\n\n');
      yield* this.core.sessions.runSession(agent, agent.sessionId ? note : freshSessionPrompt(agent.lead, agent.branch, [note], sliceLanded(prs)), agent.sessionId);
    });
  }

  /** The lead whose open pull request this is, if any. */
  leadWith(repo: string, number: number): Agent | undefined {
    return [...this.store.agents.values()].find((a) => a.task === 'lead' && a.lead?.prs.some((p) => p.repo === repo && p.number === number && !p.outcome));
  }

  /** QA's verdict on one of the lead's pull requests: a fail wakes the lead to fix it, a couple of times at most. */
  /**
   * QA's verdict on a lead's pull request goes on its slice's waypoint as its shield, with its spot-checks and how CI
   * stood: the review and the board's entry are both gone by the time the pull request lands.
   */
  leadShielded(projectId: string, repo: string, number: number, report: QaReport, failedRounds: number, shots: readonly QaScreenshot[]): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const lead = this.leadWith(repo, number);
      if (!lead?.lead) return;
      const ci = this.store.boards.get(projectId)?.prs.find((p) => p.repo === repo && p.number === number)?.checks;
      // QA's own copies go with its review when the pull request lands: the goal keeps copies of its own, as evidence
      const evidence: Evidence[] = [];
      for (const [i, shot] of shots.slice(-EVIDENCE_PER_PR).entries()) {
        const bytes = yield* Effect.promise(() => this.store.readShot(shot.file));
        if (!bytes) continue;
        const file = evidenceFile(repo, number, i, shot.file);
        this.store.saveArtifact(lead.id, file, bytes);
        evidence.push({ repo, pr: number, caption: shot.caption, file });
      }
      const work = this.store.agent(lead.id).lead ?? lead.lead;
      this.update(lead, { lead: { ...work, waypoints: shieldedWaypoint(work, { repo, pr: number, report, failedRounds, ci, evidence }, Date.now()) } });
    });
  }

  /** The captain ticks off (or un-ticks) one of the spot-checks QA picked on a slice of a goal under way. */
  tickSpotCheck(leadId: string, slice: number, index: number, checked: boolean): void {
    const lead = this.store.agents.get(leadId);
    if (!lead?.lead) throw new Error('There’s no goal under way there');
    const waypoints = tickedSpotCheck(lead.lead, slice, index, checked, Date.now());
    if ('error' in waypoints) throw new Error(waypoints.error);
    this.update(lead, { lead: { ...lead.lead, waypoints } });
  }

  /**
   * The captain spins one of a goal's open contacts off as a goal of its own, starting it with `text` (or putting it in
   * line for a station): the contact closes as spun off, and the goal's lead hears so.
   */
  spinOffContact(leadId: string, contactId: string, text: string): { agent: Agent } | { queued: QueuedGoal } {
    const lead = this.store.agents.get(leadId);
    if (!lead?.lead) throw new Refused({ message: 'There’s no goal under way there' });
    const contact = contactToSpinOff(lead.lead.contacts, contactId);
    if ('error' in contact) throw new Refused({ message: contact.error });
    const started = this.startGoal(lead.projectId, text, { from: 'a goal’s star chart' });
    const work = this.store.agent(leadId).lead ?? lead.lead;
    const { contacts, note } = spunOff(work, contact, started, goalTitle(text), Date.now());
    this.update(lead, { lead: { ...work, contacts } });
    this.noteForLead(lead, 'Star chart', note);
    return started;
  }

  /**
   * The captain spins one of a goal's ideas for next (a projected course on its chart) off as a goal of its own, starting
   * it with `text` (or putting it in line for a station): the idea comes off the goal's note, and its lead hears so.
   */
  spinOffIdea(leadId: string, idea: string, text: string): { agent: Agent } | { queued: QueuedGoal } {
    const lead = this.store.agents.get(leadId);
    if (!lead?.lead) throw new Refused({ message: 'There’s no goal under way there' });
    const checked = spunOffIdea(lead.lead.note?.next, idea);
    if ('error' in checked) throw new Refused({ message: checked.error });
    const started = this.startGoal(lead.projectId, text, { from: 'a goal’s star chart' });
    const goal = 'agent' in started ? started.agent : undefined;
    const title = goal?.lead?.title ?? goalTitle(text);
    const work = this.store.agent(leadId).lead ?? lead.lead;
    const next = spunOffIdea(work.note?.next, idea);
    if (work.note && !('error' in next)) this.update(lead, { lead: { ...work, note: { ...work.note, next } } });
    this.noteForLead(lead, 'Star chart', spunOffIdeaNote(idea, title, goal?.lead?.station));
    return started;
  }

  leadHearsVerdict(repo: string, number: number, from: string, report: QaReport, failedRounds: number, behind?: VerdictBehind): void {
    const lead = this.leadWith(repo, number);
    if (!lead) return;
    const sendBack = autoSendBackFor(this.store.project(lead.projectId));
    const text = qaVerdictNote(repo, number, report, behind, sendBack);
    // a verdict on a commit they've shipped past costs no turn: the one on their latest will
    const step = behind ? 'pass-on' : afterVerdict(report.verdict, failedRounds, sendBack);
    if (step === 'wake') {
      this.core.comms.message(lead.id, text, from);
      return;
    }
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
    if (rt.busy) rt.inbox.later(`[${from}] ${text}`);
    else rt.inbox.push(`[${from}] ${text}`);
  }

  /** The lead's pull request was merged or closed. Once the slice's have all landed, the lead hears about it. */
  leadPrClosed(repo: string, number: number, merged: boolean): boolean {
    const lead = this.leadWith(repo, number);
    if (!lead?.lead) return false;
    const prs = lead.lead.prs.map((p) => (p.repo === repo && p.number === number ? { ...p, outcome: merged ? ('merged' as const) : ('closed' as const) } : p));
    this.store.sliceJournal(lead.id, { kind: 'landed', repo, number, merged });
    this.update(lead, { lead: { ...lead.lead, prs, ...(sliceLanded(prs) && { waypoints: landedWaypoint(lead.lead, Date.now()) }) } });
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
