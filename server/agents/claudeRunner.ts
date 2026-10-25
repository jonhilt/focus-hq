import { homedir } from 'node:os';
import { join } from 'node:path';
import { query, type CanUseTool, type Options, type PermissionMode, type PermissionResult, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { clock } from '../../shared/clock';
import type { Autonomy } from '../../shared/types';
import { paths } from '../config';
import { errorMessage, sleep, truncate } from '../util';
import { keyFallback } from './apiKey';
import { BrowserPool, browserMcpServer } from './browserTool';
import { CLOUD_UNAVAILABLE, cloudRefused } from './cloud';
import { opsMcpServer } from './opsTool';
import { openScratch } from './scratch';
import { askedQuestions } from './questions';
import { pushGuardEnv, refusedFile, writePushHooks } from './pushGuard';
import { sessionEnv } from './wait';
import { handleMessage, type RunContext, type TurnResult } from './sdkMessages';
import { WorkflowPermits, workflowAsk } from './workflows';
import { BackgroundTracker } from './backgroundTasks';
import { bundledClaude, openTerminal, readTerminal } from './terminal';
import { type AgentRunner, type AgentSession, type CloudTerminal, type CloudTerminalRequest, type RunHooks, type RunOutcome, type RunRequest, LIMIT_REACHED, STOPPED_BY_CAPTAIN } from './types';
import { withoutSecrets } from '../secrets';

/** Feeds user messages into a streaming-input query; lets the manager talk to a running agent. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  closed = false;

  push(text: string): boolean {
    if (this.closed) return false;
    const item: SDKUserMessage = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
    return true;
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/**
 * Whether the session should keep listening after its turn, for these background tasks (their task types): while
 * anything runs in the background (a workflow, a subagent, a command or a monitor), Claude Code keeps the session going
 * and takes its result in a turn of its own when it ends, so a message sent meanwhile should reach it then and there,
 * and the captain can stop a command (a stop only reaches a session that's still listening).
 */
export function holdsInput(background: string[]): boolean {
  return background.length > 0;
}

/**
 * What runs in the background, by kind: what Claude Code last listed, and any workflow Ops has seen start and
 * not end. A workflow's agents ask Ops for approval as the lead's own tools do, so the input mustn't close
 * under them even if a list leaves the workflow out (a run's agents were all refused at once, a minute after their own
 * background commands ended).
 */
export function runningInBackground(listed: string[], workflows: number): string[] {
  return workflows > 0 && !listed.includes('local_workflow') ? [...listed, 'local_workflow'] : listed;
}

/**
 * Whether a message from Claude Code shows it has read what Ops sent before it: something it says in a turn.
 * What it reports whatever it has read (the background list, a task's start, end or progress, `init`) doesn't, nor
 * does a turn's result (a message sent as the turn ends isn't in its count).
 */
export const showsHeard = (msg: { type: string }): boolean => msg.type === 'assistant';

/**
 * Whether a turn's result ends a session asked for an answer (`expects`, QA's report): the answer's in and nothing
 * waits for another turn. Nothing it left in the background matters then. On jonhilt/ops#35 a QA officer's `docker
 * build` hung in the background, so after the report the session kept listening for it forever and the review stayed
 * under test (jonhilt/focus#629).
 */
export function answerEnds(expects: boolean, result: Pick<TurnResult, 'isError' | 'queued' | 'structured'>): boolean {
  return expects && !result.isError && result.queued === 0 && result.structured !== undefined;
}

/** How long a session that's done waits, once its last background task ends, for the turn that takes its result. */
export const REPORT_TURN_GRACE_MS = 60_000;

/**
 * When the session's done listening (its input closes): once its turn is over with nothing queued and nothing running
 * in the background. When the last background task ends, Claude Code takes its result in a turn of its own, and that
 * turn needs Ops as much as any other (to approve a tool, or for Ops' own tools): closing the input as
 * the task ended left it no one to ask, and Claude Code cancelled each such tool with "The user doesn't want to take
 * this action right now". So the input stays open for that turn, and closes when it's over; if no turn comes, it
 * closes after `graceMs`, saying so (`waited`), since a session still at work would lose its approvals from then on.
 */
export class Listening {
  private turnOver = false;
  private background: string[] = [];
  private grace?: ReturnType<typeof setTimeout>;
  /** A message went in after the last thing Claude Code said: it may not have read it before ending its turn. */
  private unheard = false;

  constructor(
    private readonly close: (waited: boolean) => void,
    private readonly graceMs = REPORT_TURN_GRACE_MS,
  ) {}

  /** A turn has started: Claude Code's own, to take a background task's result, or one for a message. */
  turnStarted(): void {
    this.turnOver = false;
    this.cancelGrace();
  }

  /** Ops sent the session a message. */
  messageSent(): void {
    this.unheard = true;
  }

  /** Claude Code said something in a turn (`showsHeard`): whatever went in before it, it has read. */
  heard(): void {
    this.unheard = false;
  }

  /**
   * A turn has ended, with `queued` messages still to take. A message sent as the turn ended isn't counted in
   * `queued` (it was still on its way), yet Claude Code takes it in a turn of its own: closing the input then left that
   * turn nobody listening. So with a message unheard, it waits for that turn, closing after `graceMs` if none comes.
   */
  turnEnded(queued: boolean): void {
    this.turnOver = !queued;
    if (!this.turnOver || holdsInput(this.background)) return;
    if (!this.unheard) return this.close(false);
    this.cancelGrace();
    this.grace = setTimeout(() => {
      this.grace = undefined;
      if (this.turnOver && !holdsInput(this.background)) this.close(false);
    }, this.graceMs);
  }

  /** What runs in the background (by kind), as it stands after a message: it only matters when it changes. */
  backgroundChanged(background: string[]): void {
    const ended = holdsInput(this.background) && !holdsInput(background);
    this.background = background;
    if (!ended || !this.turnOver) return;
    this.cancelGrace();
    this.grace = setTimeout(() => {
      this.grace = undefined;
      if (this.turnOver && !holdsInput(this.background)) this.close(true);
    }, this.graceMs);
  }

  dispose(): void {
    this.cancelGrace();
  }

  private cancelGrace(): void {
    clearTimeout(this.grace);
    this.grace = undefined;
  }
}

/**
 * In "ask" mode these never make an agent raise its hand. Not a sandbox: it only cuts down on interruptions.
 * Plain tools are approved in canUseTool (bare names in allowedTools would bypass the callback entirely);
 * shell commands are matched by Claude Code's own Bash(prefix:*) rules.
 */
const ASK_MODE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'TodoWrite', 'Task', 'Agent', 'WebSearch', 'WebFetch']);
const ASK_MODE_COMMANDS = [
  ...['status', 'diff', 'add', 'commit', 'log', 'show', 'checkout', 'switch', 'restore', 'stash', 'branch', 'mv', 'rm', 'grep', 'blame']
    .map((sub) => `Bash(git ${sub}:*)`),
  ...['npm', 'npx', 'pnpm', 'yarn', 'bun', 'node', 'deno', 'tsc', 'vite', 'vitest', 'jest', 'eslint', 'prettier',
    'python', 'python3', 'pip', 'pytest', 'uv', 'poetry', 'ruff', 'cargo', 'go', 'dotnet', 'make', 'mvn', 'gradle', './gradlew',
    'ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'rg', 'mkdir', 'touch', 'echo', 'pwd', 'which', 'sort', 'diff', 'curl', 'sleep', 'lsof']
    .map((cmd) => `Bash(${cmd}:*)`),
];

/** Claude Code's permission mode for each of Focus's. */
export const PERMISSION_MODE: Record<Autonomy, PermissionMode> = { ask: 'acceptEdits', auto: 'auto', full: 'bypassPermissions' };

/** A tool the session may use without asking in a mode, before Claude Code's own rules or the captain are asked. */
export function allowedWithoutAsking(autonomy: Autonomy, toolName: string): boolean {
  return autonomy === 'full' || (autonomy === 'ask' && (ASK_MODE_TOOLS.has(toolName) || toolName.startsWith('mcp__browser__')));
}

/**
 * The SDK options for a session's permissions. A cloud session's are fixed for its turn. A local one is set up to switch
 * to any mode while it runs (`Query.setPermissionMode`): bypassing permissions has to be allowed from the start, and it
 * carries ask mode's command rules whatever mode it starts in (in auto mode they only spare the classifier a few calls).
 */
export function permissionOptions(autonomy: Autonomy, cloud: boolean, askCommands: string[], canUseTool: CanUseTool): Partial<Options> {
  if (!cloud) return { permissionMode: PERMISSION_MODE[autonomy], allowDangerouslySkipPermissions: true, allowedTools: askCommands, canUseTool };
  if (autonomy === 'full') return { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true };
  return autonomy === 'auto' ? { permissionMode: 'auto', canUseTool } : { permissionMode: 'acceptEdits', allowedTools: askCommands, canUseTool };
}

/** What the captain's asked to approve: a workflow by name, else Claude Code's own title for it, else the tool and what it's on. */
export function permissionAsk(toolName: string, input: Record<string, unknown>, title?: string): string {
  if (toolName === 'Workflow') return workflowAsk(input);
  return title || summarizeInput(toolName, input);
}

function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash') return `Bash(${truncate(String(input.command ?? ''), 300)})`;
  const first = input.file_path ?? input.url ?? input.pattern ?? Object.values(input)[0];
  return `${toolName}(${truncate(typeof first === 'string' ? first : JSON.stringify(first ?? ''), 300)})`;
}

/** What an agent hears when the captain declines its tool call. */
export const DECLINED = 'The manager declined this action. Find another approach, or explain in your final summary why it is needed.';

/** What a lead hears when their question went unanswered (their turn ended, or they were stopped). */
export const UNANSWERED = 'The captain didn’t answer before your turn ended, so your question has come down from your station’s screen: ask again if it still matters.';

/** How long a helper's request waits for a workflow's progress to name it: 10 looks, 200 ms apart. */
const PERMIT_LOOKS = 10;
const PERMIT_WAIT_MS = 200;

/**
 * A session's canUseTool: a tool its mode lets through runs, as does a request from an agent of a workflow the captain
 * approved (given a moment for the workflow's progress to name it); anything else asks the captain, and approving a
 * Workflow call approves its agents too. `autonomy` is read on each call, since the captain can change it mid-session.
 */
export function toolPermission(
  autonomy: () => Autonomy,
  permits: WorkflowPermits,
  ask: RunHooks['permission'],
  question: RunHooks['question'],
  wait: (ms: number) => Promise<unknown> = sleep,
): (...args: Parameters<CanUseTool>) => Promise<PermissionResult> {
  return async (toolName, toolInput, { signal, title, agentID, toolUseID }) => {
    // Claude Code's question for the user isn't an approval: whatever the mode, it waits for their answers
    if (toolName === 'AskUserQuestion') {
      const questions = askedQuestions(toolInput);
      const answers = questions && (await question({ questions }, signal));
      return answers ? { behavior: 'allow', updatedInput: { ...toolInput, answers } } : { behavior: 'deny', message: questions ? UNANSWERED : 'Ops couldn’t read the questions: ask again with 1–4 questions of 2–4 options each.' };
    }
    if (allowedWithoutAsking(autonomy(), toolName)) return { behavior: 'allow', updatedInput: toolInput };
    for (let i = 0; i < PERMIT_LOOKS && permits.mightApprove(agentID); i++) await wait(PERMIT_WAIT_MS);
    if (permits.approves(agentID)) return { behavior: 'allow', updatedInput: toolInput };
    const approved = await ask(toolName, permissionAsk(toolName, toolInput, title), signal);
    if (approved && toolName === 'Workflow') permits.approveCall(toolUseID);
    return approved ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message: DECLINED };
  };
}

/**
 * The environment every Claude Code session gets. Agents run on your Claude login, not on an API key that happens to
 * be in the environment, unless Focus says the key's in use (`keyFallback`): always, or while your plan's usage
 * limit is reached. Focus's own secrets (the bot's token, say) are left out (`withoutSecrets`).
 */
export function agentEnv(onKey = keyFallback.onKey()): Record<string, string | undefined> {
  // Claude Code's task tools (TaskCreate, TaskUpdate, TaskList): on newer models a session only has them when asked
  // for, which the SDK's docs advise when the app reads them, as Focus does: it follows each agent's task list
  // (`tasks.ts`), and draws a lead's on its goal's chart
  const env: Record<string, string | undefined> = { ...withoutSecrets(), CLAUDE_AGENT_SDK_CLIENT_APP: 'focus/0.1.0', CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' };
  if (!onKey) delete env.ANTHROPIC_API_KEY;
  return env;
}

/**
 * The settings files and CLAUDE.md files a session loads. Without your own CLAUDE.md, only it and your rules are
 * excluded, so your ~/.claude/settings.json (permissions, env, plugins) still applies; anything they import goes too.
 */
export function claudeConfig(userClaudeMd: boolean, configDir: string): Pick<Options, 'settingSources' | 'settings'> {
  const settingSources: Options['settingSources'] = ['user', 'project', 'local'];
  if (userClaudeMd) return { settingSources };
  return { settingSources, settings: { claudeMdExcludes: [join(configDir, 'CLAUDE.md'), join(configDir, 'rules', '**')] } };
}

/** How full the session's context window is, from Claude Code's own count (its last response's usage, no extra calls). */
async function reportContext(q: Query, hooks: RunHooks): Promise<void> {
  try {
    const usage = await Promise.race([q.getContextUsage({ detail: 'summary' }), sleep(3000).then(() => null)]);
    if (usage) hooks.context?.({ percent: Math.round(usage.percentage), tokens: usage.totalTokens, max: usage.rawMaxTokens });
  } catch {
    // an older CLI, or a session already winding down: the meter keeps its last reading
  }
}

/**
 * Runs agents with the Claude Agent SDK, i.e. real Claude Code instances using your local Claude login. A cloud agent
 * runs through the bundled CLI's headless `--cloud` mode: the CLI starts (or reattaches to) a Claude Code cloud session
 * and relays it in the same message stream, so it renders like a local one.
 */
/** What a session has come to so far: its last turn's result, and whether Claude Code reported the session. */
export interface SoFar {
  ok: boolean;
  summary: string;
  structured?: unknown;
  error?: string;
  started: boolean;
}

/** `so` with a turn's result taken in: the session comes to its last turn's result, keeping the structured answer from before when this turn gave none. */
export function withResult(so: SoFar, result: TurnResult): SoFar {
  return { ...so, ok: !result.isError, summary: result.text, structured: result.structured ?? so.structured, error: result.isError ? result.text : undefined };
}

/** What stopped a session other than its own messages: the captain sending them home, or your plan's usage limit. */
export interface Interruptions {
  stopping: boolean;
  limited: boolean;
}

/** What a session comes to once its messages run out: the captain's stop first, then the usage limit, else its last turn's result. */
export function endedOutcome(so: SoFar, { stopping, limited }: Interruptions): RunOutcome {
  const { summary, started } = so;
  if (stopping) return { ok: false, summary, error: STOPPED_BY_CAPTAIN, aborted: true, started };
  if (limited) return { ok: false, summary, error: LIMIT_REACHED, limited: true, started };
  return { ok: so.ok, summary, structured: so.structured, error: so.error, started };
}

/**
 * What a session comes to when Claude Code throws: the usage limit (unless the captain stopped them), a stop or abort,
 * a cloud session the server refused, or else the error with the last three lines Claude Code wrote to stderr.
 */
export function failedOutcome(
  so: SoFar,
  err: unknown,
  { stopping, limited, aborted, cloud, stderr }: Interruptions & { aborted: boolean; cloud: boolean; stderr: string },
): RunOutcome {
  const { summary, started } = so;
  if (limited && !stopping) return { ok: false, summary, error: LIMIT_REACHED, limited: true, started };
  if (stopping || aborted) return { ok: false, summary, error: STOPPED_BY_CAPTAIN, aborted: true, started };
  if (cloud && cloudRefused(`${errorMessage(err)}\n${stderr}`)) return { ok: false, summary, error: CLOUD_UNAVAILABLE, started };
  const detail = stderr.trim().split('\n').slice(-3).join(' ');
  return { ok: false, summary, error: `${errorMessage(err)}${detail ? ` — ${truncate(detail, 300)}` : ''}`, started };
}

export class ClaudeRunner implements AgentRunner {
  constructor(
    private readonly browsers: BrowserPool,
    /** The captain's command for opening a terminal (Settings, or FOCUS_TERMINAL), as it is now. */
    private readonly terminal: () => string | undefined = () => process.env.FOCUS_TERMINAL,
  ) {}

  /**
   * A terminal running `claude --cloud`: Claude Code starts a new cloud session only from a terminal. On macOS and
   * Linux `script` records what it shows, where the session's id turns up; on Windows the captain pastes the link.
   */
  async cloudTerminal(req: CloudTerminalRequest): Promise<CloudTerminal> {
    const dir = join(paths.cloudTerminals, req.agentId);
    const log = process.platform === 'win32' ? undefined : join(dir, 'terminal.log');
    await openTerminal(dir, { cwd: req.cwd, claude: bundledClaude(), description: req.description, agentName: req.agentName, log }, this.terminal());
    return { read: () => (log ? readTerminal(log) : Promise.resolve(undefined)) };
  }

  start(req: RunRequest, hooks: RunHooks): AgentSession {
    const input = new InputQueue();
    const abort = new AbortController();
    const cloud = req.cloud;
    // A new cloud session gets its instructions in the first message: which local options reach it is up to the CLI.
    input.push(cloud && !req.resumeSessionId ? `${req.systemAppend}\n\n---\n\n${req.prompt}` : req.prompt);

    // the captain can change it while the session runs (`setAutonomy`)
    let autonomy = req.autonomy;
    // a cloud agent has to push its own branch, and only that one
    const askCommands = cloud ? [...ASK_MODE_COMMANDS, `Bash(git push origin HEAD:${cloud.branch})`] : ASK_MODE_COMMANDS;
    const permits = new WorkflowPermits();
    const canUseTool = toolPermission(() => autonomy, permits, (tool, summary, signal) => hooks.permission(tool, summary, signal), (input, signal) => hooks.question(input, signal));

    // a cloud session runs on your plan in the cloud, whatever this machine signs in with
    const onKey = !cloud && keyFallback.onKey();
    hooks.signIn?.(onKey);
    // a local session's scratch dir for throwaway files, deleted when the run ends, and Focus's focus-wait on its
    // PATH; a cloud session has its own machine
    const scratch = cloud ? undefined : openScratch(req.agentId, paths.dcgConfig);
    const base = agentEnv(onKey);
    // its git runs Ops' hooks, which refuse a lead's harmful pushes and hand on to the repo's own
    if (scratch) writePushHooks(paths.gitHooks);
    const env = sessionEnv(base, scratch && { ...scratch.env, ...pushGuardEnv(paths.gitHooks, refusedFile(req.agentId), base) });
    const resets = keyFallback.resetsAt();
    if (onKey && resets) hooks.lines([{ kind: 'system', text: `✻ On your API key: your plan's usage limit is reached until ${clock(resets)}` }]);

    const stderrTail: string[] = [];
    const options: Options = {
      cwd: req.cwd,
      abortController: abort,
      model: req.model || req.settings.model || undefined,
      effort: req.effort,
      ...claudeConfig(req.settings.userClaudeMd, process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')),
      // a goal's lead (the one with Ops' tools) asks the user with Claude Code's own questions, drawn on their station's
      // screen, each option's preview a page; everyone else works on their own
      disallowedTools: req.tools ? ['EnterPlanMode'] : ['AskUserQuestion', 'EnterPlanMode'],
      ...(req.tools && { toolConfig: { askUserQuestion: { previewFormat: 'html' } } }),
      ...(cloud
        ? // the cloud VM has its own browser; ours runs on this machine. `--cloud <id>` reattaches to the session.
          { systemPrompt: { type: 'preset', preset: 'claude_code' }, extraArgs: { cloud: req.resumeSessionId ?? null } }
        : {
            // recorded on the first request and reused on every resume (the SDK's default, spelled out): instructions
            // that change mid-session would be ignored, so whatever changes goes in messages instead
            systemPrompt: { type: 'preset', preset: 'claude_code', append: req.systemAppend, snapshot: true },
            mcpServers: { browser: browserMcpServer(this.browsers, req.agentId, hooks), ...(req.tools && { office: opsMcpServer(req.tools) }) },
            resume: req.resumeSessionId,
            // the scratch dir's guard on Bash (and the push guard's), before it runs
            hooks: scratch?.hook && { PreToolUse: [{ matcher: 'Bash', hooks: [scratch.hook] }] },
          }),
      outputFormat: req.outputSchema ? { type: 'json_schema', schema: req.outputSchema } : undefined,
      // the lead's helpers sit round their team station: a line every ~30s on what each is doing, for their speech bubbles
      agentProgressSummaries: !!req.tools,
      env,
      stderr: (data) => {
        stderrTail.push(data);
        if (stderrTail.length > 20) stderrTail.shift();
      },
      ...permissionOptions(autonomy, !!cloud, askCommands, canUseTool),
    };

    let q: Query | undefined;
    let stopping = false;
    const ctx: RunContext = { cwd: req.cwd, cloud: !!cloud, calls: new Map(), helpers: new Map(), workflows: new Set(), permits, parents: new Map(), modelled: new Set(), scratch: scratch?.dir, probes: new Set(), commits: new Map(), onKey, counted: new Set() };
    // a background task still running keeps listening, so a message from the captain reaches the session now
    const listening = new Listening((waited) => {
      if (waited) hooks.lines([{ kind: 'system', text: `✻ Stopped listening: no turn came ${REPORT_TURN_GRACE_MS / 1000}s after the last background task ended` }]);
      input.close();
    });
    ctx.tracker = new BackgroundTracker((id) => (id ? ctx.calls.get(id)?.name : undefined));
    const done = (async (): Promise<RunOutcome> => {
      let so: SoFar = { ok: false, summary: '', started: false };
      try {
        q = query({ prompt: input, options });
        for await (const msg of q) {
          if (msg.type === 'system' && msg.subtype === 'init') so = { ...so, started: true };
          if (msg.type === 'assistant' || (msg.type === 'system' && msg.subtype === 'init')) listening.turnStarted();
          if (showsHeard(msg)) listening.heard();
          const result = this.handle(msg, ctx, hooks);
          listening.backgroundChanged(runningInBackground(ctx.background ?? [], ctx.workflows.size));
          if (ctx.limited && !abort.signal.aborted) {
            abort.abort();
            input.close();
          }
          if (result) {
            so = withResult(so, result);
            // how full the context is now, asked while the session's still there to answer
            if (!cloud) await reportContext(q, hooks);
            // leaving the stream ends the session, and whatever it still runs in the background with it
            if (answerEnds(!!req.outputSchema, result)) break;
            // Messages sent mid-turn are folded into that turn, so don't count results per message: finish once the
            // CLI has nothing queued. Anything still in our queue is delivered before the input reports it is done.
            listening.turnEnded(result.queued > 0);
          }
        }
        return endedOutcome(so, { stopping, limited: !!ctx.limited });
      } catch (err) {
        return failedOutcome(so, err, { stopping, limited: !!ctx.limited, aborted: abort.signal.aborted, cloud: !!cloud, stderr: stderrTail.join('') });
      } finally {
        listening.dispose();
        input.close();
        scratch?.close();
        await this.browsers.close(req.agentId);
      }
    })();

    const kill = () => {
      abort.abort();
      input.close();
    };
    return {
      send: (text) => {
        const sent = input.push(text);
        if (sent) listening.messageSent();
        return sent;
      },
      // a stop only reaches a session that's still listening (its input open)
      stopTask: async (taskId) => {
        if (!q || input.closed) return false;
        await q.stopTask(taskId);
        return true;
      },
      // a cloud session's settings live in the cloud: its new effort applies from its next turn
      setEffort: (effort) => {
        if (!cloud) void q?.applyFlagSettings({ effortLevel: effort }).catch(() => undefined);
      },
      // a cloud session's permissions are set as its turn starts: its new mode applies from its next turn
      setAutonomy: (mode) => {
        if (cloud) return false;
        autonomy = mode;
        void q?.setPermissionMode(PERMISSION_MODE[mode]).catch(() => undefined);
        return true;
      },
      stop: () => {
        stopping = true;
        // Killing the local client alone would leave a cloud session working: interrupt its turn first.
        if (cloud && q) void Promise.race([q.interrupt(), sleep(5000)]).catch(() => undefined).finally(kill);
        else kill();
      },
      done,
    };
  }

  /** Renders one SDK message; returns the outcome when it is a turn result. */
  private handle(msg: SDKMessage, ctx: RunContext, hooks: RunHooks): TurnResult | null {
    return handleMessage(msg, ctx, hooks);
  }
}
