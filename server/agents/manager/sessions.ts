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
import { COMPACT_INSTRUCTIONS, compactInstructions, freshSessionPrompt, hasLeadWork, helperChange, HELPER_LINGER_MS, leadSystemAppend } from '../lead';
import { mismatchError, recovery, signInMismatch, turnEnding, type TurnKind } from '../runJournal';
import { carryOnPrompt, conflictsPrompt, issuePrompt, systemAppend } from '../prompts';
import { MAX_SCREENSHOTS, QA_SCHEMA } from '../qa';
import { Sessions, Workspace } from '../services';
import { applyTaskTool } from '../tasks';
import { applyWorkflowEvent, journalResults, runOutcome, scriptPlan, transcriptLines, WORKFLOW_LINGER_MS } from '../workflows';
import { committedWaypoint, probedWaypoints, taskedWaypoint } from '../waypoints';
import { applyBackgroundEvent, BACKGROUND_LINGER_MS, OUTPUT_TAIL, outputLines } from '../backgroundTasks';
import { type ExtraTool, type RunHooks, type RunOutcome, type RunRequest, STOPPED_BY_CAPTAIN, type WorkflowEvent } from '../types';
import { EmptyRepository, FINISHED, type ManagerServices, Part, Refused, ReportGone, type Runtime, withNotes, type WorkError } from './core';

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
      // the PR's branch may be checked out in its goal's lead's workspace: someone resolving its conflicts works on a
      // local branch of their own, which the office pushes to the PR's
      const local = agent.task === 'conflicts' ? `${agent.branch}-conflicts-${agent.id.slice(-4)}` : undefined;
      yield* workspace.create(agent.repo, agent.id, agent.branch, startPoint, (id) => this.store.agents.has(id), local);
      // a cloud session works in a clone of its own, so it installs there
      if (!agent.cloud) yield* this.install(agent, workspace.dir(agent.id));
      if (agent.cloud) {
        // a cloud session clones its branch from GitHub, so a new one has to be there first
        this.update(agent, { activity: 'Publishing the branch for the cloud session' });
        yield* workspace.publish(workspace.dir(agent.id), agent.branch);
      }
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
        // signed in with a key that costs, behind the office's back: stopped before it spends any more
        this.store.journal(agent.id, { kind: 'sign-in-mismatch', turn, observed: keySource });
        this.print(agent, [{ kind: 'error', text: `✘ Claude Code signed in with ${keySource} when the office meant your plan: stopping the turn` }]);
        rt.session?.stop();
      },
      context: (context) => this.update(agent, { context }),
      taskTool: (name, input, result, said) => {
        const before = agent.tasks ?? [];
        const tasks = applyTaskTool(before, name, input, result, said);
        if (tasks === before) return;
        // a lead's are its slice's work on the goal's chart too
        const work = agent.task === 'lead' ? agent.lead : undefined;
        const waypoints = work && taskedWaypoint(work, before, tasks, Date.now());
        this.update(agent, { tasks, ...(work && waypoints !== work.waypoints && { lead: { ...work, waypoints } }) });
      },
      helper: (event) => {
        // only a lead's helpers have somewhere to sit: the lead's team station
        if (agent.task !== 'lead') return;
        const change = helperChange(agent, event, Date.now());
        if (!change) return;
        this.update(agent, change);
        if (event.kind === 'started') this.print(agent, [{ kind: 'system', text: `✻ ${helperFor(event.id).name} joins ${agent.name}'s team station: ${event.description}` }]);
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
        if (agent.task !== 'lead') return;
        if (event.kind === 'output') {
          (rt.backgroundOutputs ??= new Map()).set(event.id, event.file);
          return;
        }
        const before = agent.background ?? [];
        const background = applyBackgroundEvent(before, event, Date.now());
        if (background === before) return;
        this.update(agent, { background });
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
        if (!next) return;
        event = next;
        const before = agent.workflows ?? [];
        const workflows = applyWorkflowEvent(before, event, Date.now());
        if (workflows === before) return;
        this.update(agent, { workflows });
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
  instructions(agent: Agent): Effect.Effect<string, GitHubError, GitHub> {
    if (agent.task === 'review') return this.core.reviews.qaSystem(agent);
    if (agent.task === 'lead' && agent.lead) return Effect.succeed(leadSystemAppend(agent, this.store.project(agent.projectId).name, agent.lead.station));
    return Effect.succeed(systemAppend(agent, this.core.plugins.brief(agent.brief)));
  }

  /** One turn of the agent's session: the same tools and instructions on every turn, so a resumed session stays itself. */
  private runRequest(agent: Agent, prompt: string, instructions: string, resumeSessionId?: string): RunRequest {
    // the lead's tools answer Claude Code as Promises: the SDK's tool boundary
    const tool = <A>(effect: Effect.Effect<A, WorkError, ManagerServices>) => this.runtime.runPromise(effect);
    const cwd = this.runtime.runSync(Workspace.use((w) => Effect.succeed(w.dir(agent.task === 'review' ? this.core.reviews.reviewDir(agent) : agent.id))));
    return {
      agentId: agent.id,
      agentName: agent.name,
      cwd,
      prompt,
      systemAppend: instructions,
      resumeSessionId,
      settings: this.store.settings,
      autonomy: effectiveAutonomy(agent, this.store.settings),
      effort: agent.effort,
      model: agent.model,
      outputSchema: agent.task === 'review' ? QA_SCHEMA : undefined,
      cloud: agent.cloud ? { branch: agent.branch } : undefined,
      scripted: this.core.plugins.brief(agent.brief)?.demo,
      tools: agent.task === 'lead'
        ? { ship: (input) => tool(this.core.slices.shipLead(agent, input)), note: (input) => tool(this.core.goalTools.noteGoal(agent, input)), show: (input) => tool(this.core.goalTools.showArtifact(agent, input)), model: (input) => tool(this.core.goalTools.showModel(agent, input)), explain: (input) => tool(this.core.goalTools.explain(agent, input)), ask: (input) => tool(this.core.goalTools.askCaptain(agent, input)), proposeClose: (input) => tool(this.core.goalTools.proposeClose(agent, input.reason)), extra: this.leadTools(agent, cwd) }
        : undefined,
    };
  }

  /** The tools of the plugins switched on for a lead's project, in their office, bound to them: their checkouts (in `workspace`), and their station's screen. */
  private leadTools(agent: Agent, workspace: string): ExtraTool[] {
    // only the plugins switched on for the lead's project
    const project = this.store.projects.find((p) => p.id === agent.projectId);
    return this.core.plugins.leadTools().filter(({ plugin }) => pluginOn(project, plugin)).map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      input: tool.input,
      run: (input) =>
        tool.run(
          {
            agent,
            checkouts: (agent.lead?.repos ?? []).map((r) => ({ repo: r.repo, dir: join(workspace, r.folder) })),
            show: (page) => this.runtime.runPromise(this.core.goalTools.showArtifact(agent, page)),
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
          // the office shutting down stops every turn: each stays open in the journal, to carry on at the next start
          if (this.core.closing) return;
          // interrupted (sent home, moved to the cloud): it's over as much as a stop is
          this.store.journal(agent.id, { kind: 'turn-ended', turn, outcome: Exit.isSuccess(exit) ? turnEnding(exit.value) : { ok: false, aborted: true } });
        }),
      ),
    );
  }

  /**
   * Compacts the agent's conversation with `/compact` and the office's instructions for what to keep. Never fails the
   * agent: a compaction that doesn't happen leaves the conversation as it was. Succeeds with whether it happened.
   */
  private compact(agent: Agent, keep: string): Effect.Effect<boolean, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      if (!agent.sessionId || agent.cloud) return false;
      const rt = this.rt(agent.id);
      const wasBusy = rt.busy;
      rt.busy = true;
      this.update(agent, { activity: 'Compacting the conversation' });
      this.print(agent, [{ kind: 'system', text: '✻ The office compacts the conversation, keeping what the goal needs' }]);
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
    if (agent.task === 'review') throw new Refused({ message: 'QA starts each review afresh, so there’s nothing to compact' });
    if (!agent.sessionId || agent.cloud) throw new Refused({ message: `${agent.name} has no conversation here to compact` });
    if (!FINISHED.includes(agent.status) || FiberMap.hasUnsafe(this.runs, id)) throw new Refused({ message: `${agent.name} is working: compact once their turn ends` });
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
      if (lead) prompt = [yield* this.core.slices.beforeTurn(lead), prompt].filter(Boolean).join('\n\n');
      // before marking them busy: the QA officer's instructions may need GitHub, and that can fail
      const instructions = yield* this.instructions(agent);
      rt.busy = true;
      this.update(agent, { status: 'working', activity: resumeSessionId ? 'Reading your message' : 'Getting started', error: undefined, finishedAt: undefined });
      this.core.plugins.turn(agent, 'start');
      // a turn that's interrupted (sent home, moved to the cloud) still ends, for the plugins
      const outcome = yield* this.turn(agent, this.runRequest(agent, prompt, instructions, resumeSessionId), true).pipe(
        Effect.ensuring(Effect.sync(() => this.core.plugins.turn(agent, 'end'))),
      );
      rt.busy = false;
      // the office is shutting down: what follows waits for it to start again (`recover`)
      if (this.core.closing) return;
      // what the manager wrote during the turn carries them on into another; notes that waited for its end don't
      const carryOn = rt.inbox.length > 0;
      rt.inbox.release();
      if (!this.store.agents.has(agent.id)) return;

      const ended: TurnEnd = { outcome, prompt, resumeSessionId, lead, review, attaching: rt.attaching, mismatch: this.store.run(agent.id).last?.mismatch };
      return yield* this.follow(agent, this.decide(agent, ended, carryOn), ended);
    });
  }

  /**
   * What follows the turn, from the run's state machine (`runMachine.ts`): where it ran and what its end was say
   * where the run goes next, and the journal has it.
   */
  private decide(agent: Agent, ended: TurnEnd, carryOn: boolean): Target {
    const { attaching } = ended;
    const next = step(attaching ? 'attaching' : agent.cloud ? 'cloud' : 'local', turnEvent(ended.outcome, ended.mismatch), {
      role: ended.review ? 'review' : ended.lead ? 'lead' : 'work',
      resumed: !!ended.resumeSessionId,
      hasSession: !!agent.sessionId,
      tries: attaching?.tries ?? 0,
      attachRefused: this.core.cloud.attachRefused,
      carryOn,
    });
    if (attaching && next !== 'attach-again') this.rt(agent.id).attaching = undefined;
    const last = this.store.run(agent.id).last;
    if (last) this.store.journal(agent.id, { kind: 'decided', turn: last.id, target: next });
    return next;
  }

  /** Does what the run's machine decided follows the turn. */
  private follow(agent: Agent, next: Target, ended: TurnEnd): Effect.Effect<void, WorkError, ManagerServices> {
    if (next === 'attach-again' || next === 'attach-refused' || next === 'attach-failed') {
      // only a turn attaching to a cloud session ends here
      return ended.attaching ? this.afterAttaching(agent, next, ended.attaching, ended.outcome, ended.prompt, ended.resumeSessionId) : Effect.void;
    }
    if (next === 'cloud-carry-on-here' || next === 'cloud-await' || next === 'cloud-to-local' || next === 'new-cloud-session') return this.afterCloud(agent, next, ended);
    return this.afterWork(agent, next, ended);
  }

  /** A cloud turn's session couldn't be had: carry on here, wait for the captain to start one, or start a new one. */
  private afterCloud(agent: Agent, next: 'cloud-carry-on-here' | 'cloud-await' | 'cloud-to-local' | 'new-cloud-session', { outcome, prompt }: TurnEnd): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      switch (next) {
        case 'cloud-carry-on-here':
          // they haven't started, and Claude Code wouldn't attach to a session the captain started either
          rt.nudged = false;
          return yield* this.core.cloud.carryOnHere(agent, { since: Date.now(), fresh: true });
        case 'cloud-await':
          // they haven't started: the captain starts their cloud session, which a terminal can, or keeps them here
          rt.nudged = false;
          this.print(agent, [{ kind: 'system', text: "✻ Claude Code won't start a cloud session without a terminal" }]);
          return this.core.cloud.awaitCloud(agent, { since: Date.now(), fresh: true });
        case 'cloud-to-local': {
          // a session id from the cloud means it already worked there: its pushes may be on GitHub but not in the worktree
          rt.nudged = false;
          this.update(agent, { cloud: undefined, sessionId: undefined });
          this.print(agent, [{ kind: 'system', text: "✻ Claude Code won't start a cloud session from Focus – carrying on here as a 💻 local agent" }]);
          this.update(agent, { activity: `Fetching ${agent.branch} from GitHub` });
          const workspace = yield* Workspace;
          yield* workspace.pull(workspace.dir(agent.id), agent.branch);
          // only a new session gets refused, so this is already a carry-on prompt with the manager's message in it
          return yield* this.runSession(agent, prompt);
        }
        case 'new-cloud-session':
          // everything the old session did is on the branch: a new one picks it up from there
          this.print(agent, [{ kind: 'system', text: `✻ Couldn't get back into the cloud session (${truncate(outcome.error ?? 'no reason given', 200)}) – starting a new one on ${agent.branch}` }]);
          return yield* this.runSession(agent, carryOnPrompt(agent, prompt));
      }
    });
  }

  /** The turn's work is over, or it stopped: what comes of it, by who they are and how it ended. */
  private afterWork(agent: Agent, next: Exclude<Target, 'attach-again' | 'attach-refused' | 'attach-failed' | 'cloud-carry-on-here' | 'cloud-await' | 'cloud-to-local' | 'new-cloud-session'>, { outcome, prompt, lead, review, mismatch }: TurnEnd): Effect.Effect<void, WorkError, ManagerServices> {
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
          this.core.seating.schedule();
          return;
        case 'deliver':
          return yield* this.core.delivery.deliver(agent, outcome.summary);
      }
    });
  }

  /** A turn attaching to the cloud session the captain started has ended: try again, carry on here, or wait for the captain. */
  private afterAttaching(
    agent: Agent,
    next: 'attach-again' | 'attach-refused' | 'attach-failed',
    attaching: NonNullable<Runtime['attaching']>,
    outcome: RunOutcome,
    prompt: string,
    resumeSessionId?: string,
  ): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      switch (next) {
        case 'attach-again':
          // the session the captain started may still be answering its first message
          attaching.tries++;
          this.update(agent, { activity: 'Waiting for the cloud session to finish its first reply' });
          yield* Effect.sleep('15 seconds');
          return yield* this.runSession(agent, prompt, resumeSessionId);
        case 'attach-refused':
          // Claude Code won't attach from Focus at all: no session the captain starts would do, so they carry on here
          this.core.cloud.attachRefused = true;
          return yield* this.core.cloud.carryOnHere(agent, attaching.handover);
        case 'attach-failed':
          this.print(agent, [{ kind: 'error', text: `✘ Couldn't attach to the cloud session: ${outcome.error ?? 'no reason given'}` }]);
          return this.core.cloud.awaitCloud(agent, attaching.handover);
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
    const next = recovery(this.store.run(agent.id), agent, onKey);
    if (next.kind === 'resume' || next.kind === 'wait') this.store.journal(agent.id, { kind: 'interrupted', turn: next.turn });
    if (this.store.run(agent.id).owed.length) this.store.journal(agent.id, { kind: 'restored' });
    // a cloud agent waiting for the captain to start its session waits as it was
    if (next.kind === 'none' || agent.handover) return;
    if (next.kind === 'wait' || next.kind === 'hold') {
      if (agent.status === 'stopped') this.update(agent, { activity: next.why });
      return;
    }
    if (next.kind === 'hold-again') {
      this.core.planLimit.holdUntil(agent, next.until);
      return;
    }
    if (next.kind === 'deliver') {
      // what they'd committed goes onto GitHub as it was going to: they aren't asked to commit anything more
      this.rt(agent.id).nudged = true;
      this.print(agent, [{ kind: 'system', text: '✻ Focus restarted while their work was going onto GitHub: finishing that' }]);
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
  }


  /** The office is shutting down: every agent's session stops, and their turns are left to carry on when it starts again. */
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
  attaching?: Runtime['attaching'];
  /** How Claude Code signed in, when it wasn't the way the office meant. */
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
    return outputLines(buffer.toString('utf8'));
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
