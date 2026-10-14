import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, type McpSdkServerConfigWithInstance, type Options, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Effort, Settings } from '../../shared/types';
import { paths } from '../config';
import { errorMessage, truncate } from '../util';
import { agentEnv } from './claudeRunner';
import { type Drafter, type DraftRequest, type DraftResult, draftSchema, plannerPrompt, plannerSystemPrompt, repoFolders } from './planner';
import { asNumberOneReply, type ChatProject, type NumberOneOfficer, type NumberOneReply, type NumberOneTurn, numberOnePrompt, numberOneReplySchema, numberOneSystemPrompt, type ShipStatus } from './numberOne';
import { renderToolUse } from './render';
import { MODEL_LIMITS } from '../../shared/systemModel';
import { MODEL_EDGE_KINDS, MODEL_KINDS } from '../../shared/types';
import { STUDIO_LIMITS as S, studioPrompt, studioSystemPrompt } from './studio';
import { clock, day, sessionTimeline } from './sessionTimeline';
import type { Staged, StudioOfficer, StudioReply, StudioTurn } from './studioComputer';
import { listSessions, type SessionSummary, loadSession } from './studioSessions';
import { parseTriage, TRIAGE_SCHEMA, type TriageDecision, type Triager, type TriageRequest, triagePrompt, triageSystemPrompt } from './triage';
import { checkoutLatest } from './workspace';
import type { RetroOfficer, RetroRequest } from './engineer';
import { DRAFTS_SCHEMA, engineerPrompt, engineerSystemPrompt } from './retro';
import { READ_SCHEMA, readerSystemPrompt } from './frictions';
import { chiefEngineer } from '../../shared/crew';

// The permanent crew's Claude Code sessions: they read the project's code (and, for Number One, the web) and change
// nothing. Read-only because they only have Read, Glob and Grep, plus WebSearch and WebFetch for Number One and the
// office's own tools, `dontAsk` denies anything not pre-approved, and none of your settings, hooks or MCP servers load.

/** The built-in tools a crew session may be given: none of them can change anything. */
type ReadOnlyTool = 'Read' | 'Glob' | 'Grep' | 'WebSearch' | 'WebFetch';
const CODE_TOOLS: ReadOnlyTool[] = ['Read', 'Glob', 'Grep'];
const WEB_TOOLS: ReadOnlyTool[] = ['WebSearch', 'WebFetch'];
const TURN_TIMEOUT_MS = 8 * 60_000;

/** planning/<project>/<repo>: one folder per repo under the session's cwd, so Glob and Grep reach all of them. */
const planningDir = (projectId: string) => path.join(paths.planning, projectId);

async function checkouts(projectId: string, repos: string[], activity: (text: string) => void): Promise<string> {
  const cwd = planningDir(projectId);
  activity(`Pulling the latest ${repos.length === 1 ? 'code' : `code of ${repos.length} repos`}`);
  await Promise.all([...repoFolders(repos)].map(([repo, folder]) => checkoutLatest(repo, path.join(cwd, folder))));
  return cwd;
}

interface ReadOnlyRun {
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
  /** For sessions that read a lot (a retro): more turns, and longer, than a quick look. */
  maxTurns?: number;
  /** A model of its own (Haiku, for a cheap extraction), and a system prompt of its own in place of Claude Code's. */
  model?: string;
  system?: string;
  timeoutMs?: number;
  /** How hard it thinks; missing = the model's default. */
  effort?: Effort;
}

interface ReadOnlyResult {
  text: string;
  structured: unknown;
  sessionId?: string;
  costUsd?: number;
  /** The model it ran on, as Claude Code reported it. */
  model?: string;
}

/** One turn of a read-only session, reporting what it's doing as it goes. */
async function runReadOnly(run: ReadOnlyRun): Promise<ReadOnlyResult> {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  run.signal.addEventListener('abort', onAbort);
  const timeoutMs = run.timeoutMs ?? TURN_TIMEOUT_MS;
  const timer = setTimeout(onAbort, timeoutMs);
  const prefix = run.tools ? `mcp__${run.tools.server.name}__` : undefined;
  const extra = run.tools ? run.tools.names.map((n) => `${prefix}${n}`) : [];
  const options: Options = {
    cwd: run.cwd,
    additionalDirectories: run.readable,
    abortController: abort,
    model: run.model ?? (run.settings.model || undefined),
    systemPrompt: run.system ?? { type: 'preset', preset: 'claude_code', append: run.systemAppend },
    tools: run.builtins,
    allowedTools: [...run.builtins, ...extra],
    permissionMode: 'dontAsk',
    settingSources: [],
    mcpServers: run.tools ? { [run.tools.server.name]: run.tools.server } : {},
    strictMcpConfig: true,
    outputFormat: run.schema ? { type: 'json_schema', schema: run.schema } : undefined,
    maxTurns: run.maxTurns ?? 40,
    effort: run.effort,
    resume: run.resume,
    env: agentEnv(),
  };

  let sessionId = run.resume;
  let model: string | undefined;
  try {
    for await (const msg of query({ prompt: run.prompt, options })) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id;
        model = msg.model;
      }
      else if (msg.type === 'assistant' && msg.parent_tool_use_id === null) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') {
            if (run.tools && prefix && block.name.startsWith(prefix)) run.activity(run.tools.activity(block.name.slice(prefix.length)));
            else run.activity(renderToolUse(block.name, (block.input ?? {}) as Record<string, unknown>, run.cwd).activity ?? '');
          } else if (block.type === 'thinking') run.activity('Thinking…');
          else if (block.type === 'text' && block.text.trim()) run.activity(truncate(block.text.trim().split('\n')[0], 100));
        }
      } else if (msg.type === 'result') {
        if (msg.subtype !== 'success' || msg.is_error) throw new Error(msg.subtype === 'success' ? msg.result : (msg.errors?.join('\n') || msg.subtype));
        return { text: msg.result, structured: msg.structured_output, sessionId, costUsd: msg.total_cost_usd, model };
      }
    }
    throw new Error('The session stopped without a result');
  } catch (err) {
    if (run.signal.aborted) throw new Error('Stopped', { cause: err });
    if (abort.signal.aborted) throw new Error(`Gave up after ${timeoutMs / 60_000} minutes`, { cause: err });
    throw new Error(errorMessage(err), { cause: err });
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
 * Number One: one session for the whole ship, from planning/, so every project's checkout is in reach once it's opened.
 * Agents' worktrees are readable too, to see what an agent has done so far.
 */
export class ClaudeNumberOne implements NumberOneOfficer {
  async turn(req: NumberOneTurn, activity: (text: string) => void): Promise<NumberOneReply> {
    fs.mkdirSync(paths.planning, { recursive: true });
    const ids = req.projects.map((p) => p.id);
    const result = await runReadOnly({
      cwd: paths.planning,
      readable: [paths.workspaces],
      systemAppend: numberOneSystemPrompt({ projects: req.projects, workspaces: paths.workspaces }),
      prompt: numberOnePrompt(req),
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: [...CODE_TOOLS, ...WEB_TOOLS],
      resume: req.resumeSessionId,
      schema: numberOneReplySchema(ids),
      tools: {
        server: numberOneServer(req, activity),
        names: ['ship_status', 'open_project'],
        activity: (name) => (name === 'ship_status' ? 'Checking the ship’s status' : 'Opening a project'),
      },
    });
    return { ...asNumberOneReply(result.structured, result.text, ids), sessionId: result.sessionId, costUsd: result.costUsd };
  }
}

/**
 * The studio holodeck's computer: one session per conversation, in a folder of its own, that builds what the captain
 * describes as scenes in the middle of the hall, reading the web, Claude Code sessions, the ship's state and its
 * projects' code (checked out, as Number One's are) when it needs to.
 */
export class ClaudeStudio implements StudioOfficer {
  async turn(req: StudioTurn, activity: (text: string) => void): Promise<StudioReply> {
    fs.mkdirSync(paths.studio, { recursive: true });
    const result = await runReadOnly({
      cwd: paths.studio,
      readable: [paths.planning, paths.workspaces],
      systemAppend: studioSystemPrompt({ projects: req.projects, planning: paths.planning }),
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

/** Where in the code something is, as a model cites it. */
const CITE = z.object({ file: z.string().describe('The file\'s absolute path, as you read it.'), line: z.number().int().min(1) });

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
        'Show how a real system works as a model recovered from its code: its parts, how they connect, and one scenario as steps along the connections, every part and connection cited. The holodeck draws it one fixed way (shape = kind, colour = layer, a line = a connection, a moving token = data, with a legend), lays it out itself, and animates the scenario. The office checks every cite against the code and tells you what didn\'t check out (drawn flagged in red) so you can fix it. Use it, not scene, for anything about how real code works.',
        {
          id: z.string().describe('A short lowercase name for the scene, like save-proposal.'),
          label: z.string().max(S.takeLabel).describe('A few words naming it.'),
          model: z.object({
            question: z.string().max(MODEL_LIMITS.question).describe('The question it answers, in a sentence.'),
            nodes: z.array(z.object({
              id: z.string().describe('Short, lowercase, letters, digits and dashes.'),
              label: z.string().max(MODEL_LIMITS.label).describe('What it is, in a few words.'),
              kind: z.enum(MODEL_KINDS).describe('ui (a page or component), route (an endpoint), handler, service, store (a table, cache or file), queue (a channel, event bus or message queue), external (another system), job (background work), type (a data shape that matters).'),
              layer: z.string().describe('Its layer or owner (UI, API, Domain, Data, External…): parts in the same layer share a colour. Use few layers.'),
              symbol: z.string().optional().describe('Its name in the code (class, function, component, table), as written there: the check looks for it at its cite, and connections to it should mention it.'),
              cite: CITE.optional().describe('Where it is defined.'),
            })).max(MODEL_LIMITS.nodes),
            edges: z.array(z.object({
              from: z.string(),
              to: z.string(),
              kind: z.enum(MODEL_EDGE_KINDS),
              label: z.string().optional(),
              cite: CITE.optional().describe('The line where `from` reaches `to`: it (or a line within two of it) must mention `to`\'s symbol.'),
            })).max(MODEL_LIMITS.edges),
            trace: z.array(z.object({
              from: z.string(),
              to: z.string(),
              label: z.string().describe('What happens at this step, in a few words.'),
              payload: z.string().optional().describe('What moves: the data\'s type and its fields that matter, like "ProposalDto { title, body }".'),
            })).max(MODEL_LIMITS.steps).describe('One concrete scenario, in order, each step along a connection (either way along it).'),
            simplified: z.array(z.string()).max(MODEL_LIMITS.simplified).describe('What you left out or simplified.'),
            checks: z.array(z.object({ q: z.string(), a: z.string(), cite: CITE.optional() })).max(MODEL_LIMITS.checks).optional().describe('Two or three questions the captain should be able to answer from it, with the answer and the line that confirms it.'),
          }),
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

/** Number One's own tools: the ship's state, and a project's code on demand. Neither changes anything aboard. */
function numberOneServer(req: NumberOneTurn, activity: (text: string) => void): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'number-one',
    version: '1.0.0',
    alwaysLoad: true,
    tools: shipTools(req, activity, (dir) => path.relative(paths.planning, dir)),
  });
}

/**
 * The ship's state and a project's code on demand, for a crew session that reads the ship (Number One, the studio's
 * computer): `shown` says where a checkout went, as the session should read it.
 */
function shipTools(req: { projects: ChatProject[]; shipStatus: () => Promise<ShipStatus> }, activity: (text: string) => void, shown: (dir: string) => string) {
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

/**
 * The chief engineer on a retro: reads the evidence the office gathered into its own folder (the frictions that keep
 * coming back, the ledger, closed goals) and nothing else, and drafts issues from them.
 */
/** The model that reads sessions for frictions at retro time: it labels the same trouble the same way (see docs/retro.md). */
export const READER_MODEL = 'claude-opus-5-5';

export class ClaudeEngineer implements RetroOfficer {
  /** A batch of sessions' spans for their frictions: no tools, a short system prompt of its own, a structured answer. */
  async read(req: { prompt: string; settings: Settings; signal: AbortSignal }): Promise<{ structured: unknown; costUsd?: number }> {
    const result = await runReadOnly({
      cwd: os.tmpdir(),
      system: readerSystemPrompt(),
      systemAppend: '',
      prompt: req.prompt,
      settings: req.settings,
      signal: req.signal,
      activity: () => undefined,
      builtins: [],
      schema: READ_SCHEMA,
      model: READER_MODEL,
      maxTurns: 6,
      timeoutMs: 10 * 60_000,
    });
    return { structured: result.structured, costUsd: result.costUsd };
  }

  async retro(req: RetroRequest, activity: (text: string) => void): Promise<{ structured: unknown; text: string; costUsd?: number }> {
    const result = await runReadOnly({
      cwd: req.cwd,
      systemAppend: engineerSystemPrompt(chiefEngineer().name),
      prompt: engineerPrompt(req.days, req.groups),
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: CODE_TOOLS,
      schema: DRAFTS_SCHEMA,
      maxTurns: 60,
      timeoutMs: 15 * 60_000,
    });
    return { structured: result.structured, text: result.text, costUsd: result.costUsd };
  }
}
