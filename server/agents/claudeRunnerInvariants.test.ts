import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../shared/types';
import { BrowserPool } from './browserTool';
import { ClaudeRunner, REPORT_TURN_GRACE_MS } from './claudeRunner';
import { type Action, checkAtOnce, type Later, now, type Running, type Subject } from './invariants';
import type { AgentSession, RunHooks, RunRequest } from './types';
import { StandInClaude as Code } from './claudeStandIn';

// The Claude Code session runner (`ClaudeRunner`), under the office's rule that two things at once end as one after the
// other would (docs/invariants.md). A session keeps listening while what a turn left running in the background (a
// command, a workflow) runs on after the turn, takes what it reports in a turn of its own that can still ask the
// office (docs/goals.md: "It keeps listening through the turn Claude Code takes for the last task's result"), and stops
// listening once nothing's left. Described here (what can happen to a session, what must hold), not told what to
// expect: the runner runs as it is, on a stand-in for Claude Code at the SDK's `query`.

vi.setConfig({ testTimeout: 120_000 });

interface QueryArgs {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}
/** Where the stand-in for Claude Code is plugged in: each `query` the runner makes starts one. */
const sdk = vi.hoisted(() => ({ code: undefined as ((args: QueryArgs) => unknown) | undefined }));
vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  query: (args: QueryArgs) => sdk.code?.(args),
}));

/** The minute a session waits, once its last background task ends, for the turn that takes its result: held here
 *  until a minute is said to pass, every other timer left as it is. */
const minute = new Map<NodeJS.Timeout, () => void>();
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler: (...args: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
  if (ms !== REPORT_TURN_GRACE_MS) return realSetTimeout(handler, ms, ...rest);
  const held = realSetTimeout(() => undefined, 2 ** 31 - 1);
  held.unref();
  minute.set(held, () => handler());
  return held;
});
vi.spyOn(globalThis, 'clearTimeout').mockImplementation((t?: string | number | NodeJS.Timeout) => {
  if (t instanceof Object) minute.delete(t);
  realClearTimeout(t);
});

const settings: Settings = { maxConcurrent: 4, autonomy: 'ask', model: '', conflictsModel: '', qaModel: '', mergeMethod: 'squash', attribution: true, userClaudeMd: true, leadEffort: 'high' };
const request = (resumeSessionId?: string): RunRequest => ({ agentId: 'lead_runner', agentName: 'Lt. Lead', cwd: process.cwd(), prompt: resumeSessionId ? 'resumed' : 'the brief', systemAppend: '', settings, autonomy: 'ask', resumeSessionId });

/** What must hold of a session, once it has settled. */
export interface Said {
  /** What Claude Code took into its turns, and what waits for its next. */
  taken: string[];
  waiting: string[];
  turn: boolean;
  /** What runs in the background, as Claude Code has it and as the office was told. */
  running: string[];
  told: string[];
  /** Tools the office approved, and those Claude Code cancelled because nobody was listening to ask. */
  approved: number;
  cancelled: number;
  /** Whether the office is still listening to the session (between turns), and how the session ended, once it has. */
  listening?: boolean;
  ended?: string;
}

const sorted = (xs: string[]) => [...xs].sort();

/** Until what `read` says stops changing (three looks 2 ms apart, a second at most). */
const steady = async (read: () => unknown) => {
  let last = JSON.stringify(read());
  for (let same = 0, i = 0; same < 3 && i < 500; i++) {
    await new Promise((r) => realSetTimeout(r, 2));
    const now = JSON.stringify(read());
    same = now === last ? same + 1 : 0;
    last = now;
  }
};

/** A session; `only`, the actions offered, by name, when a check is after one thing. */
const sessionOf = (only?: RegExp, except?: RegExp): Subject<Said> => ({
  name: 'session',
  start: (start) => {
    const taken: string[] = [];
    const life = (later: Later, resume?: string): Running<Said> => {
      let code: Code | undefined;
      sdk.code = ({ prompt, options }) => (code = new Code(taken, options, prompt, later)).query();
      // what the office was told runs in the background (its probes and transporter rooms)
      const told = new Map<string, string>();
      let ended: string | undefined;
      const hooks: RunHooks = {
        lines: () => undefined,
        activity: () => undefined,
        browser: () => undefined,
        screenshot: () => undefined,
        session: () => undefined,
        cost: () => undefined,
        permission: () => Promise.resolve(true),
        background: (e) => {
          if (e.kind === 'started') told.set(e.id, 'local_bash');
          if (e.kind === 'ended') told.delete(e.id);
        },
        workflow: (e) => {
          if (e.kind === 'started') told.set(e.id, 'local_workflow');
          if (e.kind === 'ended') told.delete(e.id);
        },
      };
      const session: AgentSession = new ClaudeRunner(new BrowserPool()).start(request(resume), hooks);
      void session.done.then((o) => (ended = o.ok ? 'done' : (o.error ?? 'failed')));
      const said = (): Said => ({
        taken: sorted(taken),
        waiting: sorted(code?.queue ?? []),
        turn: !!code?.turn,
        running: sorted((code?.tasks ?? []).map((t) => t.kind)),
        // once the session's over, what its probes last said is the office's to settle (a restart marks them lost)
        told: ended ? [] : sorted([...told.values()]),
        approved: code?.approved ?? 0,
        cancelled: code?.cancelled ?? 0,
        // compared between turns: mid-turn it can be off, as a message sent just as a turn ends gets a turn of its
        // own that the office has stopped listening to (`a message sent as the turn ends`, below)
        ...(!code?.turn && { listening: !code?.inputEnded }),
        ended,
      });
      const claude = (label: string, work: (c: Code) => void) => () =>
        later(label, () => {
          if (!code) throw new Error('Claude Code never started');
          work(code);
          return Promise.resolve();
        });
      const actions = (): Action[] =>
        ([
          {
            name: 'the captain sends a message',
            run: () => {
              if (!session.send('a message')) throw new Error('not listening');
            },
          },
          { name: 'the turn ends', run: claude('the turn ends', (c) => c.endTurn()) },
          { name: 'the turn starts a command in the background', run: claude('a command starts', (c) => c.startTask('local_bash')) },
          { name: 'the turn starts a workflow', run: claude('a workflow starts', (c) => c.startTask('local_workflow')) },
          { name: 'a background task reports', run: claude('a task reports', (c) => c.taskEnds(true)) },
          { name: 'a background task ends, and no turn comes', run: claude('a task ends', (c) => c.taskEnds(false)) },
          // what real streams show beside that (claudeContract.ts): a message or a report folded into the turn under
          // way, a workflow's progress whenever it comes, and a list that leaves a running workflow out (eab2be2)
          { name: 'Claude Code folds what waits into the turn', run: claude('Claude Code folds', (c) => c.fold()) },
          { name: 'a workflow reports how it’s going', run: claude('a workflow reports progress', (c) => c.progress()) },
          { name: 'Claude Code lists its background leaving a workflow out', run: claude('Claude Code lists', (c) => c.listWithoutWorkflows()) },
          {
            name: 'the captain stops a command',
            run: async () => {
              const command = code?.tasks.find((t) => t.kind === 'local_bash');
              if (!command || !(await session.stopTask?.(command.id))) throw new Error('nothing to stop, or not listening');
            },
          },
          {
            name: 'a minute passes',
            run: () => {
              if (!minute.size) throw new Error('nothing waits for a minute');
              for (const [t, fire] of [...minute]) {
                minute.delete(t);
                fire();
              }
            },
          },
          { name: 'the office goes down', run: () => session.stop() },
        ] satisfies Action[]).filter((a) => (!only || only.test(a.name)) && !except?.test(a.name));
      return {
        actions,
        durable: said,
        settle: () => steady(() => [said(), code?.busy]),
        close: () => session.stop(),
        restart: (l) => {
          // the office stops every session as it goes down (`shutDown`), and resumes the lead's when it's back
          session.stop();
          return life(l, 'session-1');
        },
      };
    };
    // started once Claude Code has taken the brief: the reference runs read a session's state straight after it starts
    const first = life(start);
    return first.settle().then(() => first);
  },
});
const session = sessionOf();

describe('a Claude Code session, under the office’s rule for two things at once', () => {
  // a description that never got a session listening past its turn, or a report taken in a turn that could still ask,
  // would prove nothing of what the session hears after its turn
  it('reaches a session listening on past its turn, hearing a message and a report, and done once nothing’s left', async () => {
    const s = await session.start(now);
    const seen: Said[] = [];
    const step = async (name: string) => {
      await Promise.resolve().then(() => s.actions().find((a) => a.name === name)?.run()).catch(() => undefined);
      await s.settle();
      seen.push(s.durable());
    };
    for (const name of ['the turn starts a command in the background', 'the turn starts a workflow', 'the turn ends', 'the captain sends a message', 'the turn ends', 'a background task reports', 'the turn ends', 'a background task ends, and no turn comes', 'a minute passes']) await step(name);
    s.close?.();
    // the turn over with a command and a workflow running: still listening
    expect(seen[2]).toMatchObject({ turn: false, running: ['local_bash', 'local_workflow'], told: ['local_bash', 'local_workflow'], listening: true });
    // a message then, taken in a turn that could ask the office
    expect(seen[3]).toMatchObject({ taken: ['a message', 'the brief'], turn: true, approved: 2 });
    // the command's report taken in a turn of its own, which can still ask
    expect(seen[5]).toMatchObject({ taken: ['a message', 'report from local_bash', 'the brief'], approved: 3, cancelled: 0, running: ['local_workflow'] });
    // the workflow ends with no turn for it: listening for a minute, then not, and the session's done
    expect(seen[7]).toMatchObject({ running: [], listening: true });
    expect(seen[8]).toMatchObject({ listening: false, ended: 'done', cancelled: 0 });
  });

  it('reaches a message sent mid-turn taken in a turn of its own, with the office listening on through it', async () => {
    const s = await session.start(now);
    for (const name of ['the captain sends a message', 'the turn ends', 'the turn starts a command in the background', 'the turn ends']) {
      await Promise.resolve().then(() => s.actions().find((a) => a.name === name)?.run()).catch(() => undefined);
      await s.settle();
    }
    const said = s.durable();
    s.close?.();
    expect(said).toMatchObject({ taken: ['a message', 'the brief'], turn: false, running: ['local_bash'], listening: true, approved: 2 });
  });

  // what the real streams added (claudeContract.ts): a message folded into the turn under way rather than a turn of its
  // own, a workflow's progress between turns, and a list leaving a running workflow out
  it('reaches a message folded into the turn under way, a workflow’s progress, and a list that leaves the workflow out', async () => {
    const s = await session.start(now);
    const seen: Said[] = [];
    const ran: boolean[] = [];
    for (const name of ['the captain sends a message', 'Claude Code folds what waits into the turn', 'the turn starts a workflow', 'the turn ends', 'a workflow reports how it’s going', 'Claude Code lists its background leaving a workflow out', 'a minute passes']) {
      ran.push(await Promise.resolve().then(() => s.actions().find((a) => a.name === name)?.run()).then(() => true, () => false));
      await s.settle();
      seen.push(s.durable());
    }
    s.close?.();
    // the minute: nothing waits for one, as the workflow still holds the session open
    expect(ran).toEqual([true, true, true, true, true, true, false]);
    // folded: taken in the turn under way, nothing waiting, no turn of its own
    expect(seen[1]).toMatchObject({ taken: ['a message', 'the brief'], waiting: [], turn: true, approved: 2 });
    expect(seen[5]).toMatchObject({ turn: false, running: ['local_workflow'] });
  });

  // docs/goals.md: "A workflow the office has seen start and not end holds it open too, whatever Claude Code lists"
  it('keeps listening while a workflow it saw start runs, whatever Claude Code lists', async () => {
    const s = await session.start(now);
    for (const name of ['the turn starts a workflow', 'the turn ends', 'Claude Code lists its background leaving a workflow out', 'a minute passes', 'a workflow reports how it’s going']) {
      await Promise.resolve().then(() => s.actions().find((a) => a.name === name)?.run()).catch(() => undefined);
      await s.settle();
    }
    const said = s.durable();
    s.close?.();
    expect(said).toMatchObject({ turn: false, running: ['local_workflow'], told: ['local_workflow'], listening: true });
  });

  it('ends two things at once as one after the other would', async () => {
    await checkAtOnce(session, { runs: 40, prefix: 5 });
  });

  // Found on main by the check above (docs/invariants.md): the turn's result says nothing's queued, as the message is
  // still on its way to Claude Code, so the office stops listening; Claude Code takes the message in a turn of its own
  // anyway, and what that turn leaves running reports to a session nobody's listening to, whose tools it cancels.
  it('a message sent as the turn ends is heard by a session still listening', async () => {
    const held: { label: string; go: () => void }[] = [];
    const later: Later = (label, work) => new Promise<void>((go) => held.push({ label, go })).then(work);
    const release = async (label: string) => {
      const at = held.findIndex((h) => h.label === label);
      held.splice(at, 1)[0]?.go();
      await s.settle();
    };
    const s = await session.start(later);
    const act = async (name: string) => {
      void Promise.resolve().then(() => s.actions().find((a) => a.name === name)?.run()).catch(() => undefined);
      await s.settle();
    };
    await act('the captain sends a message');
    await act('the turn ends');
    // the turn ends before Claude Code reads the message
    await release('the turn ends');
    await release('Claude Code counts its context');
    await release('Claude Code reads a message');
    await act('the turn starts a command in the background');
    await release('a command starts');
    await act('the turn ends');
    await release('the turn ends');
    await release('Claude Code counts its context');
    await act('a background task reports');
    await release('a task reports');
    const said = s.durable();
    s.close?.();
    expect(said).toMatchObject({ taken: ['a message', 'report from local_bash', 'the brief'], cancelled: 0 });
  });

  // what's under way as a turn ends: what it left running, a message, a report
  it('ends a turn ending at once with what happens round it as one after the other would', async () => {
    await checkAtOnce(sessionOf(/turn|message|reports|no turn comes/), { runs: 40, prefix: 5 });
  });
});
