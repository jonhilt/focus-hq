import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Fiber, FiberMap } from 'effect';
import { effectiveAutonomy } from '../../../shared/autonomy';
import { helperFor } from '../../../shared/crew';
import { prKey } from '../../../shared/qa';
import type { Agent, PermissionRequest, TermLine } from '../../../shared/types';
import { GitHub, type GitHubError } from '../../github/service';
import { newId, truncate } from '../../util';
import { attachAgain, carryOnInNewSession, CLOUD_UNAVAILABLE, fallBackToLocal } from '../cloud';
import { applyHelperEvent, COMPACT_INSTRUCTIONS, compactInstructions, freshSessionPrompt, HELPER_LINGER_MS, leadSystemAppend, sessionGone, sliceLanded } from '../lead';
import { climbBrief } from '../climb';
import { carryOnPrompt, conflictsPrompt, issuePrompt, systemAppend } from '../prompts';
import { MAX_SCREENSHOTS, QA_SCHEMA } from '../qa';
import { Sessions, Workspace } from '../services';
import { applyTaskTool } from '../tasks';
import { applyWorkflowEvent, transcriptLines, WORKFLOW_LINGER_MS } from '../workflows';
import { committedWaypoint, endedProbe, launchedProbe, nudgedWaypoint } from '../waypoints';
import { checklistState, type ChecklistSource } from '../checklist';
import { applyBackgroundEvent, BACKGROUND_LINGER_MS, OUTPUT_TAIL, outputLines } from '../backgroundTasks';
import { type RunHooks, type RunOutcome, type RunRequest, STOPPED_BY_CAPTAIN } from '../types';
import { EmptyRepository, FINISHED, type ManagerServices, Part, Refused, ReportGone, type Runtime, withNotes, type WorkError } from './core';

/** Running an agent's Claude Code session: launching their task, each turn and its hooks, compacting, and what follows a turn. */
export class AgentSessions extends Part {
  launch(agent: Agent): Effect.Effect<void, never, ManagerServices> {
    const rt = this.rt(agent.id);
    // a reopened goal's repos are checked out before anything else, however many tries that takes
    if (agent.task === 'lead' && agent.lead?.reopening) {
      rt.resume = false;
      this.update(agent, { status: 'setting-up', activity: 'Checking the goal’s branch out again', error: undefined });
      return this.core.leads.launchReopened(agent, agent.lead.reopening.closedAt).pipe(this.orFail(agent));
    }
    if (rt.resume) {
      rt.resume = false;
      this.update(agent, { status: 'setting-up', activity: 'Picking up where they left off' });
      return this.runSession(agent, rt.inbox.splice(0).join('\n\n'), agent.sessionId).pipe(this.orFail(agent));
    }
    this.update(agent, { status: 'setting-up', activity: agent.task === 'review' ? 'Reading the pull request' : agent.task === 'climb' ? 'Reading the brief' : 'Reading the issue', error: undefined });
    return Effect.gen({ self: this }, function* () {
      if (agent.task === 'review') return yield* this.core.reviews.launchReview(agent);
      if (agent.task === 'lead') return yield* this.core.leads.launchLead(agent);
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const info = yield* github.repoInfo(agent.repo);
      if (info.isEmpty) return yield* new EmptyRepository({ repo: agent.repo });
      if (agent.task === 'issue' || agent.task === 'climb') this.update(agent, { baseBranch: info.defaultBranch });
      const prompt = yield* this.taskPrompt(agent);
      // an issue or a climb starts a new branch from the base; conflicts and QA's findings are fixed on the PR's own branch
      const startPoint = agent.task === 'issue' || agent.task === 'climb' ? agent.baseBranch : agent.branch;
      this.print(agent, [{ kind: 'system', text: `✻ Setting up a worktree for ${agent.repo} on ${agent.branch}` }]);
      this.update(agent, { activity: 'Cloning the repository' });
      // the PR's branch may be checked out in its goal's lead's workspace: someone resolving its conflicts works on a
      // local branch of their own, which the office pushes to the PR's
      const local = agent.task === 'conflicts' ? `${agent.branch}-conflicts-${agent.id.slice(-4)}` : undefined;
      yield* workspace.create(agent.repo, agent.id, agent.branch, startPoint, (id) => this.store.agents.has(id), local);
      if (agent.cloud) {
        // a cloud session clones its branch from GitHub, so a new one has to be there first
        this.update(agent, { activity: 'Publishing the branch for the cloud session' });
        yield* workspace.publish(workspace.dir(agent.id), agent.branch);
      }
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      rt.notes = rt.inbox.splice(0);
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
        case 'climb':
          return climbBrief(agent, this.store.ledger, Date.now());
        case 'fix': {
          const review = this.store.reviews.get(prKey(agent.repo, agent.issue.number));
          if (!review?.report) return yield* new ReportGone({ number: agent.issue.number });
          const fixes = review.followUp?.kind === 'fixing' ? review.followUp.fixes : { kind: 'qa' as const };
          return this.core.reviews.fixPromptFor(agent, review, review.report, fixes);
        }
      }
    });
  }

  private hooks(agent: Agent): RunHooks {
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
      // a new session keeps a task list of its own, if any
      session: (sessionId) => this.update(agent, { sessionId, ...(agent.sessionId && agent.sessionId !== sessionId ? { tasks: undefined, context: undefined } : {}) }),
      context: (context) => this.update(agent, { context }),
      taskTool: (name, input, result, said) => {
        const before = agent.tasks ?? [];
        const tasks = applyTaskTool(before, name, input, result, said);
        if (tasks !== before) this.update(agent, { tasks });
      },
      helper: (event) => {
        // only a lead's helpers have somewhere to sit: the lead's team station
        if (agent.task !== 'lead') return;
        const before = agent.helpers ?? [];
        const now = Date.now();
        const helpers = applyHelperEvent(before, event, now, agent.effort);
        if (helpers === before) return;
        // each one's a probe on the goal's chart, from the slice under way
        const work = agent.lead;
        const waypoints = !work ? undefined
          : event.kind === 'started' ? launchedProbe(work, event, now)
          : event.kind === 'ended' ? endedProbe(work, event, now)
          : undefined;
        this.update(agent, { helpers, ...(work && waypoints && { lead: { ...work, waypoints } }) });
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
        const now = Date.now();
        const waypoints = event.kind === 'started' ? launchedProbe(work, event, now) : endedProbe(work, event, now);
        if (waypoints && waypoints !== work.waypoints) this.update(agent, { lead: { ...work, waypoints } });
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
        if (event.kind === 'transcripts') {
          (rt.workflowTranscripts ??= new Map()).set(event.id, event.dir);
          return;
        }
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
          }))));
        }
      },
      cost: (usd) => this.update(agent, { costUsd: usd }),
      permission: (tool, summary, signal) =>
        new Promise<boolean>((resolve) => {
          const req: PermissionRequest = { id: newId('ask'), tool, summary: truncate(summary, 300), at: Date.now() };
          const resume = agent.status === 'waiting' ? 'working' : agent.status;
          rt.permission = { req, resolve, resume };
          this.update(agent, { status: 'waiting', permission: req, activity: `Needs approval: ${truncate(summary, 60)}` });
          this.print(agent, [{ kind: 'manager', text: `✋ Waiting for the captain to approve ${truncate(summary, 200)}` }]);
          this.hub.toast('info', `✋ ${agent.name} needs your approval`, agent.id);
          signal.addEventListener('abort', () => {
            if (rt.permission?.req.id === req.id) {
              rt.permission = undefined;
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
    return Effect.succeed(systemAppend(agent));
  }

  /** One turn of the agent's session: the same tools and instructions on every turn, so a resumed session stays itself. */
  private runRequest(agent: Agent, prompt: string, instructions: string, resumeSessionId?: string): RunRequest {
    // the lead's tools answer Claude Code as Promises: the SDK's tool boundary
    const tool = <A>(effect: Effect.Effect<A, WorkError, ManagerServices>) => this.runtime.runPromise(effect);
    return {
      agentId: agent.id,
      agentName: agent.name,
      cwd: this.runtime.runSync(Workspace.use((w) => Effect.succeed(w.dir(agent.task === 'review' ? this.core.reviews.reviewDir(agent) : agent.id)))),
      prompt,
      systemAppend: instructions,
      resumeSessionId,
      settings: this.store.settings,
      autonomy: effectiveAutonomy(agent, this.store.settings),
      effort: agent.effort,
      model: agent.model,
      outputSchema: agent.task === 'review' ? QA_SCHEMA : undefined,
      cloud: agent.cloud ? { branch: agent.branch } : undefined,
      tools: agent.task === 'lead'
        ? { ship: (input) => tool(this.core.slices.shipLead(agent, input)), note: (input) => tool(this.core.goalTools.noteGoal(agent, input)), show: (input) => tool(this.core.goalTools.showArtifact(agent, input)), explain: (input) => tool(this.core.goalTools.explain(agent, input)), ask: (input) => tool(this.core.goalTools.askCaptain(agent, input)), proposeClose: (input) => tool(this.core.goalTools.proposeClose(agent, input.reason)) }
        : undefined,
      checklist: agent.task === 'lead' ? this.checklist(agent) : undefined,
    };
  }

  /** A lead's checklist as its hooks see it: the note's, with the slice's commits counted on its waypoint. */
  private checklist(agent: Agent): ChecklistSource {
    return {
      read: () => checklistState(agent.lead),
      nudged: () => {
        if (agent.lead) this.update(agent, { lead: { ...agent.lead, waypoints: nudgedWaypoint(agent.lead, Date.now()) } });
      },
    };
  }

  /**
   * One turn of the agent's session, start to finish. Messages waiting for them go in as it starts (`withInbox`). The
   * turn is held in a scope: interrupting it stops Claude.
   */
  private turn(agent: Agent, req: RunRequest, withInbox: boolean): Effect.Effect<RunOutcome, never, Sessions> {
    const rt = this.rt(agent.id);
    return Effect.scoped(
      Effect.gen({ self: this }, function* () {
        const session = yield* (yield* Sessions).start(req, this.hooks(agent));
        rt.session = session;
        if (withInbox) for (const message of rt.inbox.splice(0)) session.send(message);
        return yield* Effect.promise(() => session.done);
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => (rt.session = undefined))));
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
        Effect.flatMap((instructions) => this.turn(agent, this.runRequest(agent, `/compact ${keep}`, instructions, agent.sessionId), false)),
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
      const lead = agent.task === 'lead' ? agent.lead : undefined;
      // the lead's last slice has landed: their repos move to fresh code before they hear anything else
      if (lead && sliceLanded(lead.prs)) prompt = `${yield* this.core.slices.nextSlice(agent, lead)}\n\n${prompt}`;
      // before marking them busy: the QA officer's instructions may need GitHub, and that can fail
      const instructions = yield* this.instructions(agent);
      rt.busy = true;
      this.update(agent, { status: 'working', activity: resumeSessionId ? 'Reading your message' : 'Getting started', error: undefined, finishedAt: undefined });
      const outcome = yield* this.turn(agent, this.runRequest(agent, prompt, instructions, resumeSessionId), true);
      rt.busy = false;
      // what the manager wrote during the turn carries them on into another; notes that waited for its end don't
      const carryOn = rt.inbox.length > 0;
      rt.inbox.push(...(rt.afterTurn?.splice(0) ?? []));
      if (!this.store.agents.has(agent.id)) return;

      const attaching = rt.attaching;
      if (attaching) {
        // the session the captain started may still be answering its first message
        if (attachAgain(outcome, attaching.tries)) {
          attaching.tries++;
          this.update(agent, { activity: 'Waiting for the cloud session to finish its first reply' });
          yield* Effect.sleep('15 seconds');
          return yield* this.runSession(agent, prompt, resumeSessionId);
        }
        rt.attaching = undefined;
        if (!outcome.ok && !outcome.aborted && !outcome.started) {
          // Claude Code won't attach from Focus at all: no session the captain starts would do, so they carry on here
          if (outcome.error === CLOUD_UNAVAILABLE) {
            this.core.cloud.attachRefused = true;
            return yield* this.core.cloud.carryOnHere(agent, attaching.handover);
          }
          this.print(agent, [{ kind: 'error', text: `✘ Couldn't attach to the cloud session: ${outcome.error ?? 'no reason given'}` }]);
          return this.core.cloud.awaitCloud(agent, attaching.handover);
        }
      }
      // your plan's usage limit stopped them: they carry on with your API key, now or once it resets
      if (outcome.limited) return yield* this.core.planLimit.limited(agent, prompt);
      if (outcome.aborted) {
        this.update(agent, { status: 'stopped', activity: STOPPED_BY_CAPTAIN, permission: undefined, finishedAt: Date.now() });
        if (review) this.core.reviews.reviewEnded(agent, STOPPED_BY_CAPTAIN);
        this.core.reviews.fixEnded(agent, 'stopped');
        this.core.seating.schedule();
        return;
      }
      if (fallBackToLocal(agent, outcome)) {
        // a session id from the cloud means it already worked there: its pushes may be on GitHub but not in the worktree
        const ranInCloud = !!agent.sessionId;
        rt.nudged = false;
        if (!ranInCloud) {
          // they haven't started, and Claude Code wouldn't attach to a session the captain started either
          if (this.core.cloud.attachRefused) return yield* this.core.cloud.carryOnHere(agent, { since: Date.now(), fresh: true });
          // they haven't started: the captain starts their cloud session, which a terminal can, or keeps them here
          this.print(agent, [{ kind: 'system', text: "✻ Claude Code won't start a cloud session without a terminal" }]);
          return this.core.cloud.awaitCloud(agent, { since: Date.now(), fresh: true });
        }
        this.update(agent, { cloud: undefined, sessionId: undefined });
        this.print(agent, [{ kind: 'system', text: "✻ Claude Code won't start a cloud session from Focus – carrying on here as a 💻 local agent" }]);
        this.update(agent, { activity: `Fetching ${agent.branch} from GitHub` });
        const workspace = yield* Workspace;
        yield* workspace.pull(workspace.dir(agent.id), agent.branch);
        // only a new session gets refused, so this is already a carry-on prompt with the manager's message in it
        return yield* this.runSession(agent, prompt);
      }
      if (lead && sessionGone(outcome, !!resumeSessionId)) {
        this.print(agent, [{ kind: 'system', text: '✻ Claude Code no longer has their conversation – carrying on in a new one' }]);
        this.update(agent, { sessionId: undefined });
        return yield* this.runSession(agent, freshSessionPrompt(agent.lead!, agent.branch, [prompt], false));
      }
      if (agent.cloud && carryOnInNewSession(outcome, !!resumeSessionId)) {
        // everything the old session did is on the branch: a new one picks it up from there
        this.print(agent, [{ kind: 'system', text: `✻ Couldn't get back into the cloud session (${truncate(outcome.error ?? 'no reason given', 200)}) – starting a new one on ${agent.branch}` }]);
        return yield* this.runSession(agent, carryOnPrompt(agent, prompt));
      }
      if (carryOn) {
        // The manager wrote while the session was wrapping up: carry on in the same conversation.
        return yield* this.runSession(agent, rt.inbox.splice(0).join('\n\n'), agent.sessionId);
      }
      if (!outcome.ok) {
        this.fail(agent, outcome.error ?? 'The agent stopped with an error');
        return;
      }
      if (review) return yield* this.core.reviews.finishReview(agent, outcome.structured, outcome.summary);
      if (lead) {
        // the lead's turn is over: it's the captain's turn, and their work ships when the lead says so, not now. Their
        // subagents and workflows ended with it; any that just finished linger a moment
        this.update(agent, { status: 'done', activity: 'Your turn', finishedAt: Date.now(), helpers: agent.helpers?.filter((h) => h.status !== 'working'), workflows: agent.workflows?.filter((w) => w.status !== 'running'), background: agent.background?.filter((t) => t.status !== 'running') });
        this.core.seating.schedule();
        return;
      }
      yield* this.core.delivery.deliver(agent, outcome.summary);
    });
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
