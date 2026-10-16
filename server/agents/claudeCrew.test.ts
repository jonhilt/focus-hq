import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSdkMcpServer, type SDKMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Settings } from '../../shared/types';
import { type Ask, blockActivity, type ReadOnlyRun, readOnlyOptions, runReadOnly, shipSession, turnFailure, turnResult } from './claudeCrew';
import { paths } from '../config';

const server = createSdkMcpServer({ name: 'office', tools: [] });
const tools = { server, names: ['ship_status'], activity: (name: string) => `Running ${name}` };

const crewRun = (over: Partial<ReadOnlyRun> = {}): ReadOnlyRun => ({
  cwd: '/planning/p1',
  systemAppend: 'You are the ops officer.',
  prompt: 'What now?',
  settings: { model: '' } as Settings,
  signal: new AbortController().signal,
  activity: () => undefined,
  builtins: ['Read', 'Glob', 'Grep'],
  ...over,
});

const init = { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5-5' } as SDKMessage;
const said = (...content: unknown[]) => ({ type: 'assistant', parent_tool_use_id: null, message: { content } }) as SDKMessage;
const success = (over: object = {}) =>
  ({ type: 'result', subtype: 'success', is_error: false, result: 'Done', structured_output: { ok: true }, total_cost_usd: 0.12, ...over }) as SDKResultMessage;
const failed = (errors: string[]) => ({ type: 'result', subtype: 'error_max_turns', is_error: true, errors }) as unknown as SDKResultMessage;

/** A stream of the messages given, as Claude Code's `query` would send them. */
const stream = (...messages: SDKMessage[]): Ask =>
  async function* () {
    for (const m of messages) yield await Promise.resolve(m);
  };

describe('readOnlyOptions', () => {
  it('gives a session only its own tools, all pre-approved, none of your settings, and dontAsk for the rest', () => {
    const options = readOnlyOptions(crewRun(), new AbortController());
    expect(options).toMatchObject({
      tools: ['Read', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'dontAsk',
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      maxTurns: 40,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'You are the ops officer.' },
    });
    expect(options.model).toBeUndefined();
    expect(options.outputFormat).toBeUndefined();
  });

  it('pre-approves the office’s own tools under their server’s name, and only that server', () => {
    const options = readOnlyOptions(crewRun({ tools }), new AbortController());
    expect(options.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'mcp__office__ship_status']);
    expect(options.mcpServers).toEqual({ office: server });
  });

  it('takes a model, system prompt and schema of its own over the settings and Claude Code’s', () => {
    const schema = { type: 'object' };
    const options = readOnlyOptions(crewRun({ model: 'haiku', system: 'Extract.', schema, settings: { model: 'opus' } as Settings }), new AbortController());
    expect(options).toMatchObject({ model: 'haiku', systemPrompt: 'Extract.', outputFormat: { type: 'json_schema', schema } });
    expect(readOnlyOptions(crewRun({ settings: { model: 'opus' } as Settings }), new AbortController()).model).toBe('opus');
  });
});

describe('blockActivity', () => {
  const at = { cwd: '/planning/p1', tools };

  it('says what an office tool is doing in its own words', () => {
    expect(blockActivity({ type: 'tool_use', id: 't1', name: 'mcp__office__ship_status', input: {} } as never, at)).toBe('Running ship_status');
  });

  it('says what a built-in tool is doing, with paths relative to the checkout', () => {
    expect(blockActivity({ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/planning/p1/web/a.ts' } } as never, at)).toBe('Reading web/a.ts');
  });

  it('shows thinking, and the first line of what it says, cut short', () => {
    expect(blockActivity({ type: 'thinking', thinking: '…', signature: '' } as never, at)).toBe('Thinking…');
    expect(blockActivity({ type: 'text', text: `  Found it\nmore` } as never, at)).toBe('Found it');
    expect(blockActivity({ type: 'text', text: 'x'.repeat(200) } as never, at)?.length).toBeLessThanOrEqual(101);
  });

  it('shows nothing for blank text or a block it doesn’t know', () => {
    expect(blockActivity({ type: 'text', text: '  \n' } as never, at)).toBeUndefined();
    expect(blockActivity({ type: 'redacted_thinking', data: '' } as never, at)).toBeUndefined();
  });
});

describe('turnResult', () => {
  const seen = { sessionId: 'sess-1', model: 'claude-opus-5-5' };

  it('returns the answer, its structured output and cost, in the session it started', () => {
    expect(turnResult(success(), seen)).toEqual({ text: 'Done', structured: { ok: true }, sessionId: 'sess-1', costUsd: 0.12, model: 'claude-opus-5-5' });
  });

  it('fails with what Claude Code reported, or the kind of failure when it reported nothing', () => {
    expect(turnResult(failed(['Ran out of turns', 'twice']), seen)).toEqual(new Error('Ran out of turns\ntwice'));
    expect(turnResult(failed([]), seen)).toEqual(new Error('error_max_turns'));
    expect(turnResult(success({ is_error: true, result: 'API error' }), seen)).toEqual(new Error('API error'));
  });
});

describe('turnFailure', () => {
  const cause = new Error('aborted');

  it('says the captain stopped it before saying it ran out of time', () => {
    expect(turnFailure(cause, { stopped: true, timedOut: true, timeoutMs: 60_000 }).message).toBe('Stopped');
    expect(turnFailure(cause, { stopped: true, timedOut: false, timeoutMs: 60_000 }).message).toBe('Stopped');
    expect(turnFailure(cause, { stopped: false, timedOut: true, timeoutMs: 8 * 60_000 }).message).toBe('Gave up after 8 minutes');
  });

  it('otherwise passes on what went wrong, keeping it as the cause', () => {
    const err = turnFailure(cause, { stopped: false, timedOut: false, timeoutMs: 60_000 });
    expect(err.message).toBe('aborted');
    expect(err.cause).toBe(cause);
  });
});

describe('runReadOnly', () => {
  it('reports what the session does and returns its result, in the session Claude Code started', async () => {
    const lines: string[] = [];
    const result = await runReadOnly(crewRun({ activity: (l) => lines.push(l) }), stream(init, said({ type: 'thinking', thinking: '', signature: '' }, { type: 'text', text: 'Looking' }), success()));
    expect(result).toEqual({ text: 'Done', structured: { ok: true }, sessionId: 'sess-1', costUsd: 0.12, model: 'claude-opus-5-5' });
    expect(lines).toEqual(['Thinking…', 'Looking']);
  });

  it('keeps the session it resumed when Claude Code doesn’t say, and leaves a subagent’s messages out of the activity', async () => {
    const lines: string[] = [];
    const subagent = { ...said({ type: 'text', text: 'Inside' }), parent_tool_use_id: 'toolu_1' } as SDKMessage;
    const result = await runReadOnly(crewRun({ resume: 'sess-0', activity: (l) => lines.push(l) }), stream(subagent, success()));
    expect(result.sessionId).toBe('sess-0');
    expect(lines).toEqual([]);
  });

  it('fails with the result’s error, and when the session ends without a result', async () => {
    await expect(runReadOnly(crewRun(), stream(init, failed(['Ran out of turns'])))).rejects.toThrow('Ran out of turns');
    await expect(runReadOnly(crewRun(), stream(init))).rejects.toThrow('The session stopped without a result');
  });

  it('says it was stopped when the captain stops it mid-turn, and stops the session too', async () => {
    const captain = new AbortController();
    let sessionAborted = false;
    const ask: Ask = async function* ({ options }) {
      yield await Promise.resolve(init);
      captain.abort();
      sessionAborted = options.abortController?.signal.aborted ?? false;
      throw new Error('aborted by user');
    };
    await expect(runReadOnly(crewRun({ signal: captain.signal }), ask)).rejects.toThrow('Stopped');
    expect(sessionAborted).toBe(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up when the turn runs past its time, 8 minutes unless it says', async () => {
    vi.useFakeTimers();
    const ask: Ask = async function* ({ options }) {
      const signal = options.abortController?.signal;
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
      yield await Promise.reject(new Error('aborted by user'));
    };
    const turn = expect(runReadOnly(crewRun(), ask)).rejects.toThrow('Gave up after 8 minutes');
    await vi.advanceTimersByTimeAsync(8 * 60_000);
    await turn;
  });
});

describe('shipSession', () => {
  it('runs from the planning folder with the agents’ worktrees readable, and the ship tools under the plugin’s name', async () => {
    let seen: { cwd?: string; readable?: string[]; servers: string[]; allowed?: string[]; append?: unknown } = { servers: [] };
    const ask: Ask = async function* ({ options }) {
      const prompt = options.systemPrompt;
      seen = { cwd: options.cwd, readable: options.additionalDirectories, servers: Object.keys(options.mcpServers ?? {}), allowed: options.allowedTools, append: prompt && !Array.isArray(prompt) && typeof prompt === 'object' && 'append' in prompt ? prompt.append : prompt };
      yield await Promise.resolve(init);
      yield success();
    };
    const { cwd: _cwd, systemAppend: _append, ...run } = crewRun({ builtins: ['Read'] });
    const result = await shipSession('number-one', { ...run, systemAppend: ({ workspaces }) => `Worktrees are in ${workspaces}.`, projects: [], shipStatus: () => Promise.resolve({ projects: [] }) }, ask);
    expect(result.text).toBe('Done');
    expect(seen).toEqual({
      cwd: paths.planning,
      readable: [paths.workspaces],
      servers: ['number-one'],
      allowed: ['Read', 'mcp__number-one__ship_status', 'mcp__number-one__open_project'],
      append: `Worktrees are in ${paths.workspaces}.`,
    });
  });
});
