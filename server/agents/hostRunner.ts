import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Adapter, type ConversationEvent, Host, type Lent, makeClaudeAdapter, type Tool, type WatchItem, Journal } from 'agent-host';
import { Effect, Fiber, Layer, ManagedRuntime, Stream } from 'effect';
import type { Effort } from '../../shared/types';
import { paths } from '../config';
import { errorMessage } from '../util';
import { BackgroundTracker } from './backgroundTasks';
import { browserTools, type BrowserPool } from './browserTool';
import { agentEnv, DECLINED } from './claudeRunner';
import { HOST_AUTONOMY, isSdkMessage, joining, reaction, runsOnHost } from './hostRunnerRules';
import { openScratch, type Scratch } from './scratch';
import { handleMessage, type RunContext, type TurnResult } from './sdkMessages';
import type { AgentRunner, AgentSession, RunHooks, RunOutcome, RunRequest } from './types';
import { sessionEnv } from './wait';

// Developer sessions on agent-host (jonhilt/agent-host): the host keeps each agent's conversation with Claude Code (a
// journal of its own, resuming a turn a restart cut off, holding at your plan's usage limit), and this runner maps
// Focus's turns onto it. Each Focus turn watches the conversation until the turn ends; Claude Code's own messages ride
// along on the host's events, so they're rendered exactly as the old runner renders them (`handleMessage`).

/** agent-host's own folder: its journal, and the Claude Code config folder its sessions run under (you sign in there once). */
export const HOST_DIR = path.join(os.homedir(), '.agent-host');
export const HOST_CLAUDE_DIR = path.join(HOST_DIR, 'claude');

/** The label a conversation is found by: the Focus agent whose it is. */
const AGENT_LABEL = 'focusAgent';

/** What the runner holds for an agent: its scratch dir, and the hooks of the turn watching it now. */
interface Lending {
  scratch: Scratch;
  hooks?: RunHooks;
}

export class HostRunner implements AgentRunner {
  private readonly runtime: ManagedRuntime.ManagedRuntime<Host | Journal, never>;
  private readonly lendings = new Map<string, Lending>();
  /** Which Focus agent each conversation is, by the host's id. */
  private readonly agentOf = new Map<string, string>();
  private closing = false;

  constructor(
    private readonly browsers: BrowserPool,
    claude: Adapter = makeClaudeAdapter({ configDir: HOST_CLAUDE_DIR, env: agentEnv(false), extend: (id) => this.extend(id) }),
    journalPath = path.join(HOST_DIR, 'journal.sqlite'),
  ) {
    const host = Host.layer({ adapters: { claude }, lend: (c) => this.lend(c.id, c.labels[AGENT_LABEL]) });
    this.runtime = ManagedRuntime.make(host.pipe(Layer.provideMerge(Journal.layer(journalPath))));
  }

  /**
   * Focus is shutting down: a turn's stop now leaves it to the host, which picks it up when Focus starts again, rather
   * than ending it. Then lets the host go.
   */
  async shutDown(): Promise<void> {
    this.closing = true;
    await this.runtime.dispose();
  }

  /** Starts the host: it picks up what a restart cut off (resuming turns, timing holds) without waiting for a turn. */
  warmUp(): void {
    this.run(Effect.void).catch((err: unknown) => console.warn(`agent-host didn't start: ${errorMessage(err)}`));
  }

  /** Before Focus stops its turns as it shuts down. */
  closingNow(): void {
    this.closing = true;
  }

  start(req: RunRequest, hooks: RunHooks): AgentSession {
    const turn = new HostTurn(this, req, hooks);
    return turn.session();
  }

  /** The host, for a turn to run its operations on. */
  run<A, E>(effect: Effect.Effect<A, E, Host | Journal>): Promise<A> {
    return this.runtime.runPromise(effect);
  }

  get isClosing(): boolean {
    return this.closing;
  }

  /** A turn of `agentId`'s starts: a fresh scratch dir, and its hooks for the browser's frames. */
  opened(agentId: string, hooks: RunHooks): Lending {
    this.lendings.get(agentId)?.scratch.close();
    const lending = { scratch: openScratch(agentId, paths.dcgConfig), hooks };
    this.lendings.set(agentId, lending);
    return lending;
  }

  /** The turn's over: its scratch dir goes, as the old runner's does. */
  closed(agentId: string, lending: Lending): void {
    if (this.lendings.get(agentId) !== lending) return;
    lending.scratch.close();
    lending.hooks = undefined;
  }

  remember(conversationId: string, agentId: string): void {
    this.agentOf.set(conversationId, agentId);
  }

  /** What an agent's sessions are lent: the browser, and the scratch dir's environment (focus-wait, bash, dcg). */
  lent(agentId: string): Lent {
    const lending = this.lendings.get(agentId) ?? { scratch: openScratch(agentId, paths.dcgConfig) };
    this.lendings.set(agentId, lending);
    const hooks = (): Pick<RunHooks, 'browser' | 'screenshot'> => lending.hooks ?? { browser: () => undefined, screenshot: () => undefined };
    const tools: Tool[] = browserTools(this.browsers, agentId, hooks);
    return { tools, env: definedOnly(sessionEnv(agentEnv(false), lending.scratch.env)) };
  }

  /** The host opening a conversation Focus didn't start in this run (one it resumes after a restart). */
  private lend(conversationId: string, agentId: string | undefined): Lent {
    if (!agentId) return {};
    this.remember(conversationId, agentId);
    return this.lent(agentId);
  }

  /** Claude Code's own extras: the scratch dir's guard on Bash (and the push guard's), before it runs. */
  private extend(conversationId: string) {
    const agentId = this.agentOf.get(conversationId);
    const scratch = agentId ? this.lendings.get(agentId)?.scratch : undefined;
    return scratch ? { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [scratch.hook] }] } } : {};
  }
}

/** Developers' sessions on the host, everyone else's (and every cloud session) on `claude`. */
export function splitRunner(claude: AgentRunner, host: HostRunner): AgentRunner {
  const cloudTerminal = claude.cloudTerminal?.bind(claude);
  return {
    start: (req, hooks) => (runsOnHost(req.task, !!req.cloud) ? host : claude).start(req, hooks),
    ...(cloudTerminal && { cloudTerminal }),
  };
}

/** One Focus turn of an agent's session on the host, start to finish. */
class HostTurn {
  private conversation?: string;
  /** Messages Focus sent before the conversation was known. */
  private readonly early: string[] = [];
  private over = false;
  private stopAsked = false;
  private effort?: Effort;
  private result?: TurnResult;
  private readonly seen = new WeakSet<object>();
  private readonly asks = new Map<string, AbortController>();
  private readonly ctx: RunContext;
  private watching?: Fiber.Fiber<void, unknown>;

  constructor(
    private readonly runner: HostRunner,
    private readonly req: RunRequest,
    private readonly hooks: RunHooks,
  ) {
    this.ctx = { cwd: req.cwd, cloud: false, calls: new Map(), helpers: new Map(), workflows: new Set(), modelled: new Set(), probes: new Set(), commits: new Map(), onKey: false, counted: new Set() };
    this.ctx.tracker = new BackgroundTracker((id) => (id ? this.ctx.calls.get(id)?.name : undefined));
  }

  session(): AgentSession {
    const done = this.run();
    return {
      send: (text) => this.send(text),
      setEffort: (effort) => {
        this.effort = effort;
      },
      setAutonomy: (mode) => {
        const id = this.conversation;
        if (id) void this.runner.run(Host.use((h) => h.setAutonomy(id, HOST_AUTONOMY[mode]))).catch(() => undefined);
        return true;
      },
      stop: () => this.stop(),
      done,
    };
  }

  private async run(): Promise<RunOutcome> {
    const lending = this.runner.opened(this.req.agentId, this.hooks);
    this.ctx.scratch = lending.scratch.dir;
    this.hooks.signIn?.(false);
    try {
      return await new Promise<RunOutcome>((resolve, reject) => {
        this.runner
          .run(this.join(resolve))
          .then((fiber) => (this.watching = fiber))
          .catch(reject);
      });
    } catch (err) {
      return { ok: false, summary: '', error: `agent-host: ${errorMessage(err)}`, started: false };
    } finally {
      this.over = true;
      for (const ask of this.asks.values()) ask.abort();
      if (this.watching) void this.runner.run(Fiber.interrupt(this.watching)).catch(() => undefined);
      this.runner.closed(this.req.agentId, lending);
    }
  }

  /** Joins the agent's conversation (`joining`) and watches it until the turn ends. */
  private join(resolve: (o: RunOutcome) => void) {
    return Effect.gen({ self: this }, function* () {
      const host = yield* Host;
      const journal = yield* Journal;
      const { agentId } = this.req;
      const found = yield* host.find({ [AGENT_LABEL]: agentId });
      const plan = joining(found, this.req.resumeSessionId);
      let id: string;
      let after = 0;
      if (plan.kind === 'start') {
        for (const old of plan.stop) yield* host.stop(old).pipe(Effect.ignore);
        if (plan.resumes) copyTranscript(plan.resumes);
        id = yield* host.start(
          {
            agent: 'claude',
            model: this.req.model || this.req.settings.model || 'opus',
            ...(this.req.effort && { effort: this.req.effort }),
            folder: this.req.cwd,
            labels: { [AGENT_LABEL]: agentId },
            autonomy: HOST_AUTONOMY[this.req.autonomy],
            loadOwnerSettings: this.req.settings.userClaudeMd,
            allowApiKeyFallback: false,
            firstMessage: this.req.prompt,
            systemAppend: this.req.systemAppend,
            disallowedTools: ['AskUserQuestion', 'EnterPlanMode'],
            ...(plan.resumes && { resumeAgentSession: plan.resumes }),
          },
          this.runner.lent(agentId),
        );
        this.runner.remember(id, agentId);
      } else {
        id = plan.id;
        this.runner.remember(id, agentId);
        after = (yield* journal.read(id)).at(-1)?.seq ?? 0;
      }
      this.conversation = id;
      const watch = host.watch(id).pipe(
        Stream.filter((item) => item._tag === 'Live' || item.seq > after),
        Stream.runForEach((item) => this.onItem(item, resolve)),
        // the watch ended without the turn's end (the conversation went away): the turn's over all the same
        Effect.ensuring(Effect.sync(() => resolve({ ok: false, summary: this.result?.text ?? '', error: 'agent-host stopped watching the conversation', started: true }))),
      );
      const fiber = yield* Effect.forkDetach(watch);
      if (plan.kind === 'send') yield* host.send(id, this.req.prompt, this.effort ? { effort: this.effort } : {});
      for (const text of this.early.splice(0)) yield* host.send(id, text);
      if (this.stopAsked) yield* host.interrupt(id);
      return fiber;
    });
  }

  private send(text: string): boolean {
    if (this.over) return false;
    const id = this.conversation;
    if (!id) {
      this.early.push(text);
      return true;
    }
    const effort = this.effort;
    void this.runner.run(Host.use((h) => h.send(id, text, effort ? { effort } : {}))).catch(() => undefined);
    return true;
  }

  private stop(): void {
    // Focus shutting down: the host carries the turn on when it starts again
    if (this.runner.isClosing || this.over) return;
    this.stopAsked = true;
    const id = this.conversation;
    if (id) void this.runner.run(Host.use((h) => h.interrupt(id))).catch(() => undefined);
  }

  private onItem(item: WatchItem, resolve: (o: RunOutcome) => void): Effect.Effect<void> {
    return Effect.sync(() => {
      const raw = 'raw' in item.event ? item.event.raw : undefined;
      // Claude Code's own message, rendered as the old runner renders it, once (one message can be several events)
      if (isSdkMessage(raw) && !this.seen.has(raw)) {
        this.seen.add(raw);
        const result = handleMessage(raw, this.ctx, this.hooks);
        if (result) this.result = result;
      }
      if (item._tag === 'Journaled') this.onEvent(item.event, resolve);
    });
  }

  private onEvent(event: ConversationEvent, resolve: (o: RunOutcome) => void): void {
    const r = reaction(event, this.result);
    switch (r.kind) {
      case 'ask':
        return this.ask(r.requestId, r.tool, r.summary);
      case 'answered':
        this.asks.get(r.requestId)?.abort();
        this.asks.delete(r.requestId);
        return;
      case 'context':
        return this.hooks.context?.(r.context);
      case 'say':
        this.hooks.lines(r.lines);
        if (r.activity) this.hooks.activity(null, r.activity);
        return;
      case 'end':
        return resolve(r.outcome);
    }
  }

  /** A raised hand, put to the manager as the old runner's are; the first answer wins, from anyone watching. */
  private ask(requestId: string, tool: string, summary: string): void {
    const controller = new AbortController();
    this.asks.set(requestId, controller);
    void this.hooks.permission(tool, summary, controller.signal).then((approved) => {
      if (controller.signal.aborted) return;
      const answer = approved ? { _tag: 'AllowOnce' as const } : { _tag: 'Deny' as const, message: DECLINED };
      return this.runner.run(Host.use((h) => h.answer(requestId, answer))).catch(() => undefined);
    });
  }
}

/** The environment as the host takes it: no unset values. */
function definedOnly(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]])));
}

/**
 * A session that started under your own Claude Code config folder carries on under the host's: its transcript goes
 * where the host's Claude Code looks for it, once.
 */
export function copyTranscript(sessionId: string, from = paths.transcripts, to = path.join(HOST_CLAUDE_DIR, 'projects')): boolean {
  for (const folder of safeReaddir(from)) {
    const source = path.join(from, folder, `${sessionId}.jsonl`);
    if (!fs.existsSync(source)) continue;
    const target = path.join(to, folder, `${sessionId}.jsonl`);
    if (fs.existsSync(target)) return false;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    return true;
  }
  return false;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

