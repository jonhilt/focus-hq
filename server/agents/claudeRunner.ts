import { homedir } from 'node:os';
import { join } from 'node:path';
import { query, type CanUseTool, type Options, type PermissionMode, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { clock } from '../../shared/clock';
import type { Autonomy } from '../../shared/types';
import { paths } from '../config';
import { errorMessage, sleep, truncate } from '../util';
import { keyFallback } from './apiKey';
import { BrowserPool, browserMcpServer } from './browserTool';
import { sessionHooks } from './checklist';
import { CLOUD_UNAVAILABLE, cloudRefused } from './cloud';
import { officeMcpServer } from './officeTool';
import { openScratch } from './scratch';
import { withWaitHelper } from './wait';
import { handleMessage, type RunContext, type TurnResult } from './sdkMessages';
import { WorkflowPermits, workflowAsk } from './workflows';
import { BackgroundTracker } from './backgroundTasks';
import { bundledClaude, openTerminal, readTerminal } from './terminal';
import { type AgentRunner, type AgentSession, type CloudTerminal, type CloudTerminalRequest, type RunHooks, type RunOutcome, type RunRequest, LIMIT_REACHED, STOPPED_BY_CAPTAIN } from './types';

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

/** Claude Code's permission mode for each of the office's. */
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

function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash') return `Bash(${truncate(String(input.command ?? ''), 300)})`;
  const first = input.file_path ?? input.url ?? input.pattern ?? Object.values(input)[0];
  return `${toolName}(${truncate(typeof first === 'string' ? first : JSON.stringify(first ?? ''), 300)})`;
}

/**
 * The environment every Claude Code session gets. Agents run on your Claude login, not on an API key that happens to
 * be in the environment, unless the office says the key's in use (`keyFallback`): always, or while your plan's usage
 * limit is reached.
 */
export function agentEnv(onKey = keyFallback.onKey()): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'focus/0.1.0' };
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
  constructor(private readonly browsers: BrowserPool) {}

  /**
   * A terminal running `claude --cloud`: Claude Code starts a new cloud session only from a terminal. On macOS and
   * Linux `script` records what it shows, where the session's id turns up; on Windows the captain pastes the link.
   */
  async cloudTerminal(req: CloudTerminalRequest): Promise<CloudTerminal> {
    const dir = join(paths.cloudTerminals, req.agentId);
    const log = process.platform === 'win32' ? undefined : join(dir, 'terminal.log');
    await openTerminal(dir, { cwd: req.cwd, claude: bundledClaude(), description: req.description, agentName: req.agentName, log });
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
    const canUseTool: CanUseTool = async (toolName, toolInput, { signal, title, agentID, toolUseID }) => {
      if (allowedWithoutAsking(autonomy, toolName)) return { behavior: 'allow', updatedInput: toolInput };
      // an agent of a workflow the captain approved: its progress may not have named it yet, so give it a moment
      for (let i = 0; i < 10 && permits.mightApprove(agentID); i++) await sleep(200);
      if (permits.approves(agentID)) return { behavior: 'allow', updatedInput: toolInput };
      const summary = toolName === 'Workflow' ? workflowAsk(toolInput) : title || summarizeInput(toolName, toolInput);
      const approved = await hooks.permission(toolName, summary, signal);
      if (approved && toolName === 'Workflow') permits.approveCall(toolUseID);
      return approved
        ? { behavior: 'allow', updatedInput: toolInput }
        : {
            behavior: 'deny',
            message: 'The manager declined this action. Find another approach, or explain in your final summary why it is needed.',
          };
    };

    // a cloud session runs on your plan in the cloud, whatever this machine signs in with
    const onKey = !cloud && keyFallback.onKey();
    hooks.signIn?.(onKey);
    // a local session's scratch dir for throwaway files, deleted when the run ends, and the office's focus-wait on its
    // PATH; a cloud session has its own machine
    const scratch = cloud ? undefined : openScratch(req.agentId, paths.dcgConfig);
    const env = cloud ? agentEnv(onKey) : withWaitHelper({ ...agentEnv(onKey), ...scratch?.env });
    const resets = keyFallback.resetsAt();
    if (onKey && resets) hooks.lines([{ kind: 'system', text: `✻ On your API key: your plan's usage limit is reached until ${clock(resets)}` }]);

    const stderrTail: string[] = [];
    const options: Options = {
      cwd: req.cwd,
      abortController: abort,
      model: req.model || req.settings.model || undefined,
      effort: req.effort,
      ...claudeConfig(req.settings.userClaudeMd, process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')),
      disallowedTools: ['AskUserQuestion', 'EnterPlanMode'],
      ...(cloud
        ? // the cloud VM has its own browser; ours runs on this machine. `--cloud <id>` reattaches to the session.
          { systemPrompt: { type: 'preset', preset: 'claude_code' }, extraArgs: { cloud: req.resumeSessionId ?? null } }
        : {
            // recorded on the first request and reused on every resume (the SDK's default, spelled out): instructions
            // that change mid-session would be ignored, so whatever changes goes in messages instead
            systemPrompt: { type: 'preset', preset: 'claude_code', append: req.systemAppend, snapshot: true },
            mcpServers: { browser: browserMcpServer(this.browsers, req.agentId, hooks), ...(req.tools && { office: officeMcpServer(req.tools) }) },
            resume: req.resumeSessionId,
            // the scratch dir's guard, and for a lead the hooks that keep its slice checklist current
            hooks: sessionHooks(scratch?.hook, req.checklist),
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
    ctx.tracker = new BackgroundTracker((id) => (id ? ctx.calls.get(id)?.name : undefined));
    const done = (async (): Promise<RunOutcome> => {
      let so: SoFar = { ok: false, summary: '', started: false };
      try {
        q = query({ prompt: input, options });
        for await (const msg of q) {
          if (msg.type === 'system' && msg.subtype === 'init') so = { ...so, started: true };
          const result = this.handle(msg, ctx, hooks);
          // a workflow or background subagent still running keeps listening, so a message from the captain reaches
          // the session now rather than after it's done; otherwise the session's done once its turn is
          if (!result && ctx.turnOver && !holdsInput(ctx.background ?? [])) input.close();
          if (ctx.limited && !abort.signal.aborted) {
            abort.abort();
            input.close();
          }
          if (result) {
            so = withResult(so, result);
            // how full the context is now, asked while the session's still there to answer
            if (!cloud) await reportContext(q, hooks);
            // Messages sent mid-turn are folded into that turn, so don't count results per message: finish once the
            // CLI has nothing queued. Anything still in our queue is delivered before the input reports it is done.
            ctx.turnOver = !result.queued;
            if (ctx.turnOver && !holdsInput(ctx.background ?? [])) input.close();
          }
        }
        return endedOutcome(so, { stopping, limited: !!ctx.limited });
      } catch (err) {
        return failedOutcome(so, err, { stopping, limited: !!ctx.limited, aborted: abort.signal.aborted, cloud: !!cloud, stderr: stderrTail.join('') });
      } finally {
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
      send: (text) => input.push(text),
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
