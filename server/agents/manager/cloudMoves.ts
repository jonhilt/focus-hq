import { Effect, Fiber, FiberMap, Option, Schedule } from 'effect';
import type { Agent, CloudHandover } from '../../../shared/types';
import { cloudSessionUrl } from '../../../shared/cloud';
import { cantMoveToCloud, terminalDescription } from '../cloud';
import { carryOnPrompt } from '../prompts';
import { Sessions, Workspace } from '../services';
import { cloudSessionId } from '../terminal';
import { STOPPED_BY_CAPTAIN } from '../types';
import { type ManagerServices, Part, Refused, withNotes, type WorkError } from './core';

/** What a moved agent's cloud session hears to carry on with: the work may be finished already. */
const MOVED_ON = 'Carry on with the work from where it was left off, and finish it. If it was already finished, check it over and reply with your summary again.';

/** What an agent's log says when Claude Code won't attach to the cloud session they were handed over to. */
export const CARRYING_ON_HERE = "✻ Claude Code won't attach to cloud sessions from Focus – carrying on here as a 💻 local agent";

/** Moving an agent to a Claude Code cloud session, attaching to it, or keeping them on this machine. */
export class CloudMoves extends Part {
  /**
   * Claude Code has refused to attach to a cloud session from Focus (it won't with the SDK's stream-json output), so a
   * session the captain starts is no use: from then on, for as long as Focus runs, agents carry on here instead of
   * waiting for one.
   */
  attachRefused = false;

  /**
   * The captain's Move to cloud: whatever the agent is doing stops (their session with it), everything they've done
   * goes onto their branch on GitHub, and they wait for a cloud session to carry on in (`awaitCloud`). One who hasn't
   * started yet starts in the cloud, like a cloud hire.
   */
  async moveToCloud(id: string): Promise<Agent> {
    const agent = this.store.agent(id);
    const refused = cantMoveToCloud(agent);
    if (refused) throw new Refused({ message: refused });
    if (agent.status === 'queued') {
      this.update(agent, { cloud: true });
      this.print(agent, [{ kind: 'system', text: `✻ The captain moved ${agent.name} to the cloud: they'll start there` }]);
      return agent;
    }
    const rt = this.rt(id);
    await this.runtime.runPromise(FiberMap.remove(this.runs, id));
    rt.busy = false;
    const localSessionId = agent.sessionId;
    const work = Effect.gen({ self: this }, function* () {
      const workspace = yield* Workspace;
      const dir = workspace.dir(agent.id);
      this.update(agent, { status: 'setting-up', activity: 'Putting their work on GitHub for the cloud session', permission: undefined, error: undefined });
      this.print(agent, [{ kind: 'system', text: `✻ The captain is moving ${agent.name} to a cloud session: their work so far goes onto ${agent.branch} on GitHub` }]);
      yield* workspace.snapshot(dir, `WIP: ${agent.name} moves to a cloud session`);
      if (yield* workspace.missingRemoteCommits(dir, agent.branch)) {
        return yield* new Refused({ message: `Someone else pushed to ${agent.branch} meanwhile: merge it in with \`git pull --no-rebase origin ${agent.branch}\` before they can move` });
      }
      yield* this.retrying(agent, 'the push', workspace.push(dir, agent.branch));
      this.awaitCloud(agent, { since: Date.now(), fresh: false, localSessionId });
    });
    await this.runtime.runPromise(Fiber.join(this.runFor(id, work.pipe(this.orFail(agent)))));
    return agent;
  }

  /** The agent waits for a cloud session, which the captain starts: in a terminal Focus opens, or on claude.ai. */
  awaitCloud(agent: Agent, handover: CloudHandover): void {
    this.update(agent, {
      cloud: true,
      sessionId: undefined,
      handover: { ...handover, terminalAt: undefined },
      status: 'waiting',
      activity: 'Waiting for a cloud session',
      context: undefined,
      finishedAt: undefined,
    });
    this.print(agent, [{ kind: 'system', text: '☁ Waiting for a cloud session: ▶ Start opens a terminal that starts one, or start one on claude.ai/code and paste its link' }]);
    this.hub.toast('info', `☁ ${agent.name} is waiting for a cloud session`, agent.id);
    this.core.seating.schedule();
  }

  /**
   * Opens a terminal on the captain's screen that starts the agent's cloud session (Claude Code starts one only from a
   * terminal), and watches it: once the session's id shows up, Ops attaches to it.
   */
  async openCloudTerminal(id: string): Promise<Agent> {
    const agent = this.store.agent(id);
    if (!agent.handover) throw new Refused({ message: `${agent.name} isn't waiting for a cloud session` });
    const open = Effect.gen({ self: this }, function* () {
      const cwd = (yield* Workspace).dir(agent.id);
      return yield* (yield* Sessions).cloudTerminal({ agentId: agent.id, agentName: agent.name, cwd, description: terminalDescription(agent) });
    }).pipe(Effect.mapError((err) => new Refused({ message: err.message })));
    const terminal = await this.runtime.runPromise(open);
    // a terminal opened before isn't watched any more
    await this.runtime.runPromise(FiberMap.remove(this.runs, id));
    if (!agent.handover) return agent; // attached meanwhile
    this.update(agent, { handover: { ...agent.handover, terminalAt: Date.now() }, activity: 'Waiting for the terminal to start their cloud session' });
    this.print(agent, [{ kind: 'system', text: '✻ Opened a terminal that starts their cloud session: once it has, Ops attaches and sends the work over' }]);
    this.runFor(id, this.watchTerminal(agent, terminal.read));
    return agent;
  }

  /** Looks for the session's id in what the terminal shows, and attaches once it's there. */
  private watchTerminal(agent: Agent, read: Effect.Effect<string | undefined>): Effect.Effect<void, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      // a terminal Focus can't see (Windows): the captain pastes the link
      if ((yield* read) === undefined) return this.update(agent, { activity: 'Waiting for a cloud session: paste its link once the terminal has started it' });
      const found = yield* read.pipe(
        Effect.map((text) => cloudSessionId(text ?? '')),
        Effect.repeat({ schedule: Schedule.spaced('2 seconds'), until: (sessionId) => sessionId !== undefined }),
        Effect.timeoutOption('20 minutes'),
      );
      const sessionId = Option.getOrUndefined(found);
      if (!sessionId) return this.update(agent, { activity: 'Waiting for a cloud session: paste its link once it has started' });
      yield* this.attach(agent, sessionId);
    });
  }

  /** The captain pasted a link to the cloud session (or its id) for the agent to carry on in. */
  async attachCloud(id: string, link: string): Promise<Agent> {
    const agent = this.store.agent(id);
    if (!agent.handover) throw new Refused({ message: `${agent.name} isn't waiting for a cloud session` });
    const sessionId = cloudSessionId(link);
    if (!sessionId) throw new Refused({ message: 'That isn’t a cloud session: paste its link from claude.ai/code (https://claude.ai/code/session_…)' });
    await this.runtime.runPromise(FiberMap.remove(this.runs, id));
    this.runFor(id, this.attach(agent, sessionId));
    return agent;
  }

  /**
   * Attaches to the cloud session the captain started (Claude Code does that without a terminal) and sends it
   * Ops' instructions with the work: their task, or what they'd done so far, which is on their branch.
   */
  private attach(agent: Agent, sessionId: string): Effect.Effect<void, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const handover = agent.handover;
      if (!handover || !this.store.agents.has(agent.id)) return;
      const rt = this.rt(agent.id);
      this.update(agent, { handover: undefined, cloud: true, sessionId, status: 'setting-up', activity: 'Sending the work to the cloud session' });
      this.print(agent, [{ kind: 'system', text: `☁ Attaching to their cloud session: ${cloudSessionUrl(agent) ?? sessionId}` }]);
      const work = handover.fresh
        ? withNotes(yield* this.core.sessions.taskPrompt(agent), rt.notes)
        : carryOnPrompt(agent, MOVED_ON);
      rt.nudged = false;
      rt.attaching = { tries: 0, handover };
      // a session the captain started hasn't had Ops' instructions
      yield* this.core.sessions.runSession(agent, `${yield* this.core.sessions.instructions(agent)}\n\n---\n\n${work}`, sessionId);
    }).pipe(this.orFail(agent));
  }

  /**
   * Claude Code won't attach to the agent's cloud session: they carry on here as a 💻 local agent, as `stayLocal` would
   * have them, but without waiting for the captain. One who hadn't started starts their task; one who was moved carries
   * on from their branch (pulled first, in case it moved on GitHub), in their own conversation if they had one.
   */
  carryOnHere(agent: Agent, handover: CloudHandover): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      rt.nudged = false;
      this.update(agent, { handover: undefined, cloud: undefined, sessionId: handover.localSessionId, status: 'setting-up' });
      this.print(agent, [{ kind: 'system', text: CARRYING_ON_HERE }]);
      if (handover.fresh) {
        this.update(agent, { activity: 'Reading the issue' });
        return yield* this.core.sessions.runSession(agent, withNotes(yield* this.core.sessions.taskPrompt(agent), rt.notes));
      }
      this.update(agent, { activity: `Fetching ${agent.branch} from GitHub` });
      const workspace = yield* Workspace;
      yield* workspace.pull(workspace.dir(agent.id), agent.branch);
      const prompt = [MOVED_ON, ...rt.inbox.take()].join('\n\n');
      return yield* this.core.sessions.runSession(agent, handover.localSessionId ? prompt : carryOnPrompt(agent, prompt), handover.localSessionId);
    });
  }

  /**
   * The captain keeps a waiting agent on this machine, in their own conversation again. One who hasn't started starts
   * their task here (unless `start` is false: the captain stopped them).
   */
  async stayLocal(id: string, start = true): Promise<Agent> {
    const agent = this.store.agent(id);
    const handover = agent.handover;
    if (!handover) throw new Refused({ message: `${agent.name} isn't waiting for a cloud session` });
    await this.runtime.runPromise(FiberMap.remove(this.runs, id));
    this.update(agent, { handover: undefined, cloud: undefined, sessionId: handover.localSessionId });
    this.print(agent, [{ kind: 'system', text: `✻ ${agent.name} stays on this machine as a 💻 local agent` }]);
    if (!start || !handover.fresh) {
      this.update(agent, { status: 'stopped', activity: start ? 'Staying on this machine: send a message to carry on' : STOPPED_BY_CAPTAIN, finishedAt: Date.now() });
      this.core.seating.schedule();
      return agent;
    }
    const rt = this.rt(id);
    this.update(agent, { status: 'setting-up', activity: 'Reading the issue' });
    this.runFor(id, Effect.gen({ self: this }, function* () {
      yield* this.core.sessions.runSession(agent, withNotes(yield* this.core.sessions.taskPrompt(agent), rt.notes));
    }).pipe(this.orFail(agent)));
    return agent;
  }
}
