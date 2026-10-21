// A stand-in for Claude Code at the SDK's `query`, for the session's checks (claudeRunnerInvariants.test.ts) and held
// to the Claude Code contract (claudeContract.ts) against streams distilled from real sessions. Only tests import it.
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Later } from './invariants';

export type Kind = 'local_bash' | 'local_workflow';
export interface Task {
  id: string;
  kind: Kind;
}

/** What Claude Code says when a tool needs approval and Ops' input has closed (2.1.289; earlier ones said "The user doesn't want to take this action right now"). */
export const NOBODY_TO_ASK = 'Tool permission request failed: AbortError: Stream closed';

/** How the stand-in plays the things real Claude Code leaves open. */
export interface Plays {
  /** The background list before the task's own start or end message, as Claude Code does in practice (its schema leaves the order open). */
  levelFirst?: boolean;
}

const textOf = (m: SDKUserMessage): string => (typeof m.message.content === 'string' ? m.message.content : '');

/**
 * Claude Code, as the runner meets it through the SDK: it reads what Ops sends, one turn at a time (a message
 * that comes during a turn waits for the next, and the turn's result says how many wait, unless Claude Code folds it
 * into the turn under way, as it mostly does); each turn opens with `init`. A turn can leave a command or a workflow
 * running in the background, which runs on after the turn and, when it ends, is taken in a turn of Claude Code's own;
 * the background list (`background_tasks_changed`) comes before each one's start and end. Each turn asks Ops to
 * approve a tool, which only Ops, still listening, can answer: once Ops' input has ended, and Claude Code
 * is idle (the SDK waits for that before closing its stdin), each tool that needs approval fails without asking. It
 * exits once its input has closed with nothing left to do.
 */
export class StandInClaude {
  /** What waits for the next turn: messages, and what background tasks reported. */
  queue: string[] = [];
  turn = false;
  tasks: Task[] = [];
  inputEnded = false;
  stdinClosed = false;
  approved = 0;
  cancelled = 0;
  /** Everything it has said, in order, as the contract reads it. */
  readonly said: Record<string, unknown>[] = [];
  private dead = false;
  private exited = false;
  private out: Record<string, unknown>[] = [];
  private wake?: () => void;
  private ids = 0;

  constructor(
    /** What it took into its turns: its transcript, kept across Focus's lives as Claude Code keeps it on disk. */
    readonly taken: string[],
    private readonly options: Options,
    prompt: AsyncIterable<SDKUserMessage>,
    private readonly later: Later,
    private readonly plays: Plays = {},
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

  get exitedNow(): boolean {
    return this.exited;
  }

  private async read(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    let first = true;
    for await (const m of prompt) {
      // the brief is in hand as the session starts; what Ops sends later is on its way down the pipe
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
    this.emit({ type: 'system', subtype: 'init', session_id: 'session-1', apiKeySource: 'none', claude_code_version: '2.1.0', model: 'claude', permissionMode: 'acceptEdits' });
    this.work(taking);
  }

  /** Takes `taking` into the turn under way: says so, and asks to run a tool. */
  private work(taking: string[]): void {
    this.taken.push(...taking);
    this.emit({ type: 'assistant', parent_tool_use_id: null, message: { id: `msg_${++this.ids}`, model: 'claude', content: [{ type: 'text', text: `On it: ${taking.join(', ')}` }] } });
    void this.ask();
  }

  private async ask(): Promise<void> {
    const id = `toolu_${++this.ids}`;
    this.emit({ type: 'assistant', parent_tool_use_id: null, message: { id: `msg_${id}`, model: 'claude', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'pnpm test' } }] } });
    if (this.stdinClosed) {
      this.cancelled++;
      this.emit({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: NOBODY_TO_ASK }] } });
      return;
    }
    const answer = await this.options.canUseTool?.('Bash', { command: 'pnpm test' }, { signal: new AbortController().signal, toolUseID: id, requestId: `r${this.ids}` });
    if (answer?.behavior === 'allow') this.approved++;
    if (!this.dead) this.emit({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: answer?.behavior !== 'allow', content: answer?.behavior === 'allow' ? 'ok' : 'declined' }] } });
  }

  endTurn(): void {
    if (this.dead || !this.turn) throw new Error('no turn under way');
    this.emit({ type: 'result', subtype: 'success', result: 'Done', is_error: false, duration_ms: 1000, num_turns: 1, total_cost_usd: 0, queued_turn_count: this.queue.length });
    this.turn = false;
    if (this.queue.length) this.startTurn(this.queue.splice(0));
    else this.idle();
  }

  /** What waits (messages, reports) is folded into the turn under way, as Claude Code does at its next step. */
  fold(): void {
    if (this.dead || !this.turn || !this.queue.length) throw new Error('nothing waits, or no turn to fold it into');
    this.work(this.queue.splice(0));
  }

  startTask(kind: Kind): void {
    if (this.dead || !this.turn) throw new Error('only a turn starts one');
    const id = `${kind === 'local_bash' ? 'b' : 'w'}${++this.ids}`;
    this.tasks.push({ id, kind });
    this.inOrder(() => this.emit({ type: 'system', subtype: 'task_started', task_id: id, task_type: kind, tool_use_id: `toolu_${id}`, description: kind === 'local_bash' ? 'pnpm dev' : 'Review', is_backgrounded: true, ...(kind === 'local_workflow' && { workflow_name: 'review' }) }));
  }

  /** The oldest background task ends; `reported`, Claude Code takes what it said in a turn. */
  taskEnds(reported: boolean, id = this.tasks[0]?.id, status = 'completed'): void {
    const task = this.tasks.find((t) => t.id === id);
    if (this.dead || !task) throw new Error('nothing running in the background');
    this.tasks = this.tasks.filter((t) => t !== task);
    this.inOrder(() => this.emit({ type: 'system', subtype: 'task_notification', task_id: task.id, status, summary: 'Finished', output_file: `/tmp/tasks/${task.id}.output`, tool_use_id: `toolu_${task.id}` }));
    if (reported) this.heard(`report from ${task.kind}`);
    else this.idle();
  }

  /** A workflow says how it's going, whatever the turns are doing. */
  progress(): void {
    const workflow = this.tasks.find((t) => t.kind === 'local_workflow');
    if (this.dead || !workflow) throw new Error('no workflow running');
    this.emit({ type: 'system', subtype: 'task_progress', task_id: workflow.id, tool_use_id: `toolu_${workflow.id}`, description: 'Review', usage: { total_tokens: 100, tool_uses: 1, duration_ms: 1000 } });
  }

  /** The background list, leaving out a workflow that still runs (what eab2be2's fix says a list once did). */
  listWithoutWorkflows(): void {
    if (this.dead || !this.tasks.some((t) => t.kind === 'local_workflow')) throw new Error('no workflow running');
    this.list(this.tasks.filter((t) => t.kind !== 'local_workflow'));
  }

  /** A stop from Ops goes over Claude Code's stdin: a command that's ended meanwhile isn't there to stop. */
  stopTask(id: string): Promise<void> {
    if (this.stdinClosed) return Promise.reject(new Error('stdin closed'));
    return this.later('Claude Code stops a command', () => {
      this.taskEnds(true, id, 'stopped');
      return Promise.resolve();
    });
  }

  /** A task's own start or end, and the background list as it now stands, in the order Claude Code plays them. */
  private inOrder(bookend: () => void): void {
    if (this.plays.levelFirst ?? true) this.list(this.tasks);
    bookend();
    if (!(this.plays.levelFirst ?? true)) this.list(this.tasks);
  }

  private list(tasks: Task[]): void {
    this.emit({ type: 'system', subtype: 'background_tasks_changed', tasks: tasks.map((t) => ({ task_id: t.id, task_type: t.kind, description: t.id })) });
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
    this.said.push(m);
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
