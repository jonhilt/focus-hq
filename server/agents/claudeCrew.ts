import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, type McpSdkServerConfigWithInstance, type Options, query, type SDKAssistantMessage, type SDKMessage, type SDKResultMessage, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Effort, Settings } from '../../shared/types';
import { config, paths } from '../config';
import { errorMessage, truncate } from '../util';
import { agentEnv } from './claudeRunner';
import { type Drafter, type DraftRequest, type DraftResult, draftSchema, plannerPrompt, plannerSystemPrompt, repoFolders } from './planner';
import type { ChatProject, ShipStatus } from './shipStatus';
import { renderToolUse } from './render';
import { MODEL_SCHEMA } from './modelSchema';
import { STUDIO_LIMITS as S, studioPrompt, studioSystemPrompt } from './studio';
import { clock, day, sessionTimeline } from './sessionTimeline';
import type { Staged, StudioOfficer, StudioReply, StudioTurn } from './studioComputer';
import { listSessions, type SessionSummary, loadSession } from './studioSessions';
import { parseTriage, TRIAGE_SCHEMA, type TriageDecision, type Triager, type TriageRequest, triagePrompt, triageSystemPrompt } from './triage';
import { checkoutLatest } from './workspace';
import { tidyGoalTitle } from '../../shared/goalTitle';
import { GOAL_TITLE_SCHEMA, goalTitlePrompt, goalTitleSystemPrompt } from './goalTitles';

// The permanent crew's Claude Code sessions: they read the project's code (and, for some, the web) and change nothing.
// Read-only because they only have Read, Glob and Grep, plus WebSearch and WebFetch where they're given them and the
// office's own tools, `dontAsk` denies anything not pre-approved, and none of your settings, hooks or MCP servers load.

/** The built-in tools a crew session may be given: none of them can change anything. */
type ReadOnlyTool = 'Read' | 'Glob' | 'Grep' | 'WebSearch' | 'WebFetch';
export const CODE_TOOLS: ReadOnlyTool[] = ['Read', 'Glob', 'Grep'];
export const WEB_TOOLS: ReadOnlyTool[] = ['WebSearch', 'WebFetch'];
const TURN_TIMEOUT_MS = 8 * 60_000;

/** planning/<project>/<repo>: one folder per repo under the session's cwd, so Glob and Grep reach all of them. */
const planningDir = (projectId: string) => path.join(paths.planning, projectId);

async function checkouts(projectId: string, repos: string[], activity: (text: string) => void): Promise<string> {
  const cwd = planningDir(projectId);
  activity(`Pulling the latest ${repos.length === 1 ? 'code' : `code of ${repos.length} repos`}`);
  await Promise.all([...repoFolders(repos)].map(([repo, folder]) => checkoutLatest(repo, path.join(cwd, folder))));
  return cwd;
}

export interface ReadOnlyRun {
  cwd: string;
  systemAppend: string;
  prompt: string;
  settings: Settings;
  signal: AbortSignal;
  activity: (text: string) => void;
  /** Built-in tools, all pre-approved. */
  builtins: ReadOnlyTool[];
  resume?: string;
  schema?: Record<string, unknown>;
  /** The office's own tools for this session, all pre-approved, and what the activity line says while one runs. */
  tools?: { server: McpSdkServerConfigWithInstance; names: string[]; activity: (name: string) => string };
  /** Folders outside `cwd` the session may read too. */
  readable?: string[];
  /** For sessions that read a lot: more turns, and longer, than a quick look. */
  maxTurns?: number;
  /** A model of its own (Haiku, for a cheap extraction), and a system prompt of its own in place of Claude Code's. */
  model?: string;
  system?: string;
  timeoutMs?: number;
  /** How hard it thinks; missing = the model's default. */
  effort?: Effort;
}

export interface ReadOnlyResult {
  text: string;
  structured: unknown;
  sessionId?: string;
  costUsd?: number;
  /** The model it ran on, as Claude Code reported it. */
  model?: string;
}

/** Claude Code's `query`, or a fake stream of its messages in a test. */
export type Ask = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

/**
 * The session's options: only the tools it's given, all pre-approved, `dontAsk` for anything else, none of your
 * settings, hooks or MCP servers, and the office's own tools under `mcp__<server>__`.
 */
export function readOnlyOptions(run: ReadOnlyRun, abort: AbortController): Options {
  const tools = run.tools;
  const extra = tools ? tools.names.map((n) => `${toolPrefix(tools)}${n}`) : [];
  return {
    cwd: run.cwd,
    additionalDirectories: run.readable,
    abortController: abort,
    model: run.model ?? (run.settings.model || undefined),
    systemPrompt: run.system ?? { type: 'preset', preset: 'claude_code', append: run.systemAppend },
    tools: run.builtins,
    allowedTools: [...run.builtins, ...extra],
    permissionMode: 'dontAsk',
    settingSources: [],
    mcpServers: tools ? { [tools.server.name]: tools.server } : {},
    strictMcpConfig: true,
    outputFormat: run.schema ? { type: 'json_schema', schema: run.schema } : undefined,
    maxTurns: run.maxTurns ?? 40,
    effort: run.effort,
    resume: run.resume,
    env: agentEnv(),
  };
}

const toolPrefix = (tools: NonNullable<ReadOnlyRun['tools']>) => `mcp__${tools.server.name}__`;

type Block = SDKAssistantMessage['message']['content'][number];

/** What the activity line says for one block of the session's reply, or undefined for a block that doesn't show. */
export function blockActivity(block: Block, run: Pick<ReadOnlyRun, 'tools' | 'cwd'>): string | undefined {
  if (block.type === 'tool_use') {
    const prefix = run.tools ? toolPrefix(run.tools) : undefined;
    if (run.tools && prefix !== undefined && block.name.startsWith(prefix)) return run.tools.activity(block.name.slice(prefix.length));
    return renderToolUse(block.name, (block.input ?? {}) as Record<string, unknown>, run.cwd).activity ?? '';
  }
  if (block.type === 'thinking') return 'Thinking…';
  if (block.type === 'text' && block.text.trim()) return truncate(block.text.trim().split('\n')[0], 100);
  return undefined;
}

/** What a turn's last message comes to: what it answered, or the error it ended in. */
export function turnResult(msg: SDKResultMessage, seen: Seen): ReadOnlyResult | Error {
  if (msg.subtype !== 'success') return new Error(msg.errors?.join('\n') || msg.subtype);
  if (msg.is_error) return new Error(msg.result);
  return { text: msg.result, structured: msg.structured_output, sessionId: seen.sessionId, costUsd: msg.total_cost_usd, model: seen.model };
}

/** Why a turn that threw ended: the captain stopped it, it ran out of time, or what it threw. */
export function turnFailure(err: unknown, why: { stopped: boolean; timedOut: boolean; timeoutMs: number }): Error {
  if (why.stopped) return new Error('Stopped', { cause: err });
  if (why.timedOut) return new Error(`Gave up after ${why.timeoutMs / 60_000} minutes`, { cause: err });
  return new Error(errorMessage(err), { cause: err });
}

/** The session and model Claude Code reported when the turn started. */
interface Seen {
  sessionId?: string;
  model?: string;
}

/** Reads one message of the turn: notes the session it's in, shows what it's doing, and returns its result at the end. */
function readMessage(msg: SDKMessage, run: ReadOnlyRun, seen: Seen): ReadOnlyResult | Error | undefined {
  if (msg.type === 'system' && msg.subtype === 'init') Object.assign(seen, { sessionId: msg.session_id, model: msg.model });
  else if (msg.type === 'assistant' && msg.parent_tool_use_id === null) {
    for (const block of msg.message.content) {
      const line = blockActivity(block, run);
      if (line !== undefined) run.activity(line);
    }
  } else if (msg.type === 'result') return turnResult(msg, seen);
  return undefined;
}

/** One turn of a read-only session, reporting what it's doing as it goes. */
export async function runReadOnly(run: ReadOnlyRun, ask: Ask = query): Promise<ReadOnlyResult> {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  run.signal.addEventListener('abort', onAbort);
  const timeoutMs = run.timeoutMs ?? TURN_TIMEOUT_MS;
  const timer = setTimeout(onAbort, timeoutMs);
  const seen: Seen = { sessionId: run.resume };
  try {
    for await (const msg of ask({ prompt: run.prompt, options: readOnlyOptions(run, abort) })) {
      const end = readMessage(msg, run, seen);
      if (end instanceof Error) throw end;
      if (end) return end;
    }
    throw new Error('The session stopped without a result');
  } catch (err) {
    throw turnFailure(err, { stopped: run.signal.aborted, timedOut: abort.signal.aborted, timeoutMs });
  } finally {
    clearTimeout(timer);
    run.signal.removeEventListener('abort', onAbort);
  }
}

function asDraft(out: unknown, repos: string[]): DraftResult {
  const d = (out ?? {}) as Partial<DraftResult>;
  if (!d.title || !d.body) throw new Error('Finished without writing the issue');
  return { repo: String(d.repo ?? repos[0]), title: String(d.title), body: String(d.body), tooBig: d.tooBig ? String(d.tooBig) : undefined };
}

/** The planner at a room's stand: one idea in, one issue draft out. */
export class ClaudeDrafter implements Drafter {
  forget(projectId: string): void {
    // the mirrors' `git worktree prune` drops the registrations next time
    fs.rmSync(planningDir(projectId), { recursive: true, force: true });
  }

  async draft(req: DraftRequest, activity: (text: string) => void): Promise<DraftResult> {
    const cwd = await checkouts(req.projectId, req.repos, activity);
    if (req.signal.aborted) throw new Error('Discarded');
    const result = await runReadOnly({
      cwd,
      systemAppend: plannerSystemPrompt(req),
      prompt: plannerPrompt(req),
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: CODE_TOOLS,
      resume: req.resumeSessionId,
      schema: draftSchema(req.repos),
    }).catch((err: Error) => {
      throw req.signal.aborted ? new Error('Discarded') : err;
    });
    return { ...asDraft(result.structured, req.repos), sessionId: result.sessionId, costUsd: result.costUsd };
  }
}

/** The operations officer looking at a stuck PR: reads its checkout and decides one thing to do. */
export class ClaudeTriager implements Triager {
  async triage(req: TriageRequest, activity: (text: string) => void): Promise<TriageDecision & { costUsd?: number }> {
    const result = await runReadOnly({
      cwd: req.cwd,
      systemAppend: triageSystemPrompt(req),
      prompt: triagePrompt(req),
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: CODE_TOOLS,
      schema: TRIAGE_SCHEMA,
    });
    const decision = parseTriage(result.structured);
    if (!decision) throw new Error('Finished without choosing what to do');
    return { ...decision, costUsd: result.costUsd };
  }
}

/**
 * The studio holodeck's computer: one session per conversation, in a folder of its own, that builds what the captain
 * describes as scenes in the middle of the hall, reading the web, Claude Code sessions, the ship's state and its
 * projects' code (checked out under planning/) when it needs to.
 */
export class ClaudeStudio implements StudioOfficer {
  async turn(req: StudioTurn, activity: (text: string) => void): Promise<StudioReply> {
    fs.mkdirSync(paths.studio, { recursive: true });
    const result = await runReadOnly({
      cwd: paths.studio,
      readable: [paths.planning, paths.workspaces, config.root],
      systemAppend: studioSystemPrompt({ projects: req.projects, planning: paths.planning, office: config.root }),
      prompt: studioPrompt(req.messages, !!req.resumeSessionId, req.takes),
      settings: req.settings,
      model: req.model || undefined,
      effort: req.effort,
      signal: req.signal,
      activity,
      builtins: [...CODE_TOOLS, ...WEB_TOOLS],
      resume: req.resumeSessionId,
      tools: {
        server: studioServer(req, activity),
        names: ['scene', 'model', 'retime_scene', 'drop_scene', 'sessions', 'session_timeline', 'ship_status', 'open_project'],
        activity: (name) => ({ sessions: 'Looking through Claude Code sessions', session_timeline: 'Reading a session', scene: 'Building the scene', model: 'Checking the model against the code', retime_scene: 'Retiming the scene', drop_scene: 'Clearing a scene', ship_status: 'Checking the ship’s status', open_project: 'Opening a project' })[name] ?? name,
      },
    });
    return { text: result.text, sessionId: result.sessionId, costUsd: result.costUsd, model: result.model };
  }
}

/** The sessions tool's answer: a line or two for each. */
function sessionList(found: SessionSummary[]): string {
  if (!found.length) return 'No Claude Code sessions match that.';
  return found.map((s) => {
    const when = `${day(s.modifiedAt)} ${clock(s.modifiedAt)}`;
    return `- ${s.id}: ${s.title ?? '(untitled)'} · ${when} · ${(s.bytes / 1e6).toFixed(1)} MB · ${s.agents} agents · ${s.project}${s.asked ? `\n  first asked: ${s.asked}` : ''}`;
  }).join('\n');
}

/** A scene's named phases, as its tools send them. */
const PHASES = z.record(z.string(), z.tuple([z.number(), z.number()]));

/** The studio computer's own tools: the scenes it builds in the middle of the hall, and reading Claude Code sessions, the ship and its projects' code. */
function studioServer(req: StudioTurn, activity: (text: string) => void): McpSdkServerConfigWithInstance {
  const answer = async (run: () => string | Promise<string>) => {
    try {
      return { content: [{ type: 'text' as const, text: await run() }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: errorMessage(err) }], isError: true };
    }
  };
  // a scene's answer carries its contact sheet, for the computer to look at
  const staged = async (run: () => Promise<Staged>) => {
    try {
      const { text, sheet } = await run();
      return { content: [{ type: 'text' as const, text }, ...(sheet ? [{ type: 'image' as const, data: sheet, mimeType: 'image/jpeg' }] : [])] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: errorMessage(err) }], isError: true };
    }
  };
  return createSdkMcpServer({
    name: 'studio',
    version: '1.0.0',
    alwaysLoad: true,
    tools: [
      tool(
        'scene',
        'Build a scene in the middle of the holodeck (the kit and render(t) are in your instructions): it stands there at once, in place of the last. A new id makes a new scene; an id you\'ve used before swaps that one in, changed. It tells you whether it runs in the room, and hands back a contact sheet of it to look at before you tell the captain it\'s ready.',
        {
          id: z.string().describe('A short lowercase name, like fan-out or tides: the captain can call it back by it.'),
          label: z.string().max(S.takeLabel).describe('A few words naming it.'),
          metaphor: z.string().max(S.metaphor).describe('Decided before any script: what it shows the idea as, in one sentence, saying what moves and what that movement means.'),
          detail: z.string().max(S.takeDetail).optional().describe('What it simplifies or leaves out, in a line.'),
          seconds: z.number().min(S.minSeconds).max(S.maxSeconds).describe('How long it plays before it loops.'),
          phases: PHASES.optional().describe('Its named phases, like {"dispatch": [0, 2], "work": [2, 6]}: time the script by phase(t, name), so retime_scene can change the timing later.'),
          script: z.string().max(S.script).describe('Makes the cast with kit, then defines function render(t).'),
        },
        (input) => staged(() => req.tools.take(input)),
      ),
      tool(
        'model',
        'Show how a real system works as a model recovered from its code: its parts, how they connect, and one scenario as steps along the connections, every part and connection cited. The holodeck draws it one fixed way on three boards round the captain (its structure, the scenario as a sequence diagram, and the data at each step), lays it out itself, and steps the scenario across all three; up close the captain can pick any part to see the code it cites. The office checks every cite against the code and tells you what didn\'t check out (drawn flagged in red) so you can fix it. Use it, not scene, for anything about how real code works.',
        {
          id: z.string().describe('A short lowercase name for the scene, like save-proposal.'),
          label: z.string().max(S.takeLabel).describe('A few words naming it.'),
          model: MODEL_SCHEMA,
        },
        (input) => staged(() => req.tools.model(input)),
      ),
      tool(
        'retime_scene',
        'Change a scene\'s timing without touching its script, and bring it back to the middle of the hall: a speed for the whole scene (0.5 is half speed), or new seconds and phases. The quickest way to do "slower" or "hold the fold longer".',
        {
          id: z.string(),
          speed: z.number().min(0.1).max(10).optional().describe('Plays the whole scene, and every phase, at this speed: 0.5 takes twice as long.'),
          seconds: z.number().min(S.minSeconds).max(S.maxSeconds).optional().describe('Its new length.'),
          phases: PHASES.optional().describe('All its phases again, with their new times.'),
        },
        (input) => staged(() => req.tools.retime(input)),
      ),
      tool('drop_scene', 'Forget a scene you\'ve built.', { id: z.string() }, ({ id }) => answer(() => req.tools.dropTake(id))),
      tool(
        'sessions',
        'The Claude Code sessions on the captain\'s Mac, newest first: each with its id, Claude Code\'s title for it, what was first asked, when, its size and how many agents it ran. Search by words from its title, first ask or project folder.',
        {
          query: z.string().optional().describe('Words that must all appear in its title, first ask or folder; leave out for the newest.'),
          limit: z.number().int().min(1).max(50).optional().describe('How many (20 unless you say).'),
        },
        ({ query, limit }) => answer(async () => sessionList(await listSessions(query, limit))),
      ),
      tool(
        'session_timeline',
        'A Claude Code session as a timeline, from its transcripts: what was asked, what Claude said and ran, and each subagent and workflow it started (when, how many at once, on which models, what came back). The whole session first; then from and to zoom in on a stretch in detail.',
        {
          session: z.string().describe('Its id (from the sessions tool) or its transcript\'s path.'),
          from: z.string().optional().describe('Zoom in from this time, as the timeline shows it with its date ("2026-10-09 15:35").'),
          to: z.string().optional().describe('Zoom in to this time.'),
        },
        ({ session, from, to }) => answer(async () => sessionTimeline(await loadSession(session), { from, to })),
      ),
      ...shipTools(req, activity, (dir) => dir),
    ],
  });
}

/**
 * The ship's state and a project's code on demand, for a crew session that reads the ship (the studio's computer, and
 * plugins' crew): `shown` says where a checkout went, as the session should read it. Neither changes anything aboard.
 */
export function shipTools(req: { projects: ChatProject[]; shipStatus: () => Promise<ShipStatus> }, activity: (text: string) => void, shown: (dir: string) => string) {
  const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError && { isError }) });
  const project = (id: string): ChatProject | undefined => req.projects.find((p) => p.id === id);
  return [
    tool('ship_status', "The ship right now: per project, its agents (with their worktree paths), open pull requests with QA verdicts and checks, what needs the captain, and its closed goals (newest first) with each PR's state on GitHub right now (stale: true when it couldn't be looked up, so it's only the recorded outcome).", {}, async () =>
      text(JSON.stringify(await req.shipStatus(), null, 1)),
    ),
    tool(
      'open_project',
      "Checks out a project's repositories at their latest default branch, so you can read its code: it says where each went.",
      { projectId: z.string().describe('The project id, as listed in your instructions') },
      async ({ projectId }) => {
        const found = project(projectId);
        if (!found) return text(`There's no project with id ${projectId}. The projects are: ${req.projects.map((p) => `${p.name} (${p.id})`).join(', ') || 'none'}.`, true);
        if (!found.repos.length) return text(`${found.name} has no repositories yet.`, true);
        try {
          const cwd = await checkouts(found.id, found.repos, activity);
          const folders = [...repoFolders(found.repos)];
          return text(`${found.name} is checked out at its default branch:\n${folders.map(([r, folder]) => `- ${shown(path.join(cwd, folder))}/ (${r})`).join('\n')}`);
        } catch (err) {
          return text(`The checkout of ${found.name} failed: ${errorMessage(err)}`, true);
        }
      },
    ),
  ];
}

/** The model that titles a new goal: a quick, cheap job. */
export const TITLE_MODEL = 'claude-haiku-4-5-20251001';

/** A short title for a goal from the captain's first words, by Haiku; undefined when it doesn't give a usable one. */
export async function titleGoal(brief: string, settings: Settings): Promise<string | undefined> {
  const result = await runReadOnly({
    cwd: os.tmpdir(),
    system: goalTitleSystemPrompt(),
    systemAppend: '',
    prompt: goalTitlePrompt(brief),
    settings,
    signal: new AbortController().signal,
    activity: () => undefined,
    builtins: [],
    schema: GOAL_TITLE_SCHEMA,
    model: TITLE_MODEL,
    maxTurns: 2,
    timeoutMs: 60_000,
  });
  return tidyGoalTitle((result.structured as { title?: unknown } | undefined)?.title);
}
