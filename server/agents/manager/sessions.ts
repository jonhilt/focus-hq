import { pluginOn } from '../../../shared/projectPlugins';
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Effect, Exit, Fiber, FiberMap } from 'effect';
import { effectiveAutonomy } from '../../../shared/autonomy';
import { helperFor } from '../../../shared/crew';
import { prKey } from '../../../shared/qa';
import type { Agent, LeadAgent, PermissionRequest, TermLine, WorkflowScript } from '../../../shared/types';
import { GitHub, type GitHubError } from '../../github/service';
import { newId, truncate } from '../../util';
import { step, type Target, turnEvent } from '../runMachine';
import { backgroundChange, COMPACT_INSTRUCTIONS, compactInstructions, freshSessionPrompt, helperChange, HELPER_LINGER_MS, leadSystemAppend, taskChange, workflowChange } from '../lead';
import { compactsFirst, hasLeadWork } from '../leadRules';
import { mismatchError, type RunState, turnEnding, type TurnKind } from '../runJournal';
import { recovery, signInMismatch } from '../runJournalRules';
import { compactRefusal } from './sessionRules';
import { closingAtTurnStart } from './turnStartRules';
import { COMMIT_NUDGE, conflictsPrompt, issuePrompt, systemAppend } from '../prompts';
import { MAX_SCREENSHOTS, QA_SCHEMA } from '../qa';
import { type Recordings, Sessions, Workspace } from '../services';
import { journalResults, runOutcome, scriptPlan, transcriptLines, WORKFLOW_LINGER_MS } from '../workflows';
import { committedWaypoint, probedWaypoints } from '../waypoints';
import { BACKGROUND_LINGER_MS, OUTPUT_TAIL, outputLines } from '../backgroundTasks';
import { type ExtraTool, type RunHooks, type RunOutcome, type RunRequest, type SessionExtras, STOPPED_BY_CAPTAIN, type WorkflowEvent } from '../types';
import { EmptyRepository, type ManagerServices, Part, Refused, ReportGone, type Runtime, withNotes, type WorkError } from './core';

/** Running an agent's Claude Code session: launching their task, each turn and its hooks, compacting, and what follows a turn. */
export class AgentSessions extends Part {
  launch(agent: Agent): Effect.Effect<void, never, ManagerServices> {
    const rt = this.rt(agent.id);
    // a reopened goal's repos are checked out before anything else, however many tries that takes
    if (agent.task === 'lead' && hasLeadWork(agent) && agent.lead.reopening) {
      rt.resume = false;
      this.update(agent, { status: 'setting-up', activity: 'Checking the goal’s branch out again', error: undefined });
      return this.core.leads.launchReopened(agent, agent.lead.reopening.closedAt).pipe(this.orFail(agent));
    }
    if (rt.resume) {
      rt.resume = false;
      this.update(agent, { status: 'setting-up', activity: 'Picking up where they left off' });
      if (agent.task === 'review') this.core.reviews.resumed(agent);
      return this.runSession(agent, rt.inbox.take().join('\n\n'), agent.sessionId).pipe(this.orFail(agent));
    }
    this.update(agent, { status: 'setting-up', activity: agent.task === 'review' ? 'Reading the pull request' : agent.task === 'brief' ? 'Reading the brief' : 'Reading the issue', error: undefined });
    return Effect.gen({ self: this }, function* () {
      if (agent.task === 'review') return yield* this.core.reviews.launchReview(agent);
      if (agent.task === 'lead') {
        if (!hasLeadWork(agent)) return yield* new Refused({ message: `${agent.name} has no goal to lead` });
        return yield* this.core.leads.launchLead(agent);
      }
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const info = yield* github.repoInfo(agent.repo);
      if (info.isEmpty) return yield* new EmptyRepository({ repo: agent.repo });
      if (agent.task === 'issue' || agent.task === 'brief') this.update(agent, { baseBranch: info.defaultBranch });
      const prompt = yield* this.taskPrompt(agent);
      // an issue or a brief starts a new branch from the base; conflicts and QA's findings are fixed on the PR's own branch
      const startPoint = agent.task === 'issue' || agent.task === 'brief' ? agent.baseBranch : agent.branch;
      this.print(agent, [{ kind: 'system', text: `✻ Setting up a worktree for ${agent.repo} on ${agent.branch}` }]);
      this.update(agent, { activity: 'Cloning the repository' });
      // the PR's branch may be checked out in its goal's lead's workspace: someone resolving its conflicts, or fixing what
      // QA found on a goal's PR, works on a local branch of their own, which Ops pushes to the PR's
      const local = agent.task === 'conflicts' ? `${agent.branch}-conflicts-${agent.id.slice(-4)}`
        : agent.task === 'fix' && this.core.goalPrs.ownerOf(agent.repo, agent.issue.number) ? `${agent.branch}-fix-${agent.id.slice(-4)}`
        : undefined;
      yield* workspace.create(agent.repo, agent.id, agent.branch, startPoint, (id) => this.store.agents.has(id), local);
      yield* this.install(agent, workspace.dir(agent.id));
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      rt.notes = rt.inbox.take();
      yield* this.runSession(agent, withNotes(prompt, rt.notes));
    }).pipe(this.orFail(agent));
  }

  /** The agent's task, told for where they work now. */
  taskPrompt(agent: Agent): Effect.Effect<string, GitHubError | ReportGone | Refused, GitHub> {
    return Effect.gen({ self: this }, function* () {
      switch (agent.task) {
        case 'review':
          return yield* new Refused({ message: 'The QA officer gets qaPrompt (qa.ts)' });
        case 'lead':
          return yield* new Refused({ message: 'The project lead takes the captain’s messages, not a task' });
        case 'issue': {
          const issue = yield* (yield* GitHub).getIssue(agent.repo, agent.issue.number);
          this.update(agent, { issue: { number: issue.number, title: issue.title, url: issue.url } });
          return issuePrompt(agent, issue);
        }
        case 'conflicts':
          return conflictsPrompt(agent);
        case 'brief': {
          const brief = this.core.plugins.brief(agent.brief);
          if (!brief) return yield* new Refused({ message: `${agent.brief?.plugin ?? 'The plugin'} whose brief this is isn’t switched on` });
          return yield* brief.brief(agent);
        }
        case 'fix': {
          const review = this.store.reviews.get(prKey(agent.repo, agent.issue.number));
          if (!review?.report) return yield* new ReportGone({ number: agent.issue.number });
          const fixes = review.followUp?.kind === 'fixing' ? review.followUp.fixes : { kind: 'qa' as const };
          return this.core.reviews.fixPromptFor(agent, review, review.report, fixes);
        }
      }
    });
  }

  private hooks(agent: Agent, turn: string): RunHooks {
    const rt = this.rt(agent.id);
    return {
      lines: (lines) => this.print(agent, lines),
      // a lead's helpers sit at its team station, each with a transcript of its own; anyone else's stay in their lines
      helperLines: agent.task === 'lead' ? (id, lines) => this.printHelper(agent, id, lines) : undefined,
      activity: (status, activity) => {
        if (rt.permission) return; // hand stays up until the manager answers
        this.update(agent, { status: status ?? agent.status, activity: activity || agent.activity });
      },
      browser: (frame) => {
        this.store.browser.set(agent.id, frame);
        this.hub.send({ type: 'browser', id: agent.id, frame });
      },
      screenshot: (frame) => {
        if (agent.task !== 'review') return;
        rt.shots ??= { taken: 0, frames: [] };
        rt.shots.taken++;
        rt.shots.frames.push(frame);
        if (rt.shots.frames.length > MAX_SCREENSHOTS) rt.shots.frames.shift();
      },
      session: (sessionId, keySource) => {
        // a new session keeps a task list of its own, if any
        this.update(agent, { sessionId, ...(agent.sessionId && agent.sessionId !== sessionId ? { tasks: undefined, context: undefined } : {}) });
        const open = this.store.run(agent.id).open;
        if (open?.id !== turn || (open.session === sessionId && open.keySource === keySource)) return;
        this.store.journal(agent.id, { kind: 'turn-started', turn, session: sessionId, keySource });
        if (open.mismatch || !keySource || !signInMismatch(open.onKey, keySource)) return;
        // signed in with a key that costs, behind Ops' back: stopped before it spends any more
        this.store.journal(agent.id, { kind: 'sign-in-mismatch', turn, observed: keySource });
        this.print(agent, [{ kind: 'error', text: `✘ Claude Code signed in with ${keySource} when Focus meant your plan: stopping the turn` }]);
        rt.session?.stop();
      },
      context: (context) => this.update(agent, { context }),
      taskTool: (name, input, result, said) => {
        const change = taskChange(agent, { name, input, result, said }, Date.now());
        if (change) this.update(agent, change);
      },
      helper: (event) => {
        // only a lead's helpers have somewhere to sit: the lead's team station
        if (agent.task !== 'lead') return;
        const change = helperChange(agent, event, Date.now());
        if (!change) return;
        this.update(agent, change);
        if (event.kind === 'started') this.print(agent, [{ kind: 'system', text: `✻ ${helperFor(event.id).name} joins ${agent.name}'s team: ${event.description}` }]);
        // a helper that's done lingers a moment, so you see how it got on
        if (event.kind === 'ended') {
          this.background(Effect.sleep(HELPER_LINGER_MS).pipe(Effect.andThen(Effect.sync(() => this.update(agent, { helpers: (agent.helpers ?? []).filter((h) => h.id !== event.id) })))));
        }
      },
      commit: (message) => {
        const work = agent.task === 'lead' ? agent.lead : undefined;
        if (work) this.update(agent, { lead: { ...work, waypoints: committedWaypoint(work, message, Date.now()) } });
      },
      probe: (event) => {
        const work = agent.task === 'lead' ? agent.lead : undefined;
        if (!work) return;
        const waypoints = probedWaypoints(work, event, Date.now());
        if (waypoints) this.update(agent, { lead: { ...work, waypoints } });
      },
      background: (event) => {
        // only a lead's have somewhere to float: by their chair in the briefing room
        if (event.kind === 'output' && agent.task === 'lead') (rt.backgroundOutputs ??= new Map()).set(event.id, event.file);
        const change = backgroundChange(agent, event, Date.now());
        if (!change) return;
        this.update(agent, change);
        // one that's ended lingers a moment, so you see how it went
        if (event.kind === 'ended') {
          this.background(Effect.sleep(BACKGROUND_LINGER_MS).pipe(Effect.andThen(Effect.sync(() => {
            this.update(agent, { background: (agent.background ?? []).filter((t) => t.id !== event.id) });
            rt.backgroundOutputs?.delete(event.id);
          }))));
        }
      },
      workflow: (event) => {
        // only a lead's away teams have somewhere to beam in to: the lead's briefing room
        if (agent.task !== 'lead') return;
        const next = keepWorkflowFiles(rt, event);
        const change = next && workflowChange(agent, next, Date.now());
        if (!change) return;
        this.update(agent, change);
        if (event.kind === 'started') this.print(agent, [{ kind: 'system', text: `✻ Workflow ${event.name}: its away team beams into ${agent.name}'s briefing room a phase at a time` }]);
        // a finished workflow's away team lingers a moment, so you see how it got on
        if (event.kind === 'ended') {
          this.background(Effect.sleep(WORKFLOW_LINGER_MS).pipe(Effect.andThen(Effect.sync(() => {
            this.update(agent, { workflows: (agent.workflows ?? []).filter((w) => w.id !== event.id) });
            rt.workflowTranscripts?.delete(event.id);
            rt.workflowScripts?.delete(event.id);
          }))));
        }
      },
      cost: (usd) => this.update(agent, { costUsd: usd }),
      signIn: (onKey) => {
        this.store.journal(agent.id, { kind: 'signed-in', turn, onKey });
        this.update(agent, { onKey });
      },
      question: (input, signal) => this.core.goalTools.askFromTool(agent, input, signal),
      permission: (tool, summary, signal) =>
        new Promise<boolean>((resolve) => {
          const req: PermissionRequest = { id: newId('ask'), tool, summary: truncate(summary, 300), at: Date.now() };
          const resume = agent.status === 'waiting' ? 'working' : agent.status;
          rt.permission = { req, resolve, resume };
          this.store.journal(agent.id, { kind: 'asked', turn, tool, summary: req.summary });
          this.update(agent, { status: 'waiting', permission: req, activity: `Needs approval: ${truncate(summary, 60)}` });
          this.print(agent, [{ kind: 'manager', text: `✋ Waiting for the captain to approve ${truncate(summary, 200)}` }]);
          this.hub.toast('info', `✋ ${agent.name} needs your approval`, agent.id);
          signal.addEventListener('abort', () => {
            if (rt.permission?.req.id === req.id) {
              rt.permission = undefined;
              this.store.journal(agent.id, { kind: 'answered', turn, allow: false, dropped: true });
              this.update(agent, { permission: undefined });
              resolve(false);
            }
          });
        }),
    };
  }

  /** The agent's instructions. The QA officer's may need GitHub, and that can fail. */
  instructions(agent: Agent): Effect.Effect<string, GitHubError, GitHub | Workspace | Recordings> {
    if (agent.task === 'review') return this.core.reviews.qaSystem(agent);
    if (agent.task === 'lead' && agent.lead) return Effect.succeed(leadSystemAppend(agent, this.store.project(agent.projectId).name, agent.lead));
    return Effect.succeed(systemAppend(agent, this.core.plugins.brief(agent.brief)));
  }

  /** One turn of the agent's session: the same tools and instructions on every turn, so a resumed session stays itself. */
  private runRequest(agent: Agent, prompt: string, instructions: string, resumeSessionId?: string): RunRequest {
    const cwd = this.runtime.runSync(Workspace.use((w) => Effect.succeed(w.dir(agent.task === 'review' ? this.core.reviews.reviewDir(agent) : agent.id))));
    return {
      agentId: agent.id,
      agentName: agent.name,
      task: agent.task,
      cwd,
      prompt,
      systemAppend: instructions,
      resumeSessionId,
      settings: this.store.settings,
      autonomy: effectiveAutonomy(agent, this.store.settings),
      effort: agent.effort,
      model: agent.model,
      agent: agent.agent,
      outputSchema: agent.task === 'review' ? QA_SCHEMA : undefined,
      scripted: this.core.plugins.brief(agent.brief)?.demo,
      ...this.leadExtras(agent, cwd),
    };
  }

  /** A goal's lead's extras (`SessionExtras`): their brief's hooks and Ops' office tools, bound to them. */
  private leadExtras(agent: Agent, cwd: string): Pick<RunRequest, 'brief' | 'tools'> {
    if (agent.task !== 'lead') return {};
    // the lead's tools answer Claude Code as Promises: the SDK's tool boundary
    const tool = <A>(effect: Effect.Effect<A, WorkError, ManagerServices>) => this.runtime.runPromise(effect);
    return {
      brief: { edited: () => this.background(this.core.goalTools.readBrief(agent.id)), afterCompact: () => this.core.goalTools.afterCompact(agent.id) },
      tools: { recap: (input) => tool(this.core.goalPrs.recap(agent, input)), show: (input) => tool(this.core.goalTools.showArtifact(agent, input)), ask: (input) => tool(this.core.goalTools.askCaptain(agent, input)), proposeClose: (input) => tool(this.core.goalTools.proposeClose(agent, input.reason)), extra: this.leadTools(agent, cwd) },
    };
  }

  /** A session's extras for one the host resumes after a restart, before any turn of theirs brings them: a lead's only. */
  sessionExtras(agentId: string): SessionExtras | undefined {
    const agent = this.store.agents.get(agentId);
    if (agent?.task !== 'lead') return undefined;
    const cwd = this.runtime.runSync(Workspace.use((w) => Effect.succeed(w.dir(agent.id))));
    return { cwd, ...this.leadExtras(agent, cwd) };
  }

  /** The tools of the plugins switched on for a lead's project, in their `office` server, bound to them: their checkouts (in `workspace`), and their station's screen. */
  private leadTools(agent: Agent, workspace: string): ExtraTool[] {
    // only the plugins switched on for the lead's project
    const project = this.store.projects.find((p) => p.id === agent.projectId);
    return this.core.plugins.leadTools().filter(({ plugin }) => pluginOn(project, plugin)).map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      input: tool.input,
      demo: tool.demo?.bind(tool),
      run: (input) =>
        tool.run(
          {
            agent,
            checkouts: (agent.lead?.repos ?? []).map((r) => ({ repo: r.repo, dir: join(workspace, r.folder) })),
            show: (page) => this.runtime.runPromise(this.core.goalTools.showArtifact(agent, page)),
            showFrames: (page, frames) => this.runtime.runPromise(this.core.goalTools.showFrames(agent, page, frames)),
            takeFrames: (html, frames) => this.runtime.runPromise(this.core.goalTools.takeFrames(html, frames)),
          },
          input,
        ),
    }));
  }

  /**
   * One turn of the agent's session, start to finish. Messages waiting for them go in as it starts (`withInbox`). The
   * turn is held in a scope: interrupting it stops Claude.
   */
  private turn(agent: Agent, req: RunRequest, withInbox: boolean, kind: TurnKind = 'work'): Effect.Effect<RunOutcome, never, Sessions> {
    const rt = this.rt(agent.id);
    const turn = newId('turn');
    return Effect.scoped(
      Effect.gen({ self: this }, function* () {
        // the intent goes in the journal before Claude Code starts, so a restart finds a turn it never saw end
        this.store.journal(agent.id, { kind: 'turn-requested', turn, turnKind: kind, prompt: req.prompt, resumes: req.resumeSessionId });
        const session = yield* (yield* Sessions).start(req, this.hooks(agent, turn));
        rt.session = session;
        rt.turn = turn;
        if (this.store.run(agent.id).open?.mismatch) session.stop();
        else if (withInbox) for (const message of rt.inbox.take(turn)) session.send(message);
        return yield* Effect.promise(() => session.done);
      }),
    ).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          rt.session = undefined;
          rt.turn = undefined;
          // Focus shutting down stops every turn: each stays open in the journal, to carry on at the next start
          if (this.core.closing) return;
          // interrupted (sent home): it's over as much as a stop is
          this.store.journal(agent.id, { kind: 'turn-ended', turn, outcome: Exit.isSuccess(exit) ? turnEnding(exit.value) : { ok: false, aborted: true } });
        }),
      ),
    );
  }

  /**
   * Compacts the agent's conversation with `/compact` and Ops' instructions for what to keep. Never fails the
   * agent: a compaction that doesn't happen leaves the conversation as it was. Succeeds with whether it happened.
   */
  private compact(agent: Agent, keep: string): Effect.Effect<boolean, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      if (!agent.sessionId) return false;
      const rt = this.rt(agent.id);
      const wasBusy = rt.busy;
      rt.busy = true;
      this.update(agent, { activity: 'Compacting the conversation' });
      this.print(agent, [{ kind: 'system', text: '✻ Ops compacts the conversation, keeping what the goal needs' }]);
      const outcome = yield* this.instructions(agent).pipe(
        Effect.flatMap((instructions) => this.turn(agent, this.runRequest(agent, `/compact ${keep}`, instructions, agent.sessionId), false, 'compact')),
        Effect.catch((err) => Effect.succeed<RunOutcome>({ ok: false, summary: '', error: err.message })),
        Effect.ensuring(Effect.sync(() => (rt.busy = wasBusy))),
      );
      if (!outcome.ok) this.print(agent, [{ kind: 'error', text: `✘ Couldn't compact the conversation: ${outcome.error ?? 'no reason given'}. Carrying on as it is.` }]);
      return outcome.ok;
    });
  }

  /** The captain's Compact now: between the agent's turns, keeping what their work needs. */
  compactNow(id: string): Promise<Agent> {
    const agent = this.store.agent(id);
    const refused = compactRefusal(agent, FiberMap.hasUnsafe(this.runs, id));
    if (refused) throw new Refused({ message: refused });
    const { status, activity } = agent;
    this.update(agent, { status: 'working' });
    const keep = agent.lead ? compactInstructions(agent.lead) : COMPACT_INSTRUCTIONS;
    const work = this.compact(agent, keep).pipe(Effect.flatMap((ok) => Effect.sync(() => this.update(agent, { status, activity: ok ? 'Conversation compacted' : activity }))));
    return this.runtime.runPromise(Fiber.join(this.runFor(id, work))).then(() => agent);
  }

  runSession(agent: Agent, prompt: string, resumeSessionId?: string): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      const review = agent.task === 'review';
      const lead = agent.task === 'lead' && hasLeadWork(agent) ? agent : undefined;
      // the turn before this one, as it ended: read before a compaction's turn comes between them
      const before = this.store.run(agent.id).last;
      if (lead && compactsFirst(lead, !!resumeSessionId, this.store.settings.leadCompactAt, rt.compactFailed)) {
        this.update(agent, { status: 'working' });
        if (yield* this.compact(lead, compactInstructions(lead.lead))) resumeSessionId = lead.sessionId ?? resumeSessionId;
        else rt.compactFailed = lead.sessionId;
      }
      if (lead) yield* this.core.goalTools.readBrief(lead.id);
      if (lead) prompt = [yield* this.core.checkouts.beforeTurn(lead), this.core.goalTools.briefMoved(lead.id), prompt].filter(Boolean).join('\n\n');
      if (lead) this.core.goalPrs.turnStarts(lead.id);
      // before marking them busy: the QA officer's instructions may need GitHub, and that can fail
      const instructions = yield* this.instructions(agent);
      rt.busy = true;
      this.turnStarts(agent, !!resumeSessionId, before);
      this.core.plugins.turn(agent, 'start');
      // a turn that's interrupted (sent home) still ends, for the plugins
      const outcome = yield* this.turn(agent, this.runRequest(agent, prompt, instructions, resumeSessionId), true).pipe(
        Effect.ensuring(Effect.sync(() => this.core.plugins.turn(agent, 'end'))),
      );
      rt.busy = false;
      // Focus is shutting down: what follows waits for it to start again (`recover`)
      if (this.core.closing) return;
      // what the manager wrote during the turn carries them on into another; notes that waited for its end don't
      const carryOn = rt.inbox.length > 0;
      rt.inbox.release();
      if (!this.store.agents.has(agent.id)) return;

      const ended: TurnEnd = { outcome, prompt, resumeSessionId, lead, review, mismatch: this.store.run(agent.id).last?.mismatch };
      return yield* this.follow(agent, this.decide(agent, ended, carryOn), ended);
    });
  }

  /**
   * The agent is at work on a new turn: what the plugins noted of the last one is over, and a mark on it that comes
   * later is refused. A lead's at work again, so the user isn't asked to close the goal, whoever woke them
   * (`closingAtTurnStart`): `before` is the turn before this one, as it ended.
   */
  private turnStarts(agent: Agent, resuming: boolean, before: RunState['last']): void {
    const wrapUp = agent.lead && closingAtTurnStart({ name: agent.name, closing: agent.lead.closing }, before);
    const closing = wrapUp?.kind === 'set-aside' ? { closing: undefined } : {};
    this.update(agent, { status: 'working', activity: resuming ? 'Reading your message' : 'Getting started', error: undefined, finishedAt: undefined, ...(agent.lead && { lead: { ...agent.lead, marks: undefined, turnStarted: Date.now(), ...closing } }) });
    if (wrapUp?.kind === 'set-aside') this.print(agent, [{ kind: 'system', text: wrapUp.line }]);
  }

  /**
   * What follows the turn, from the run's state machine (`runMachine.ts`): who they are and what its end was say
   * where the run goes next, and the journal has it.
   */
  private decide(agent: Agent, ended: TurnEnd, carryOn: boolean): Target {
    const next = step(turnEvent(ended.outcome, ended.mismatch), {
      role: ended.review ? 'review' : ended.lead ? 'lead' : 'work',
      resumed: !!ended.resumeSessionId,
      carryOn,
    });
    const last = this.store.run(agent.id).last;
    if (last) this.store.journal(agent.id, { kind: 'decided', turn: last.id, target: next, ...(next === 'deliver' && { summary: ended.outcome.summary }) });
    return next;
  }

  /** Does what the run's machine decided follows the turn: what comes of it, by who they are and how it ended. */
  private follow(agent: Agent, next: Target, { outcome, prompt, lead, review, mismatch }: TurnEnd): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      switch (next) {
        case 'sign-in-mismatch':
          this.fail(agent, mismatchError(mismatch ?? 'ANTHROPIC_API_KEY'));
          return;
        case 'limited':
          // your plan's usage limit stopped them: they carry on with your API key, now or once it resets
          return yield* this.core.planLimit.limited(agent, prompt);
        case 'stopped':
          this.update(agent, { status: 'stopped', activity: STOPPED_BY_CAPTAIN, permission: undefined, finishedAt: Date.now() });
          if (review) this.core.reviews.reviewEnded(agent, STOPPED_BY_CAPTAIN);
          this.core.reviews.fixEnded(agent, 'stopped');
          this.core.seating.schedule();
          return;
        case 'fresh-session':
          // only a lead's turn ends this way
          if (!lead) return;
          this.print(agent, [{ kind: 'system', text: '✻ Claude Code no longer has their conversation – carrying on in a new one' }]);
          this.update(agent, { sessionId: undefined });
          return yield* this.runSession(agent, freshSessionPrompt(lead.lead, agent.branch, [prompt], false));
        case 'carry-on':
          // The manager wrote while the session was wrapping up: carry on in the same conversation.
          return yield* this.runSession(agent, this.rt(agent.id).inbox.take().join('\n\n'), agent.sessionId);
        case 'fail':
          this.fail(agent, outcome.error ?? 'The agent stopped with an error');
          return;
        case 'finish-review':
          return yield* this.core.reviews.finishReview(agent, outcome.structured, outcome.summary);
        case 'lead-done':
          // the lead's turn is over: it's the captain's turn, and their work ships when the lead says so, not now. Their
          // subagents and workflows ended with it; any that just finished linger a moment
          this.update(agent, { status: 'done', activity: 'Your turn', finishedAt: Date.now(), helpers: agent.helpers?.filter((h) => h.status !== 'working'), workflows: agent.workflows?.filter((w) => w.status !== 'running'), background: agent.background?.filter((t) => t.status !== 'running') });
          yield* this.core.goalTools.readBrief(agent.id);
          this.core.leads.leadWentIdle(agent);
          this.core.goalPrs.turnEnded(agent.id);
          this.core.seating.schedule();
          return;
        case 'deliver':
          return yield* this.core.delivery.deliver(agent, outcome.summary);
      }
    });
  }

  /**
   * After a restart, each agent's run picks up from their journal: messages taken for a turn that was never requested
   * go back in their inbox, and a turn that was in flight is interrupted, then carries on in the same conversation where
   * `recovery` says so (on your plan, not the key: `onKey`), or waits for the captain to send a message.
   */
  recover(onKey: boolean, later: ReadonlySet<string> = new Set()): void {
    for (const agent of [...this.store.agents.values()]) if (!later.has(agent.id)) this.recoverAgent(agent, onKey);
  }

  /** Picks one agent's run back up after a restart, from their journal (`recovery`). */
  recoverAgent(agent: Agent, onKey: boolean): void {
    const run = this.store.run(agent.id);
    const next = recovery(run, agent, onKey);
    if (next.kind === 'resume' || next.kind === 'wait') this.store.journal(agent.id, { kind: 'interrupted', turn: next.turn });
    if (this.store.run(agent.id).owed.length) this.store.journal(agent.id, { kind: 'restored' });
    if (next.kind === 'none') return;
    if (next.kind === 'wait' || next.kind === 'hold') {
      if (agent.status === 'stopped') this.update(agent, { activity: next.why });
      return;
    }
    if (next.kind === 'hold-again') {
      this.core.planLimit.holdUntil(agent, next.until);
      return;
    }
    if (next.kind === 'deliver') {
      // what they'd committed goes onto GitHub as it was going to: they aren't asked to commit anything more, unless
      // Ops hadn't got as far as asking them
      if (!next.unasked) this.rt(agent.id).nudged = true;
      this.print(agent, [{ kind: 'system', text: next.unasked ? '✻ Focus restarted as their turn ended: putting their work on GitHub' : '✻ Focus restarted while their work was going onto GitHub: finishing that' }]);
      this.runFor(agent.id, this.core.delivery.deliver(agent, next.summary));
      return;
    }
    if (next.kind === 'requeue') {
      this.print(agent, [{ kind: 'system', text: '✻ Focus restarted while they waited for a free slot: back in line' }]);
      this.core.comms.pickUp(agent);
      return;
    }
    this.rt(agent.id).inbox.unshift(next.prompt);
    if (agent.sessionId !== next.session) this.update(agent, { sessionId: next.session });
    this.print(agent, [{ kind: 'system', text: '✻ Focus restarted part way through their turn: picking the conversation back up' }]);
    this.core.comms.pickUp(agent);
    // the turn cut off was asking them to commit what they left: they've been asked, and aren't again as it ends
    if (run.open?.prompt === COMMIT_NUDGE) this.rt(agent.id).nudged = true;
  }

  /** Focus is shutting down: every agent's session stops, and their turns are left to carry on when it starts again. */
  shutDown(): void {
    this.core.closing = true;
    for (const id of [...this.store.agents.keys()]) this.core.comms.stop(id);
  }

  fail(agent: Agent, err: { message: string } | string): void {
    const message = typeof err === 'string' ? err : err.message;
    this.print(agent, [{ kind: 'error', text: `✘ ${message}` }]);
    this.update(agent, { status: 'error', error: message, activity: 'Hit a problem – send a message to retry', permission: undefined, finishedAt: Date.now() });
    this.hub.toast('error', `${agent.name}: ${truncate(message, 140)}`, agent.id);
    if (agent.task === 'review') this.core.reviews.reviewEnded(agent, message);
    this.core.reviews.fixEnded(agent, 'failed');
    this.core.seating.schedule();
  }
}

/** A turn as it ended: what decides what follows it, and what that needs. */
interface TurnEnd {
  outcome: RunOutcome;
  prompt: string;
  resumeSessionId?: string;
  lead?: LeadAgent;
  review: boolean;
  /** How Claude Code signed in, when it wasn't the way Focus meant. */
  mismatch?: string;
}

/** The id Claude Code gives a workflow agent: nothing that could climb out of its transcripts' folder. */
const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A lead's workflow agent's transcript, as terminal lines: read from where Claude Code writes it, each time it's asked
 * for, since it grows as the agent works. Empty until there's one to read.
 */
export function workflowAgentLines(rt: Runtime | undefined, workflowId: string, agentId: string): Omit<TermLine, 't'>[] {
  const dir = rt?.workflowTranscripts?.get(workflowId);
  if (!dir || !AGENT_ID.test(agentId)) return [];
  try {
    return transcriptLines(readFileSync(join(dir, `agent-${agentId}.jsonl`), 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Keeps what a workflow event says about a lead's workflow's files: its script (the source the call carried, and where
 * Claude Code saved it) and where its agents' transcripts are. What to make of the event then: itself, the phases a
 * script read from its file plans, or nothing more when it was only about the files.
 */
export function keepWorkflowFiles(rt: Runtime, event: WorkflowEvent): WorkflowEvent | undefined {
  const scripts = (rt.workflowScripts ??= new Map());
  if (event.kind === 'started' && event.script) scripts.set(event.id, { ...scripts.get(event.id), source: event.script });
  if (event.kind !== 'transcripts') return event;
  (rt.workflowTranscripts ??= new Map()).set(event.id, event.dir);
  if (!event.scriptPath) return undefined;
  const script = { ...scripts.get(event.id), path: event.scriptPath };
  scripts.set(event.id, script);
  // a saved workflow, or one run from its script's path: what its meta plans is in the file
  if (script.source) return undefined;
  const source = readText(script.path);
  if (!source) return undefined;
  scripts.set(event.id, { ...script, source });
  return { kind: 'plan', id: event.id, plan: scriptPlan(source) };
}

/** A file Claude Code writes (a workflow's script, its journal), or nothing when it can't be read (not there yet). */
function readText(file: string | undefined): string | undefined {
  if (!file) return undefined;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * The script behind one of a lead's workflows, for the transporter console: its source, and once Claude Code has saved
 * the run (workflows/<runId>.json in the session's folder, beside subagents/workflows/<runId>/ where its agents'
 * transcripts are), what it logged and returned, and from the journal there what each agent has returned so far. Read
 * each time it's asked for, since the journal grows as agents finish and the run is saved when it ends.
 */
export function workflowScript(rt: Runtime | undefined, workflowId: string): WorkflowScript {
  const script = rt?.workflowScripts?.get(workflowId);
  const source = script?.source ?? readText(script?.path) ?? '';
  const dir = rt?.workflowTranscripts?.get(workflowId);
  if (!dir) return { source, logs: [], results: [] };
  const results = journalResults(readText(join(dir, 'journal.jsonl')) ?? '');
  try {
    const run = JSON.parse(readFileSync(join(dir, '..', '..', '..', 'workflows', `${basename(dir)}.json`), 'utf8')) as unknown;
    return { source, ...runOutcome(run), results };
  } catch {
    return { source, logs: [], results };
  }
}

/**
 * The end of a lead's background command's output, as terminal lines: read from the file it writes to, each time it's
 * asked for, since it grows as the command runs. Empty until there's one to read.
 */
export function backgroundOutputLines(rt: Runtime | undefined, taskId: string): Omit<TermLine, 't'>[] {
  const file = rt?.backgroundOutputs?.get(taskId);
  if (!file) return [];
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const length = Math.min(size, OUTPUT_TAIL);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    // cut into the middle of a line: start at the next whole one
    const text = buffer.toString('utf8');
    return outputLines(length < size ? text.slice(text.indexOf('\n') + 1) : text);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
