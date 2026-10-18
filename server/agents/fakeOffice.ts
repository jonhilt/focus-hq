// A pretend office for the manager's tests, and plugins' (plugins/*/…test.ts): demo GitHub and checkouts, and a
// Claude Code stand-in whose turns the test ends. Only tests import it.
import { Layer, Schedule } from 'effect';
import { expect } from 'vitest';
import { demoLayer } from '../github/demo';
import type { GitHub } from '../github/service';
import type { Triager } from './triage';
import { Hub } from '../hub';
import { agentAfterRestart, Store } from '../store';
import type { Autonomy } from '../../shared/types';
import { demoWorkspace } from './demoRunner';
import { AgentManager } from './manager';
import { Renderer, Sessions, ShipRetry, Triage, Workspace } from './services';
import type { AgentRunner, AgentSession, CloudTerminal, CloudTerminalRequest, RunHooks, RunOutcome, RunRequest, WorkspaceOps } from './types';

/** A Claude Code stand-in: each turn runs until the test ends it, and remembers being stopped, what it was sent and which background tasks it stopped. */
export class FakeClaude implements AgentRunner {
  turns: { req: RunRequest; hooks: RunHooks; end: (outcome: RunOutcome) => void; stopped: boolean; sent: string[]; modes: Autonomy[]; stoppedTasks: string[] }[] = [];
  /** The terminals opened to start cloud sessions, and what they show. */
  terminals: CloudTerminalRequest[] = [];
  shown = '';
  /** Its sessions have stopped listening: they refuse to stop a background task. */
  deaf = false;

  cloudTerminal(req: CloudTerminalRequest): Promise<CloudTerminal> {
    this.terminals.push(req);
    return Promise.resolve({ read: () => Promise.resolve(this.shown) });
  }

  start(req: RunRequest, hooks: RunHooks): AgentSession {
    let end!: (outcome: RunOutcome) => void;
    const done = new Promise<RunOutcome>((resolve) => (end = resolve));
    const stoppedTasks: string[] = [];
    const turn = { req, hooks, end, stopped: false, sent: [] as string[], modes: [] as Autonomy[], stoppedTasks };
    this.turns.push(turn);
    // a new cloud session's id comes once it's started, which Claude Code may refuse to do first
    if (!req.cloud || req.resumeSessionId) hooks.session(req.resumeSessionId ?? 'session-1');
    return {
      send: (text) => (turn.sent.push(text), true),
      // a session whose input has closed can't stop one
      stopTask: (taskId) => Promise.resolve(!this.deaf && (turn.stoppedTasks.push(taskId), true)),
      // a cloud session's mode waits for its next turn
      setAutonomy: (mode) => (turn.modes.push(mode), !req.cloud),
      stop: () => {
        turn.stopped = true;
        end({ ok: false, summary: '', aborted: true });
      },
      done,
    };
  }
}

/** The room's operations officer, when nobody's said what they decide: they can't work it out. */
const noOfficer: Triager = { triage: () => Promise.reject(new Error('no officer here')) };

export function office(workspace: WorkspaceOps = demoWorkspace, github: Layer.Layer<GitHub> = demoLayer, triager: Triager = noOfficer) {
  const store = new Store(false);
  const project = store.addProject('Shop');
  project.repos = ['demo/webshop-frontend', 'demo/webshop-api'];
  return { store, project, ...crew(store, workspace, github, triager) };
}

/**
 * The office after Focus restarts: its store as it loads again (whoever was at work stopped, their run journals as they
 * were), and a new manager and Claude Code, which haven't recovered anyone yet (`agents.recover()`).
 */
export function restarted(store: Store, workspace: WorkspaceOps = demoWorkspace, github: Layer.Layer<GitHub> = demoLayer) {
  for (const agent of [...store.agents.values()]) store.putAgent(agentAfterRestart(agent, 'Shop'));
  return crew(store, workspace, github, noOfficer);
}

function crew(store: Store, workspace: WorkspaceOps, github: Layer.Layer<GitHub>, triager: Triager) {
  const claude = new FakeClaude();
  const services = Layer.mergeAll(
    github,
    // retries after a GitHub 5xx come straight away
    Layer.succeed(ShipRetry, Schedule.spaced(0)),
    Workspace.fromOps(workspace),
    Sessions.fromRunner(claude),
    Triage.fromTriager(triager),
    Renderer.fromBrowser({
      render: (html, frames) => (html.includes('unrenderable') ? Promise.reject(new Error('no browser')) : Promise.resolve({
        image: Buffer.from('jpeg'),
        errors: html.includes('throws') ? ['ReferenceError: nope is not defined'] : [],
        // a stage that says "blank" draws nothing
        ...(frames && { frames: frames.at.map((at) => ({ at, image: Buffer.from(`beat at ${at}`), seen: { flat: html.includes('blank') ? 1 : 0.7, labels: [] } })) }),
      })),
    }),
  );
  return { claude, agents: new AgentManager(store, new Hub(), services, () => undefined) };
}

/** Waits (a few seconds at most) for the office to get there. */
export async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}
