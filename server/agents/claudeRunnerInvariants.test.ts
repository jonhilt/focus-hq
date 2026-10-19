import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../shared/types';
import { BrowserPool } from './browserTool';
import { ClaudeRunner, REPORT_TURN_GRACE_MS } from './claudeRunner';
import { type Action, checkAtOnce, type Later, now, type Running, type Subject } from './invariants';
import type { AgentSession, RunHooks, RunRequest } from './types';

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

type Kind = 'local_bash' | 'local_workflow';
interface Task {
  id: string;
  kind: Kind;
}

const textOf = (m: SDKUserMessage): string => (typeof m.message.content === 'string' ? m.message.content : '');

/**
 * Claude Code, as the runner meets it through the SDK: it reads what the office sends, one turn at a time (a message
 * that comes during a turn waits for the next, and the turn's result says how many wait); a turn can leave a command
 * or a workflow running in the background, which runs on after the turn and, when it ends, is taken in a turn of
 * Claude Code's own. Each turn asks the office to approve a tool, which only an office still listening can answer:
 * once the office's input has ended, and Claude Code is idle (the SDK waits for that before closing its stdin), it
 * cancels each tool that needs approval. It exits once its input has closed with nothing left to do.
 */
class Code {
  /** What waits for the next turn: messages, and what background tasks reported. */
  queue: string[] = [];
  turn = false;
  tasks: Task[] = [];
  inputEnded = false;
  stdinClosed = false;
  approved = 0;
  cancelled = 0;
  private dead = false;
  private exited = false;
  private out: Record<string, unknown>[] = [];
  private wake?: () => void;
  private initialised = false;
  private ids = 0;

  constructor(
    /** What it took into its turns: its transcript, kept across the office's lives as Claude Code keeps it on disk. */
    readonly taken: string[],
    private readonly options: Options,
    prompt: AsyncIterable<SDKUserMessage>,
    private readonly later: Later,
  ) {
    options.abortController?.signal.addEventListener('abort', () => {
      // the process is killed, and what it had running in the background and waiting for a turn with it
      this.dead = true;
      this.inputEnded = true;
      this.turn = false;
      this.tasks = [];
      this.queue = [];
      this.wake?.();
    });
    void this.read(prompt);
  }

  get busy(): number {
    return this.out.length;
  }

  private async read(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    let first = true;
    for await (const m of prompt) {
      // the brief is in hand as the session starts; what the office sends later is on its way down the pipe
      if (!first) await this.later('Claude Code reads a message', () => Promise.resolve());
      first = false;
      if (this.dead) return;
      this.heard(textOf(m));
    }
    this.inputEnded = true;
    this.idle();
  }

  private heard(text: string): void {
    if (this.turn) this.queue.push(text);
    else this.startTurn([text]);
  }

  private startTurn(taking: string[]): void {
    this.turn = true;
    this.taken.push(...taking);
    if (!this.initialised) {
      this.initialised = true;
      this.emit({ type: 'system', subtype: 'init', session_id: 'session-1', apiKeySource: 'none', claude_code_version: '2.1.0', model: 'claude', permissionMode: 'acceptEdits' });
    }
    this.emit({ type: 'assistant', parent_tool_use_id: null, message: { id: `msg_${++this.ids}`, model: 'claude', content: [{ type: 'text', text: `On it: ${taking.join(', ')}` }] } });
    void this.ask();
  }

  private async ask(): Promise<void> {
    if (this.stdinClosed) {
      // "The user doesn't want to take this action right now"
      this.cancelled++;
      return;
    }
    const answer = await this.options.canUseTool?.('Bash', { command: 'pnpm test' }, { signal: new AbortController().signal, toolUseID: `toolu_${++this.ids}`, requestId: `r${this.ids}` });
    if (answer?.behavior === 'allow') this.approved++;
  }

  endTurn(): void {
    if (this.dead || !this.turn) throw new Error('no turn under way');
    this.emit({ type: 'result', subtype: 'success', result: 'Done', is_error: false, duration_ms: 1000, num_turns: 1, total_cost_usd: 0, queued_turn_count: this.queue.length });
    this.turn = false;
    if (this.queue.length) this.startTurn(this.queue.splice(0));
    else this.idle();
  }

  startTask(kind: Kind): void {
    if (this.dead || !this.turn) throw new Error('only a turn starts one');
    const id = `${kind === 'local_bash' ? 'b' : 'w'}${++this.ids}`;
    this.tasks.push({ id, kind });
    this.emit({ type: 'system', subtype: 'task_started', task_id: id, task_type: kind, tool_use_id: `toolu_${id}`, description: kind === 'local_bash' ? 'pnpm dev' : 'Review', is_backgrounded: true, ...(kind === 'local_workflow' && { workflow_name: 'review' }) });
    this.listTasks();
  }

  /** The oldest background task ends; `reported`, Claude Code takes what it said in a turn. */
  taskEnds(reported: boolean, id = this.tasks[0]?.id, status = 'completed'): void {
    const task = this.tasks.find((t) => t.id === id);
    if (this.dead || !task) throw new Error('nothing running in the background');
    this.tasks = this.tasks.filter((t) => t !== task);
    this.emit({ type: 'system', subtype: 'task_notification', task_id: task.id, status, summary: 'Finished', output_file: `/tmp/tasks/${task.id}.output` });
    this.listTasks();
    if (reported) this.heard(`report from ${task.kind}`);
    else this.idle();
  }

  /** A stop from the office goes over Claude Code's stdin: a command that's ended meanwhile isn't there to stop. */
  stopTask(id: string): Promise<void> {
    if (this.stdinClosed) return Promise.reject(new Error('stdin closed'));
    return this.later('Claude Code stops a command', () => {
      this.taskEnds(true, id, 'stopped');
      return Promise.resolve();
    });
  }

  private listTasks(): void {
    this.emit({ type: 'system', subtype: 'background_tasks_changed', tasks: this.tasks.map((t) => ({ task_id: t.id, task_type: t.kind, description: t.id })) });
  }

  private idle(): void {
    if (this.turn) return;
    if (this.inputEnded) this.stdinClosed = true;
    if (this.stdinClosed && !this.tasks.length && !this.queue.length) {
      this.exited = true;
      this.wake?.();
    }
  }

  private emit(m: Record<string, unknown>): void {
    this.out.push(m);
    this.wake?.();
  }

  async *messages(): AsyncGenerator<Record<string, unknown>> {
    for (;;) {
      if (this.dead) throw new Error('Claude Code process aborted by user');
      const m = this.out.shift();
      if (m) yield m;
      else if (this.exited) return;
      else await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }

  /** The query the runner holds: its messages, and what it asks of Claude Code. */
  query() {
    return {
      [Symbol.asyncIterator]: () => this.messages(),
      // a request to Claude Code, answered down the pipe
      getContextUsage: () => this.later('Claude Code counts its context', () => Promise.resolve({ percentage: 5, totalTokens: 50_000, rawMaxTokens: 1_000_000 })),
      stopTask: (id: string) => this.stopTask(id),
      interrupt: () => Promise.resolve(),
      setPermissionMode: () => Promise.resolve(),
      applyFlagSettings: () => Promise.resolve(),
    };
  }
}

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
