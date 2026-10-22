// A pretend Focus for the manager's tests, and plugins' (plugins/*/…test.ts): demo GitHub and checkouts, and a
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
import { type Frames, type Picture, QaChat, Renderer, Sessions, ShipRetry, Triage, Workspace } from './services';
import { DemoQaChat } from './demoQaChat';
import type { AgentRunner, AgentSession, CloudTerminal, CloudTerminalRequest, RunHooks, RunOutcome, RunRequest, WorkspaceOps } from './types';

/** A Claude Code stand-in: each turn runs until the test ends it, and remembers being stopped, what it was sent and which background tasks it stopped. */
export class FakeClaude implements AgentRunner {
  turns: { req: RunRequest; hooks: RunHooks; end: (outcome: RunOutcome) => void; stopped: boolean; sent: string[]; refusing: string[]; modes: Autonomy[]; stoppedTasks: string[] }[] = [];
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
    const turn: FakeClaude['turns'][number] = { req, hooks, end, stopped: false, sent: [], refusing: [], modes: [], stoppedTasks: [] };
    this.turns.push(turn);
    // a new cloud session's id comes once it's started, which Claude Code may refuse to do first
    if (!req.cloud || req.resumeSessionId) hooks.session(req.resumeSessionId ?? 'session-1');
    return {
      // a message the test has it refuse is one its input closed on
      send: (text) => !turn.refusing.includes(text) && (turn.sent.push(text), true),
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

/** Takes a page's picture; Focus's own stand-in answers at once unless a test hands it one of its own. */
export type Render = (html: string, frames?: Frames) => Promise<Picture>;

export function focus(workspace: WorkspaceOps = demoWorkspace, github: Layer.Layer<GitHub> = demoLayer, triager: Triager = noOfficer, render?: Render) {
  const store = new Store(false);
  const project = store.addProject('Shop');
  project.repos = ['demo/webshop-frontend', 'demo/webshop-api'];
  // a new project waits for the captain to send a PR to QA: Focus's tests follow QA by itself, as a project from before does
  project.autoQa = true;
  return { store, project, ...crew(store, workspace, github, triager, render) };
}

/**
 * Focus after it restarts: its store as it loads again (whoever was at work stopped, their run journals as they
 * were), and a new manager and Claude Code, which haven't recovered anyone yet (`agents.recover()`).
 */
export function restarted(store: Store, workspace: WorkspaceOps = demoWorkspace, github: Layer.Layer<GitHub> = demoLayer, render?: Render) {
  for (const agent of [...store.agents.values()]) store.putAgent(agentAfterRestart(agent, 'Shop'));
  return crew(store, workspace, github, noOfficer, render);
}

/** Focus's stand-in for the headless browser: a page with "unrenderable" in it can't be pictured, one with "throws" reports an error. */
const pictured: Render = (html, frames) => (html.includes('unrenderable') ? Promise.reject(new Error('no browser')) : Promise.resolve({
  image: Buffer.from('jpeg'),
  errors: html.includes('throws') ? ['ReferenceError: nope is not defined'] : [],
  // a stage that says "blank" draws nothing
  ...(frames && { frames: frames.at.map((at) => ({ at, image: Buffer.from(`beat at ${at}`), seen: { flat: html.includes('blank') ? 1 : 0.7, labels: [] } })) }),
}));

function crew(store: Store, workspace: WorkspaceOps, github: Layer.Layer<GitHub>, triager: Triager, render: Render = pictured) {
  const claude = new FakeClaude();
  const services = Layer.mergeAll(
    github,
    // retries after a GitHub 5xx come straight away
    Layer.succeed(ShipRetry, Schedule.spaced(0)),
    Workspace.fromOps(workspace),
    Sessions.fromRunner(claude),
    Triage.fromTriager(triager),
    Renderer.fromBrowser({ render }),
    // the demo's QA officer at the Playbook, answering at once
    QaChat.fromChatter(new DemoQaChat(0)),
  );
  return { claude, agents: new AgentManager(store, new Hub(), services, () => undefined) };
}

/** Waits (a few seconds at most) for Focus to get there. */
export async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}
