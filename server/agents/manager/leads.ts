import { prKey } from '../../../shared/qa';
import { Effect } from 'effect';
import { leadFor, leadId } from '../../../shared/crew';
import type { Agent, Effort, Evidence, LeadAgent, QaReport, QaReview, QaScreenshot, QueuedGoal } from '../../../shared/types';
import { LEAD_DESK } from '../../../shared/types';
import { GitHub } from '../../github/service';
import { errorMessage, newId } from '../../util';
import { takesTitle } from '../goalTitles';
import { fileGoal, freshSessionPrompt, goalBrief, goalEffort, goalRecord, goalReviewerId, goalTitle, leadWorktreeId, moveQueued, qaVerdictNote, fixingNote, fixHandedBackNote, reopenedNote, reopenedWork, sliceBranch, sliceLanded, snapshotMessage, repoBranch, type VerdictBehind } from '../lead';
import { closeCheck, hasLeadWork, queuedStart, reopenable, verdictStands, verdictToast } from '../leadRules';
import { contactToSpinOff, spunOff, spunOffIdea, spunOffIdeaNote } from '../contacts';
import { Workspace } from '../services';
import { EVIDENCE_PER_PR, evidenceFile, shieldedWaypoint, tickedSpotCheck } from '../waypoints';
import type { LeadNews } from '../../plugins/contract';
import { type ManagerServices, Part, Refused, type WorkError } from './core';
import { FINISHED } from './sessionRules';

/** Goals and their leads: starting, queueing, reopening and closing goals, and what the lead hears about their pull requests. */
export class Leads extends Part {
  /** The leads whose goal is closing right now: nothing of theirs ships, so a WIP snapshot never reaches a pull request. */

  /** Titles a new goal from the captain's first words (Haiku, off the demo), to replace the title it starts with. */
  titleGoal?: (brief: string) => Promise<string | undefined>;

  /**
   * Starts a goal: a lead of its own (the user's own Claude Code session for the goal), with every repo of the project
   * checked out on the goal's first branch, who hears `text` first. A project has any number of goals, so it always
   * starts, at no team station. Later messages go to the lead like any agent's.
   */
  startGoal(projectId: string, text: string, how: { effort?: Effort; from?: string; shaping?: boolean } = {}): { agent: Agent } {
    const project = this.store.project(projectId);
    if (!project.repos.length) throw new Refused({ message: `Connect a repository to ${project.name} first` });
    if (!text.trim()) throw new Refused({ message: 'Tell them what you’re after' });
    const leads = this.store.agentsIn(projectId).filter((a) => a.task === 'lead');
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
      activity: 'Coming over to lead the goal',
      branch: sliceBranch(title, 1, newId('s').slice(-4)),
      baseBranch: 'main',
      lead: { title, brief: goalBrief(text), ...(how.shaping && { shaping: true }), repos: [], slice: 1, prs: [], waypoints: [{ slice: 1, startedAt: Date.now() }] },
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.core.freshRuntime(id, text.trim());
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [
      { kind: 'system', text: `✻ ${crew.name} leads “${title}” across ${project.repos.join(', ')} (${effort} effort${how.shaping ? ', shaping it with the captain first' : ''})` },
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
   * Reopens a closed goal from the room's log: the same lead, so Claude Code finds their conversation again, with every
   * repo checked out on the goal's branch as it was left. Like a new goal, it takes no team station.
   */
  reopenGoal(projectId: string, goalId: string): Agent {
    const project = this.store.project(projectId);
    const goal = (project.goals ?? []).find((g) => g.id === goalId);
    if (!goal) throw new Refused({ message: 'That goal isn’t in the room’s log' });
    if (!reopenable(goal)) throw new Refused({ message: `“${goal.title}” closed before Ops kept its branch, so it can’t be reopened` });
    if (this.store.agents.has(goal.id)) throw new Refused({ message: `“${goal.title}” is already under way` });
    const leads = this.store.agentsIn(projectId).filter((a) => a.task === 'lead');
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
      activity: 'Coming back to the goal',
      branch: goal.branch,
      baseBranch: goal.repos[0].baseBranch,
      lead: reopenedWork(goal),
      sessionId: goal.sessionId,
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.core.freshRuntime(agent.id);
    project.goals = (project.goals ?? []).filter((g) => g.id !== goal.id);
    this.projectsChanged();
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    this.print(agent, [{ kind: 'system', text: `✻ The captain reopened “${goal.title}”: ${agent.name} comes back to it, on ${goal.branch}` }]);
    this.core.seating.schedule();
    return agent;
  }

  /** Puts a goal in line without starting it. It waits there for the user to start it. */
  queueGoal(projectId: string, text: string, how: { effort?: Effort; from?: string; shaping?: boolean } = {}): QueuedGoal {
    const project = this.store.project(projectId);
    const queued: QueuedGoal = { id: newId('q'), text: text.trim(), effort: how.effort, ...(how.shaping && { shaping: true }), from: how.from, at: Date.now() };
    const ahead = project.goalQueue?.length ?? 0;
    this.changeQueue(projectId, [...(project.goalQueue ?? []), queued]);
    this.hub.toast('info', `🧭 “${goalTitle(text)}” waits in line in ${project.name}${ahead ? `, behind ${ahead} other goal${ahead === 1 ? '' : 's'}` : ''}`, undefined, projectId);
    return queued;
  }

  private changeQueue(projectId: string, queue: QueuedGoal[]): void {
    this.store.project(projectId).goalQueue = queue;
    this.projectsChanged();
  }

  /** Starts a queued goal now, with the user's last edits to it. */
  startQueued(projectId: string, queueId: string, edits: { text?: string; effort?: Effort; shaping?: boolean } = {}): Agent {
    const project = this.store.project(projectId);
    const start = queuedStart(project.goalQueue, queueId, edits);
    if (start.kind === 'refused') throw new Refused({ message: start.message });
    const started = this.startGoal(projectId, start.text, { effort: start.effort, from: start.from, shaping: start.shaping });
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
   * lead home. First says what would be left behind (work GitHub hasn't got, open pull
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
      // on disk before any snapshot's taken: a restart from here finishes the close. From here the lead's pushes are
      // refused, so a snapshot never goes up into a pull request
      this.markClosing(agent, { at: Date.now() });
      yield* Effect.forEach(work.repos, (r) =>
        workspace.snapshot(dir(r.folder), snapshotMessage(work.title)).pipe(
          Effect.mapError((err) => new Refused({ message: `Couldn’t commit ./${r.folder}’s uncommitted work as a WIP snapshot (${err.message}), so “${work.title}” stays open` })),
          Effect.tap((saved) => Effect.sync(() => saved && this.print(agent, [{ kind: 'system', text: `✻ Committed ./${r.folder}’s uncommitted work as a WIP snapshot on ${repoBranch(r, agent.branch)}` }]))),
        ), { discard: true }).pipe(Effect.onError(() => Effect.sync(() => this.markClosing(agent, undefined))));
      const project = this.store.project(agent.projectId);
      const record = goalRecord(agent, Date.now());
      project.goals = fileGoal(project.goals ?? [], record);
      this.core.ledger.record(project.id, { kind: 'goal-closed', goal: record });
      this.projectsChanged();
      yield* this.core.seating.goHome(id);
      // the goal's reviewer goes home with its lead; a review they were on, or still waiting, goes to the room's QA officer
      const reviewer = goalReviewerId(id);
      for (const r of this.store.reviews.values()) {
        if (r.agentId === reviewer && (r.status === 'testing' || r.status === 'queued')) this.core.reviews.record(prKey(r.repo, r.number), { kind: 'unseated' });
      }
      yield* this.core.seating.goHome(reviewer);
      this.core.reviews.nextReview(agent.projectId);
      this.hub.toast('success', `🏁 “${work.title}” is closed`, undefined, project.id);
      return { closed: true as const };
    }));
  }

  /** The lead's goal as closing (its snapshots under way, their pushes refused), or not any more: read afresh, as it may have changed meanwhile. */
  private markClosing(agent: Agent, closeStarted: { at: number } | undefined): void {
    if (agent.lead) this.update(agent, { lead: { ...agent.lead, closeStarted } });
    this.core.goalPrs.guardPushes(agent.id);
  }

  /**
   * After a restart: a close Focus went down in the middle of (`closeStarted`) is finished, rather than the lead
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
      yield* this.core.checkouts.checkOut(agent, project.repos);
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

  /**
   * QA's verdict on a lead's pull request goes on its slice's waypoint as its shield, with its spot-checks and how CI
   * stood: the review and the board's entry are both gone by the time the pull request lands.
   */
  leadShielded(projectId: string, repo: string, number: number, report: QaReport, failedRounds: number, shots: readonly QaScreenshot[]): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const lead = this.core.goalPrs.ownerOf(repo, number);
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
   * The user spins one of a goal's open contacts off as a goal of its own, starting it with `text`: the contact closes as spun off, and the goal's lead hears so.
   */
  spinOffContact(leadId: string, contactId: string, text: string): { agent: Agent } {
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
   * The user spins one of a goal's ideas for next (a projected course on its chart) off as a goal of its own, starting
   * it with `text`: the idea comes off the goal's note, and its lead hears so (to take it off their brief).
   */
  spinOffIdea(leadId: string, idea: string, text: string): { agent: Agent } {
    const lead = this.store.agents.get(leadId);
    if (!lead?.lead) throw new Refused({ message: 'There’s no goal under way there' });
    const checked = spunOffIdea(lead.lead.note?.next, idea);
    if ('error' in checked) throw new Refused({ message: checked.error });
    const started = this.startGoal(lead.projectId, text, { from: 'a goal’s star chart' });
    const title = started.agent.lead?.title ?? goalTitle(text);
    const work = this.store.agent(leadId).lead ?? lead.lead;
    const next = spunOffIdea(work.note?.next, idea);
    // it stays off the note while the lead's brief still lists it (`briefedGoal`)
    if (work.note && !('error' in next)) this.update(lead, { lead: { ...work, note: { ...work.note, next }, spunOffIdeas: [...(work.spunOffIdeas ?? []), idea] } });
    this.noteForLead(lead, 'Star chart', spunOffIdeaNote(idea, title));
    return started;
  }

  /**
   * QA's verdict on one of the lead's pull requests: a note, heard with the next message they get, since only the
   * captain starts a lead's next turn. A fail tells the captain, unless whoever heard of the note woke the lead for it;
   * one that comes mid-turn tells them again if the turn ends without the lead hearing it (`leadWentIdle`).
   */
  leadHearsVerdict(repo: string, number: number, from: string, report: QaReport, failedRounds: number, behind?: VerdictBehind, fixer?: string): void {
    const lead = this.core.goalPrs.ownerOf(repo, number);
    if (!lead) return;
    const text = fixer ? `${qaVerdictNote(repo, number, report, behind)}\n\n${fixingNote(fixer, repo, number)}` : qaVerdictNote(repo, number, report, behind);
    this.leadHearsFail(lead, from, text, { repo, number, verdict: report.verdict, failedRounds, behind: !!behind, advisory: !!report.advisory, ...(fixer && { fixer }) });
  }

  /**
   * The developer Ops sent one of the lead's failed pull requests to didn't land a fix (`reason`): it's the lead's
   * again, as a QA fail with no one fixing it, so whoever wakes a lead for one wakes them for this.
   */
  fixHandedBack(lead: Agent, review: Pick<QaReview, 'repo' | 'number' | 'failedRounds'>, report: QaReport, reason: string): void {
    const { repo, number } = review;
    this.leadHearsFail(lead, 'Ops', fixHandedBackNote(repo, number, report, reason), { repo, number, verdict: 'fail', failedRounds: review.failedRounds ?? 1, behind: false, advisory: false });
  }

  /** A QA verdict for the lead, as a note, and the captain's toast for where they stand once it's noted. */
  private leadHearsFail(lead: Agent, from: string, text: string, about: Omit<Extract<LeadNews, { kind: 'qa-verdict' }>, 'kind'>): void {
    const wasIdle = FINISHED.includes(lead.status);
    const note = this.noteForLead(lead, from, text, { kind: 'qa-verdict', ...about });
    const now = this.store.agents.get(lead.id) ?? lead;
    const rt = this.rt(lead.id);
    const stands = about.fixer ? 'fixing' : verdictStands({ wasIdle, finished: FINISHED.includes(now.status), heard: !rt.inbox.notes.includes(note), queued: rt.inbox.length > 0, held: !!now.held });
    const toast = verdictToast(about, lead.name, stands);
    if (toast) this.hub.toast(toast.level, toast.text, lead.id);
    const waiting = stands === 'working' && verdictToast(about, lead.name, 'idle');
    rt.failNoted = waiting ? { note, toast: waiting.text } : undefined;
  }

  /** A goal's lead between turns, with nothing under way: a developer fixing their branch now gets in no one's way. */
  idle(lead: Agent): boolean {
    const rt = this.rt(lead.id);
    return FINISHED.includes(lead.status) && !rt.busy && !rt.session && !rt.inbox.length;
  }

  /** A goal's lead's turn ended with nothing to carry them on: a QA fail noted mid-turn that they haven't heard waits on the captain. */
  leadWentIdle(lead: Agent): void {
    const rt = this.rt(lead.id);
    const waiting = rt.failNoted;
    rt.failNoted = undefined;
    if (waiting && rt.inbox.notes.includes(waiting.note)) this.hub.toast('error', waiting.toast, lead.id);
  }

  /**
   * News for a goal's lead that costs them no turn: a note (`Inbox.note`), which goes with the next message they hear,
   * mid-turn or as a turn starts, and never wakes them or carries them on by itself. The plugins hear of it (`about`
   * what), and one may wake the lead for it: its message brings the note along. Returns the note as it's kept.
   */
  noteForLead(lead: Agent, from: string, text: string, about: LeadNews = { kind: 'other' }): string {
    this.print(lead, [{ kind: 'manager', text: `▶ ${from}: ${text}` }]);
    const rt = this.rt(lead.id);
    const note = `[${from}] ${text}`;
    rt.inbox.note(note);
    this.core.plugins.leadNoted(lead, { from, text, inTurn: rt.busy || !!rt.session, about });
    return note;
  }

}
