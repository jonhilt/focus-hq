import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Adapter, type ClaudeAdapterOptions, type ConversationEvent, Host, type Lent, makeClaudeAdapter, makeCodexAdapter, type Tool, type WatchItem, Journal } from 'agent-host';
import { Effect, Fiber, Layer, ManagedRuntime, Stream } from 'effect';
import type { Effort } from '../../shared/types';
import { paths } from '../config';
import { errorMessage } from '../util';
import { BackgroundTracker } from './backgroundTasks';
import { browserTools, type BrowserPool } from './browserTool';
import { agentEnv, DECLINED, sessionHooks, UNANSWERED } from './claudeSession';
import { type CommonContext, handleCommonEvent, newCommonContext } from './commonEvents';
import type { AskedQuestion } from './questions';
import { atTurnEnd, HOST_AUTONOMY, isSdkMessage, joining, type Reaction, reaction } from './hostRunnerRules';
import { pushGuardEnv, refusedFile, writePushHooks } from './pushGuard';
import { OPS_INSTRUCTIONS, opsTools } from './opsTool';
import { openScratch, type Scratch } from './scratch';
import { handleMessage, type RunContext, type TurnResult } from './sdkMessages';
import type { AgentRunner, AgentSession, RunHooks, RunOutcome, RunRequest, SessionExtras } from './types';
import { sessionEnv } from './wait';
import { WorkflowPermits, workflowAsk } from './workflows';

// Developer sessions on agent-host (jonhilt/agent-host): the host keeps each agent's conversation with Claude Code (a
// journal of its own, resuming a turn a restart cut off, holding at your plan's usage limit), and this runner maps
// Focus's turns onto it, on Claude Code or Codex as the developer was hired to run. Each Focus turn watches the conversation until the turn ends; Claude Code's own messages ride
// along on the host's events, so they're rendered exactly as the old runner renders them (`handleMessage`); a Codex
// developer's are rendered from the common events (`handleCommonEvent`).

/** agent-host's own folder: its journal, and the Claude Code config folder its sessions run under (you sign in there once). */
export const HOST_DIR = path.join(os.homedir(), '.agent-host');
export const HOST_CLAUDE_DIR = path.join(HOST_DIR, 'claude');
/** The Codex home its Codex sessions run under (you sign in there once, with `codex login`). */
export const HOST_CODEX_DIR = path.join(HOST_DIR, 'codex');

/**
 * Claude Code's tools for reaching other sessions, which a lead doesn't get: work moves between goals only through the
 * chief of staff, so a lead raises work that belongs elsewhere at the end of its turn rather than passing it on, where
 * nothing would record who it came from (a lead once sent a build straight into another's session).
 */
export const PEER_TOOLS = ['ListAgents', 'SendMessage', 'TeamCreate', 'TeamDelete'];

/**
 * Claude Code's own tools a session may not use: a lead asks the user with AskUserQuestion, and no one plans in Claude
 * Code's own plan mode. Lent on every open too, so a conversation started before a tool was taken away loses it.
 */
const disallowed = (lead: boolean): string[] => (lead ? ['EnterPlanMode', ...PEER_TOOLS] : ['AskUserQuestion', 'EnterPlanMode']);

/** The label a conversation is found by: the Focus agent whose it is. */
const AGENT_LABEL = 'focusAgent';

/** What the runner holds for an agent: its scratch dir, and the hooks of the turn watching it now. */
interface Lending {
  scratch: Scratch;
  hooks?: RunHooks;
  extras?: SessionExtras;
}

export class HostRunner implements AgentRunner {
  private readonly runtime: ManagedRuntime.ManagedRuntime<Host | Journal, never>;
  private readonly lendings = new Map<string, Lending>();
  /** Which Focus agent each conversation is, by the host's id. */
  private readonly agentOf = new Map<string, string>();
  private closing = false;

  /** A lead's extras for a conversation the host resumes before any turn of theirs (the manager's, once it's up). */
  extrasFor?: (agentId: string) => SessionExtras | undefined;

  constructor(
    private readonly browsers: BrowserPool,
    claude: Adapter = makeClaudeAdapter({ configDir: HOST_CLAUDE_DIR, env: agentEnv(false), extend: (id, labels) => this.extend(id, labels) }),
    journalPath = path.join(HOST_DIR, 'journal.sqlite'),
    codex: Adapter = makeCodexAdapter({ codexHome: HOST_CODEX_DIR, env: agentEnv(false) }),
  ) {
    const host = Host.layer({ adapters: { claude, codex }, lend: (c) => this.lend(c.id, c.labels[AGENT_LABEL], c.agent === 'codex') });
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
  opened(agentId: string, hooks: RunHooks, extras: SessionExtras): Lending {
    this.lendings.get(agentId)?.scratch.close();
    const lending = { scratch: openScratch(agentId, paths.dcgConfig), hooks, extras };
    this.lendings.set(agentId, lending);
    return lending;
  }

  /** The turn's over: its scratch dir goes, as the old runner's does. */
  closed(agentId: string, lending: Lending): void {
    if (this.lendings.get(agentId) !== lending) return;
    lending.scratch.close();
    lending.hooks = undefined;
    // the browser goes with the session, as it always has
    void this.browsers.close(agentId);
  }

  remember(conversationId: string, agentId: string): void {
    this.agentOf.set(conversationId, agentId);
  }

  /** What an agent's sessions are lent: the browser, and the scratch dir's environment (focus-wait, bash, dcg) with the push guard's. */
  lent(agentId: string, codex = false): Lent {
    const lending = this.lendings.get(agentId) ?? { scratch: openScratch(agentId, paths.dcgConfig) };
    this.lendings.set(agentId, lending);
    const hooks = (): Pick<RunHooks, 'browser' | 'screenshot'> => lending.hooks ?? { browser: () => undefined, screenshot: () => undefined };
    // a lead's office tools too
    const office = lending.extras?.tools;
    const tools: Tool[] = [...browserTools(this.browsers, agentId, hooks), ...(office ? opsTools(office) : [])];
    // its git runs Ops' hooks, which refuse a lead's harmful pushes and hand on to the repo's own
    writePushHooks(paths.gitHooks);
    const base = agentEnv(false);
    // Claude Code's own tools it may not use as they are now, in place of those its conversation started with (Codex's
    // can't be switched off one by one)
    return { tools, env: definedOnly(sessionEnv(base, { ...lending.scratch.env, ...pushGuardEnv(paths.gitHooks, refusedFile(agentId), base) })), disallowedTools: codex ? [] : disallowed(!!office) };
  }

  /**
   * The host opening a conversation Focus didn't start in this run (one it resumes after a restart): a lead's extras
   * come from the manager (`extrasFor`), since no turn of theirs has brought them yet.
   */
  private lend(conversationId: string, agentId: string | undefined, codex: boolean): Lent {
    if (!agentId) return {};
    this.remember(conversationId, agentId);
    const lending = this.lendings.get(agentId) ?? { scratch: openScratch(agentId, paths.dcgConfig) };
    lending.extras ??= this.extrasFor?.(agentId);
    this.lendings.set(agentId, lending);
    return this.lent(agentId, codex);
  }

  /**
   * Claude Code's own extras: the scratch dir's guard on Bash (and the push guard's), before it runs; and a lead's brief
   * hooks, their questions' pages in HTML, and their helpers' progress in a line. A lead's brief is looked up as each
   * hook runs, so it's always their latest turn's.
   */
  extend(conversationId: string, labels: Record<string, string>): ReturnType<NonNullable<ClaudeAdapterOptions['extend']>> {
    // whose it is from its labels: a conversation's first session opens before `start` gives Focus its id
    const agentId = labels[AGENT_LABEL] ?? this.agentOf.get(conversationId);
    const lending = agentId ? this.lendings.get(agentId) : undefined;
    if (!agentId || !lending) return {};
    const extras = lending.extras;
    const latest = () => this.lendings.get(agentId)?.extras?.brief;
    const brief = extras?.brief && { edited: () => latest()?.edited(), afterCompact: () => latest()?.afterCompact() ?? '' };
    return {
      hooks: sessionHooks({ cwd: extras?.cwd ?? '', brief }, lending.scratch.hook),
      ...(extras?.tools && { agentProgressSummaries: true, toolConfig: { askUserQuestion: { previewFormat: 'html' } } }),
    };
  }
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
  private readonly common: CommonContext;
  private watching?: Fiber.Fiber<void, unknown>;
  /**
   * Messages on their way to the host; the turns a message Focus sent started of its own (`Delivery`), each this Focus
   * turn watches on through; and the host's turn end heard while a message might still start one (`atTurnEnd`).
   */
  private sending = 0;
  private started = 0;
  private ending?: RunOutcome;
  private resolve?: (o: RunOutcome) => void;

  constructor(
    private readonly runner: HostRunner,
    private readonly req: RunRequest,
    private readonly hooks: RunHooks,
  ) {
    this.ctx = { cwd: req.cwd, calls: new Map(), helpers: new Map(), workflows: new Set(), permits: new WorkflowPermits(), parents: new Map(), modelled: new Set(), probes: new Set(), commits: new Map(), onKey: false, counted: new Set() };
    this.common = newCommonContext(req.cwd);
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
      stopTask: (taskId) => this.stopTask(taskId),
      stop: () => this.stop(),
      done,
    };
  }

  private async run(): Promise<RunOutcome> {
    const lending = this.runner.opened(this.req.agentId, this.hooks, { cwd: this.req.cwd, tools: this.req.tools, brief: this.req.brief });
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
        const codex = this.req.agent === 'codex';
        if (plan.resumes && !codex) copyTranscript(plan.resumes);
        id = yield* host.start(
          {
            agent: codex ? 'codex' : 'claude',
            model: codex ? (this.req.settings.codexModel ?? '') : this.req.model || this.req.settings.model || 'opus',
            ...(this.req.effort && { effort: this.req.effort }),
            folder: this.req.cwd,
            labels: { [AGENT_LABEL]: agentId },
            autonomy: HOST_AUTONOMY[this.req.autonomy],
            loadOwnerSettings: this.req.settings.userClaudeMd,
            allowApiKeyFallback: false,
            firstMessage: this.req.prompt,
            // what Ops is, as the old runner's office server told Claude Code: the host's tools carry no instructions
            systemAppend: this.req.tools ? `${this.req.systemAppend}\n\n${OPS_INSTRUCTIONS}` : this.req.systemAppend,
            // Claude Code's own: Codex's can't be switched off one by one
            disallowedTools: codex ? [] : disallowed(!!this.req.tools),
            ...(this.req.outputSchema && { outputSchema: this.req.outputSchema }),
            ...(plan.resumes && { resumeAgentSession: plan.resumes }),
          },
          this.runner.lent(agentId, codex),
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
      if (plan.kind === 'send') yield* host.send(id, this.req.prompt, { ...(this.effort && { effort: this.effort }), ...(this.req.outputSchema && { outputSchema: this.req.outputSchema }) });
      for (const text of this.early.splice(0)) if ((yield* host.send(id, text)) === 'started') this.started++;
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
    this.sending++;
    void this.runner
      .run(Host.use((h) => h.send(id, text, effort ? { effort } : {})))
      .then((delivery) => void (delivery === 'started' && this.started++), () => undefined)
      .finally(() => {
        this.sending--;
        this.settleEnd();
      });
    return true;
  }

  /** Stops one of its background commands or monitors; the turn goes on. False when the host has nothing of it running. */
  private stopTask(taskId: string): Promise<boolean> {
    const id = this.conversation;
    if (!id || this.over) return Promise.resolve(false);
    return this.runner.run(Host.use((h) => h.stopBackground(id, taskId))).then(
      () => true,
      () => false,
    );
  }

  /**
   * A lead's question, put to the user on their station's screen; the first answer wins, from anyone watching. Unanswered
   * (the turn's over, or they were stopped), the lead hears so; unreadable, they're told how to ask again.
   */
  private async question(requestId: string, questions: AskedQuestion[] | undefined): Promise<void> {
    const controller = new AbortController();
    this.asks.set(requestId, controller);
    const answers = questions && (await this.hooks.question({ questions }, controller.signal));
    if (controller.signal.aborted && !answers) return;
    const answer = answers ? { _tag: 'Answers' as const, answers } : { _tag: 'Declined' as const, reason: questions ? UNANSWERED : UNREADABLE_QUESTIONS };
    await this.runner.run(Host.use((h) => h.answer(requestId, answer))).catch(() => undefined);
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
      if (item._tag !== 'Journaled') return;
      if (this.req.agent === 'codex') {
        handleCommonEvent(item.event, this.common, this.hooks);
        this.result = this.common.result;
      }
      this.onEvent(item.event, resolve);
    });
  }

  /**
   * The host's turn has ended (`ending`): this Focus turn's over, unless a message it sent started a turn of its own,
   * which it then watches to its end; while a message is on its way, it waits to hear where it went (`atTurnEnd`).
   */
  private settleEnd(): void {
    if (!this.ending || !this.resolve) return;
    const next = atTurnEnd(this.sending, this.started);
    if (next === 'wait') return;
    const outcome = this.ending;
    this.ending = undefined;
    if (next === 'carry-on') {
      this.started--;
      return;
    }
    // nothing more is taken once the turn's over, though `run` hears so a moment later
    this.over = true;
    this.resolve(outcome);
  }

  private onEvent(event: ConversationEvent, resolve: (o: RunOutcome) => void): void {
    const r = reaction(event, this.result, this.req.outputSchema !== undefined);
    switch (r.kind) {
      case 'ask':
        return void this.ask(r);
      case 'question':
        return void this.question(r.requestId, r.questions);
      case 'resolved':
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
        this.resolve = resolve;
        this.ending = r.outcome;
        return this.settleEnd();
      case 'answered': {
        resolve(r.outcome);
        const id = this.conversation;
        if (id) void this.runner.run(Host.use((h) => h.interrupt(id))).catch(() => undefined);
        return;
      }
    }
  }

  /**
   * A raised hand, put to the manager as the old runner's are; the first answer wins, from anyone watching. A helper of a
   * workflow the manager approved goes ahead without asking, and approving a Workflow call (asked about by what that
   * means) approves its helpers.
   */
  private async ask({ requestId, tool, input, summary: line, agentId, toolUseId }: Extract<Reaction, { kind: 'ask' }>): Promise<void> {
    const summary = tool === 'Workflow' ? workflowAsk(input) : line;
    const controller = new AbortController();
    this.asks.set(requestId, controller);
    const permits = this.ctx.permits;
    const approved = (await permits?.approvesSoon(agentId)) || (!controller.signal.aborted && (await this.hooks.permission(tool, summary, controller.signal)));
    if (controller.signal.aborted) return;
    if (approved && tool === 'Workflow' && toolUseId) permits?.approveCall(toolUseId);
    const answer = approved ? { _tag: 'AllowOnce' as const } : { _tag: 'Deny' as const, message: DECLINED };
    await this.runner.run(Host.use((h) => h.answer(requestId, answer))).catch(() => undefined);
  }
}

/** What a lead hears when Claude Code's AskUserQuestion input can't be read. */
const UNREADABLE_QUESTIONS = 'Ops couldn’t read the questions: ask again with 1–4 questions of 2–4 options each.';

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

