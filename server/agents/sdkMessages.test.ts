import { describe, expect, it } from 'vitest';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { entryLines } from '../../shared/stepText';
import type { BrowserFrame, TermEntry } from '../../shared/types';
import { foregroundTasks, handleMessage, helperActivity, helperBrief, helperEnd, limitNotice, resultText, screenshotActivity, systemNote, turnResult, type RunContext } from './sdkMessages';
import { BackgroundTracker, type BackgroundEvent } from './backgroundTasks';
import type { ProbeEvent, RunHooks, WorkflowEvent } from './types';

type Line = TermEntry;
const system = (m: Record<string, unknown>) => ({ type: 'system', ...m }) as unknown as Extract<SDKMessage, { type: 'system' }>;
const context = (over: Partial<RunContext> = {}): RunContext => ({
  cwd: '/w', calls: new Map(), helpers: new Map(), workflows: new Set(), modelled: new Set(), probes: new Set(), commits: new Map(), onKey: false, counted: new Set(), ...over,
});

/** Hooks that record what they're told. */
const recorder = () => {
  const said = {
    lines: [] as Line[], activity: [] as [string | null, string][], sessions: [] as string[], helper: [] as unknown[], helperLines: new Map<string, Line[]>(),
    frames: [] as BrowserFrame[], tasks: [] as unknown[][], costs: [] as number[],
  };
  const hooks = {
    lines: (l: Line[]) => said.lines.push(...l),
    activity: (status: string | null, text: string) => said.activity.push([status, text]),
    session: (id: string) => said.sessions.push(id),
    helper: (e: unknown) => said.helper.push(e),
    helperLines: (id: string, l: Line[]) => said.helperLines.set(id, [...(said.helperLines.get(id) ?? []), ...l]),
    browser: (f: BrowserFrame) => said.frames.push(f),
    taskTool: (...args: unknown[]) => said.tasks.push(args),
    cost: (usd: number) => said.costs.push(usd),
  } as unknown as RunHooks;
  return { said, hooks };
};

describe('foregroundTasks', () => {
  it('lists the kinds of task running, leaving out the ambient ones', () => {
    expect(foregroundTasks([{ task_type: 'local_workflow' }, { task_type: 'monitor', ambient: true }, {}])).toEqual(['local_workflow', '']);
    expect(foregroundTasks(undefined)).toEqual([]);
  });
});

describe('systemNote', () => {
  it('says which Claude Code, model and permission mode started', () => {
    const init = system({ subtype: 'init', claude_code_version: '2.1.0', model: 'opus', permissionMode: 'auto' });
    expect(systemNote(init)).toEqual({ line: { kind: 'system', text: '✻ Claude Code 2.1.0 · opus · auto' } });
  });

  it('shows an API retry as an error, and waiting on the API as what they’re doing', () => {
    expect(systemNote(system({ subtype: 'api_retry', error: 'overloaded', attempt: 2, max_retries: 10 }))).toEqual({
      line: { kind: 'error', text: '  ⚠ API overloaded – retrying (attempt 2/10)' },
      activity: 'Waiting on the API (overloaded)',
    });
  });

  it('notes a compaction, and nothing for the rest', () => {
    expect(systemNote(system({ subtype: 'compact_boundary' }))?.line.text).toBe('✻ Conversation compacted');
    expect(systemNote(system({ subtype: 'status' }))).toBeUndefined();
  });
});

describe('a subagent’s transcript', () => {
  it('starts with what it was asked, when the Agent call says', () => {
    expect(helperBrief('Map the cart', '  Find the store ')).toEqual([{ kind: 'system', text: '✻ Map the cart' }, { kind: 'manager', text: '▶ Find the store' }]);
    expect(helperBrief('Map the cart', '  ')).toEqual([{ kind: 'system', text: '✻ Map the cart' }]);
    expect(helperBrief('Map the cart', undefined)).toEqual([{ kind: 'system', text: '✻ Map the cart' }]);
  });

  it('ends with how it ended', () => {
    expect(helperEnd('completed')).toEqual({ kind: 'success', text: '✔ Done' });
    expect(helperEnd('stopped')).toEqual({ kind: 'error', text: '✘ stopped' });
  });
});

describe('helperActivity', () => {
  it('is the subagent’s own summary, or else the tool it last used, or nothing', () => {
    expect(helperActivity({ summary: 'Reading the store', last_tool_name: 'Read' })).toBe('Reading the store');
    expect(helperActivity({ last_tool_name: 'Grep' })).toBe('Using Grep');
    expect(helperActivity({})).toBe('');
  });
});

describe('resultText', () => {
  it('is a string result whole, or an array’s text blocks a line each, or nothing', () => {
    expect(resultText('done')).toBe('done');
    expect(resultText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\n\nb');
    expect(resultText(undefined)).toBe('');
  });

  it('reads past what isn’t a block', () => {
    expect(resultText([null, 'x', { type: 'text', text: 'a' }])).toBe('a');
  });
});

describe('screenshotActivity', () => {
  it('is testing when it’s a screenshot of a page, and looking otherwise', () => {
    expect(screenshotActivity('http://localhost:5173/')).toEqual({ status: 'testing', activity: 'Checking a screenshot of http://localhost:5173/' });
    expect(screenshotActivity('/w/shot.png')).toEqual({ status: null, activity: 'Looking at /w/shot.png' });
  });
});

describe('your plan’s usage limit', () => {
  it('says whether it’s switching or waiting for the reset', () => {
    const until = Date.now() + 3_600_000;
    expect(limitNotice(until, true)).toMatchObject({ line: { kind: 'error', text: expect.stringMatching(/reached until .+ – switching to your API key$/) }, activity: 'Switching to your API key' });
    expect(limitNotice(until, false)).toMatchObject({ line: { kind: 'error', text: expect.stringMatching(/waiting for it to reset at .+$/) }, activity: 'Rate limited – waiting' });
  });
});

describe('turnResult', () => {
  const result = (m: Record<string, unknown>) => ({ type: 'result', ...m }) as unknown as SDKResultMessage;
  it('takes a success’s text, structured output and what’s still queued', () => {
    expect(turnResult(result({ subtype: 'success', duration_ms: 12_400, num_turns: 3, result: 'Fixed it', is_error: false, queued_turn_count: 1, structured_output: { ok: true } }))).toEqual({
      line: { kind: 'success', text: '✔ Done in 12s · 3 turns' },
      result: { text: 'Fixed it', isError: false, queued: 1, structured: { ok: true } },
    });
  });

  it('fails with the errors, or the subtype when there are none', () => {
    expect(turnResult(result({ subtype: 'error_during_execution', errors: ['boom', 'bang'] }))).toEqual({
      line: { kind: 'error', text: '✘ error_during_execution: boom\nbang' },
      result: { text: 'boom\nbang', isError: true, queued: 0 },
    });
    expect(turnResult(result({ subtype: 'error_max_turns', errors: [] })).result.text).toBe('error_max_turns');
  });
});

describe('handleMessage', () => {
  it('reports the session’s id from init', () => {
    const { said, hooks } = recorder();
    const init = system({ subtype: 'init', session_id: 'worker', claude_code_version: '2', model: 'opus', permissionMode: 'auto' });
    handleMessage(init, context(), hooks);
    expect(said.sessions).toEqual(['worker']);
    expect(said.lines).toEqual([{ kind: 'system', text: '✻ Claude Code 2 · opus · auto' }]);
  });

  it('shows thinking, and the session’s own text, whole, as a reply and as what they’re doing', () => {
    const { said, hooks } = recorder();
    const msg = { type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '  First line\nSecond  ' }, { type: 'text', text: ' ' }] } } as unknown as SDKMessage;
    expect(handleMessage(msg, context(), hooks)).toBeNull();
    expect(said.lines).toEqual([{ kind: 'think', text: '' }, { kind: 'reply', text: 'First line\nSecond' }]);
    expect(entryLines(said.lines[0])).toEqual([{ kind: 'thinking', text: '✻ Thinking…' }]);
    expect(said.activity).toEqual([[null, 'Thinking…'], [null, 'First line']]);
  });

  it('keeps what it thought, when Claude Code shows it', () => {
    const { said, hooks } = recorder();
    const msg = { type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'thinking', thinking: '  The store is the slow part.\nCheck it first.  ' }] } } as unknown as SDKMessage;
    handleMessage(msg, context(), hooks);
    expect(said.lines).toEqual([{ kind: 'think', text: 'The store is the slow part.\nCheck it first.' }]);
  });

  it('gives a tool call all of its input, and a result all of its output', () => {
    const { said, hooks } = recorder();
    const ctx = context();
    const output = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    handleMessage({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'seq 50', description: 'Count' } }] } } as unknown as SDKMessage, ctx, hooks);
    handleMessage({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: output }] } } as unknown as SDKMessage, ctx, hooks);
    expect(said.lines).toEqual([
      { kind: 'call', id: 'toolu_1', tool: 'Bash', input: { command: 'seq 50', description: 'Count' }, cwd: '/w' },
      { kind: 'result', id: 'toolu_1', ok: true, text: output },
    ]);
    expect(said.activity).toContainEqual(['working', 'Running seq 50']);
  });

  it('reports a subagent’s model the first time it says, and its tool call as what it’s busy with', () => {
    const { said, hooks } = recorder();
    const ctx = context();
    const msg = { type: 'assistant', parent_tool_use_id: 'toolu_a', message: { id: 'm1', model: 'haiku', content: [{ type: 'tool_use', id: 'toolu_b', name: 'Read', input: { file_path: '/w/a.ts' } }] } } as unknown as SDKMessage;
    handleMessage(msg, ctx, hooks);
    handleMessage(msg, ctx, hooks);
    expect(said.helper.filter((e) => (e as { kind: string }).kind === 'model')).toEqual([{ kind: 'model', id: 'toolu_a', model: 'haiku' }]);
    expect(said.helper).toContainEqual(expect.objectContaining({ kind: 'activity', id: 'toolu_a' }));
    expect(said.helperLines.get('toolu_a')?.[0]).toEqual({ kind: 'system', text: '✻ haiku' });
    expect(said.lines).toEqual([]);
  });

  it('shows what a subagent’s busy with from its progress, and nothing for a task it doesn’t know', () => {
    const { said, hooks } = recorder();
    const ctx = context({ helpers: new Map([['t1', 'toolu_a']]) });
    handleMessage(system({ subtype: 'task_progress', task_id: 't1', last_tool_name: 'Grep' }), ctx, hooks);
    handleMessage(system({ subtype: 'task_progress', task_id: 't2', summary: 'Elsewhere' }), ctx, hooks);
    handleMessage(system({ subtype: 'task_progress', task_id: 't1' }), ctx, hooks);
    expect(said.helper).toEqual([{ kind: 'activity', id: 'toolu_a', activity: 'Using Grep' }]);
  });

  it('hands the session’s own task list over, with the structured result when it’s the message’s only one', () => {
    const { said, hooks } = recorder();
    const ctx = context();
    handleMessage({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [] } }] } } as unknown as SDKMessage, ctx, hooks);
    handleMessage({ type: 'user', parent_tool_use_id: null, tool_use_result: { newTodos: [] }, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'Updated' }] }] } } as unknown as SDKMessage, ctx, hooks);
    expect(said.tasks).toEqual([['TodoWrite', { todos: [] }, { newTodos: [] }, 'Updated']]);
    expect(ctx.calls.size).toBe(0);
  });

  it('puts an image the agent looked at on its laptop screen', () => {
    const { said, hooks } = recorder();
    const ctx = context({ calls: new Map([['t1', { name: 'Read', input: { file_path: '/w/shot.png' } }]]) });
    handleMessage({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] }] } } as unknown as SDKMessage, ctx, hooks);
    expect(said.frames).toEqual([expect.objectContaining({ url: '/w/shot.png', image: 'data:image/png;base64,AAAA' })]);
    expect(said.activity.at(-1)).toEqual([null, 'Looking at /w/shot.png']);
  });

  it('charges the session’s cost and returns a turn’s result', () => {
    const { said, hooks } = recorder();
    const msg = { type: 'result', subtype: 'success', total_cost_usd: 0.25, duration_ms: 1000, num_turns: 1, result: 'ok', is_error: false } as unknown as SDKMessage;
    expect(handleMessage(msg, context(), hooks)).toEqual({ text: 'ok', isError: false, queued: 0, structured: undefined });
    expect(said.costs).toEqual([0.25]);
    expect(said.lines).toEqual([{ kind: 'success', text: '✔ Done in 1s · 1 turns' }]);
  });
});

describe('a lead’s background commands, through handleMessage', () => {
  it('starts one as its task starts, learns its output file from the Bash result, and ends it', () => {
    const ctx = context({ calls: new Map([['toolu_b', { name: 'Bash', input: {} }]]) });
    ctx.tracker = new BackgroundTracker((id) => (id ? ctx.calls.get(id)?.name : undefined));
    const events: BackgroundEvent[] = [];
    const hooks = { lines: () => undefined, activity: () => undefined, background: (e: BackgroundEvent) => events.push(e) } as unknown as RunHooks;
    handleMessage(system({ subtype: 'task_started', task_type: 'local_bash', task_id: 'b1', tool_use_id: 'toolu_b', description: 'pnpm run dev', is_backgrounded: true }), ctx, hooks);
    handleMessage({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_b', content: 'Command running in background with ID: b1. Output is being written to: /t/s/tasks/b1.output. You will be notified' }] } } as unknown as SDKMessage, ctx, hooks);
    handleMessage(system({ subtype: 'task_notification', task_id: 'b1', status: 'stopped', summary: 'pnpm run dev' }), ctx, hooks);
    expect(events).toEqual([
      { kind: 'started', id: 'b1', task: 'shell', description: 'pnpm run dev' },
      { kind: 'output', id: 'b1', file: '/t/s/tasks/b1.output' },
      { kind: 'ended', id: 'b1', status: 'stopped', summary: 'pnpm run dev' },
    ]);
  });
});

describe('a message that isn’t the shape Claude Code documents, through handleMessage', () => {
  it('reads a tool call’s input that isn’t an object as no input', () => {
    const { said, hooks } = recorder();
    const ctx = context();
    handleMessage({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'TodoWrite', input: 'oops' }] } } as unknown as SDKMessage, ctx, hooks);
    expect(ctx.calls.get('t1')).toEqual({ name: 'TodoWrite', input: {} });
    expect(said.lines.length).toBeGreaterThan(0);
  });

  it('follows background commands past a result block that isn’t one, and takes no workflow from a result that isn’t an object', () => {
    const ctx = context({ calls: new Map([['toolu_b', { name: 'Bash', input: {} }]]) });
    ctx.tracker = new BackgroundTracker((id) => (id ? ctx.calls.get(id)?.name : undefined));
    const events: unknown[] = [];
    const hooks = { lines: () => undefined, activity: () => undefined, background: (e: unknown) => events.push(e), workflow: (e: unknown) => events.push(e) } as unknown as RunHooks;
    handleMessage(system({ subtype: 'task_started', task_type: 'local_bash', task_id: 'b1', tool_use_id: 'toolu_b', description: 'dev', is_backgrounded: true }), ctx, hooks);
    handleMessage({ type: 'user', parent_tool_use_id: null, tool_use_result: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_b', content: [null, { type: 'text', text: 'Command running in background with ID: b1. Output is being written to: /t/b1.output. You will' }] }] } } as unknown as SDKMessage, ctx, hooks);
    expect(events).toEqual([{ kind: 'started', id: 'b1', task: 'shell', description: 'dev' }, { kind: 'output', id: 'b1', file: '/t/b1.output' }]);
  });
});

describe('a helper’s own helper', () => {
  it('knows its parent: the helper whose Agent call started it', () => {
    const ctx = context({ parents: new Map() });
    const started: unknown[] = [];
    const hooks = { lines: () => undefined, activity: () => undefined, helper: (e: { kind: string }) => e.kind === 'started' && started.push(e), helperLines: () => undefined } as unknown as RunHooks;
    handleMessage({ type: 'assistant', parent_tool_use_id: 'toolu_parent', message: { content: [{ type: 'tool_use', id: 'toolu_child', name: 'Agent', input: { description: 'Find files', prompt: 'ls' } }] } } as unknown as SDKMessage, ctx, hooks);
    handleMessage(system({ subtype: 'task_started', task_type: 'local_agent', task_id: 't2', tool_use_id: 'toolu_child', description: 'Find files', subagent_type: 'Explore' }), ctx, hooks);
    expect(started).toEqual([{ kind: 'started', id: 'toolu_child', description: 'Find files', type: 'Explore', parent: 'toolu_parent' }]);
  });
});

describe('a subagent’s messages', () => {
  type Line = TermEntry;
  const messages = [
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { description: 'Map the cart', prompt: 'Find the cart store' } }] } },
    { type: 'system', subtype: 'task_started', task_type: 'local_agent', task_id: 't1', tool_use_id: 'toolu_1', description: 'Map the cart', subagent_type: 'Explore' },
    { type: 'assistant', parent_tool_use_id: 'toolu_1', message: { content: [{ type: 'text', text: 'Looking' }, { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/w/cart.ts' } }] } },
    { type: 'user', parent_tool_use_id: 'toolu_1', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'export const cart = []' }] } },
    { type: 'system', subtype: 'task_notification', task_id: 't1', status: 'completed', summary: 'The store holds a list' },
  ] as unknown as SDKMessage[];

  const run = (withTranscripts: boolean) => {
    const own: Line[] = [];
    const theirs = new Map<string, Line[]>();
    const hooks = {
      lines: (l: Line[]) => own.push(...l),
      activity: () => undefined,
      helper: () => undefined,
      ...(withTranscripts && { helperLines: (id: string, l: Line[]) => theirs.set(id, [...(theirs.get(id) ?? []), ...l]) }),
    } as unknown as RunHooks;
        const ctx = { cwd: '/w', calls: new Map(), helpers: new Map(), workflows: new Set(), probes: new Set(), commits: new Map(), parents: new Map() };
    for (const m of messages) handleMessage(m, ctx as unknown as RunContext, hooks);
    return { entries: own, own: own.flatMap(entryLines).map((l) => l.text), theirs: (theirs.get('toolu_1') ?? []).flatMap(entryLines).map((l) => l.text) };
  };

  it('go in a transcript of the helper’s own, starting with what it was asked, and stay out of the session’s', () => {
    const { own, theirs } = run(true);
    expect(own.join('\n')).not.toMatch(/Looking|cart\.ts|export const cart/);
    expect(theirs[0]).toBe('✻ Map the cart');
    expect(theirs[1]).toBe('▶ Find the cart store');
    expect(theirs.join('\n')).toMatch(/Looking[\s\S]*cart\.ts[\s\S]*export const cart/);
    expect(theirs.at(-1)).toBe('✔ Done');
  });

  it('go, indented, in the session’s own lines when nobody keeps helpers’ transcripts', () => {
    const { entries, own } = run(false);
    expect(entries).toContainEqual({ kind: 'reply', text: 'Looking', helper: 'toolu_1' });
    expect(entries).toContainEqual({ kind: 'call', id: 'toolu_2', tool: 'Read', input: { file_path: '/w/cart.ts' }, cwd: '/w', helper: 'toolu_1' });
    expect(own).toContain('    ⏺ Looking');
    expect(own).toContain('    ⏺ Read(cart.ts)');
    expect(own.join('\n')).not.toMatch(/export const cart/);
  });
});

describe('a workflow', () => {
  const script = "export const meta = { name: 'review-changes', phases: [{ title: 'Review' }] }";
  const messages = [
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_9', name: 'Workflow', input: { script } }] } },
    { type: 'system', subtype: 'task_started', task_type: 'local_workflow', task_id: 'w1', tool_use_id: 'toolu_9', description: 'Review the diff', workflow_name: 'review-changes' },
    { type: 'system', subtype: 'task_progress', task_id: 'w1', description: 'Review: review:bugs', usage: {}, workflow_progress: [
      { type: 'workflow_phase', index: 1, title: 'Review' },
      { type: 'workflow_agent', index: 1, label: 'review:bugs', phaseIndex: 1, state: 'start', startedAt: 3, promptPreview: 'Find bugs' },
    ] },
    { type: 'system', subtype: 'task_notification', task_id: 'w1', status: 'completed', summary: 'Dynamic workflow completed', usage: { total_tokens: 4200, tool_uses: 31, duration_ms: 9000 } },
  ] as unknown as SDKMessage[];

  it('starts with its script, reports how its phases and agents stand, and ends with what it used, without seating a helper', () => {
    const events: WorkflowEvent[] = [];
    const helpers: unknown[] = [];
    const hooks = { lines: () => undefined, activity: () => undefined, helper: (e: unknown) => helpers.push(e), workflow: (e: WorkflowEvent) => events.push(e) } as unknown as RunHooks;
        const ctx = { cwd: '/w', calls: new Map(), helpers: new Map(), workflows: new Set(), probes: new Set(), commits: new Map(), parents: new Map() };
    for (const m of messages) handleMessage(m, ctx as unknown as RunContext, hooks);
    expect(events).toEqual([
      { kind: 'started', id: 'w1', name: 'review-changes', description: 'Review the diff', script },
      { kind: 'progress', id: 'w1', phases: [{ index: 1, title: 'Review', queued: 0, working: 1, done: 0, failed: 0 }], agents: [{ index: 1, label: 'review:bugs', phase: 1, status: 'working', model: undefined, activity: 'Find bugs' }], roll: [{ label: 'review:bugs', phase: 1, status: 'working' }] },
      { kind: 'ended', id: 'w1', ok: true, usage: { tokens: 4200, toolUses: 31 } },
    ]);
    expect(helpers).toEqual([]);
  });
});

describe('a script run from the scratch dir', () => {
  const bash = (id: string, command: string, parent: string | null = null) => ({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  const result = (id: string, content: string, isError = false, parent: string | null = null) => ({ type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
  const run = (messages: unknown[]) => {
    const probes: ProbeEvent[] = [];
    const hooks = { lines: () => undefined, activity: () => undefined, helper: () => undefined, helperLines: () => undefined, probe: (e: ProbeEvent) => probes.push(e) } as unknown as RunHooks;
        const ctx = { cwd: '/w', calls: new Map(), helpers: new Map(), workflows: new Set(), modelled: new Set(), scratch: '/tmp/focus-scratch/lead_x', probes: new Set(), commits: new Map() };
    for (const m of messages) handleMessage(m as SDKMessage, ctx as unknown as RunContext, hooks);
    return probes;
  };

  it('is a probe: launched as the command starts, ended with how it exited and the first line it printed', () => {
    expect(run([bash('toolu_1', 'npx tsx "$FOCUS_SCRATCH/render.ts"'), result('toolu_1', '\n[[1,122,421]]\nmore')])).toEqual([
      { kind: 'started', id: 'toolu_1', description: 'Script render.ts', type: 'script' },
      { kind: 'ended', id: 'toolu_1', ok: true, summary: '[[1,122,421]]' },
    ]);
    expect(run([bash('toolu_2', 'node "$FOCUS_SCRATCH/x.mjs"'), result('toolu_2', 'Error: boom', true)]).at(-1)).toEqual({ kind: 'ended', id: 'toolu_2', ok: false, summary: 'Error: boom' });
  });

  it('isn’t when it only writes a scratch file, or when it’s a subagent’s', () => {
    expect(run([bash('toolu_3', 'cat > "$FOCUS_SCRATCH/a.ts" <<\'EOF\'\nx\nEOF'), result('toolu_3', '')])).toEqual([]);
    expect(run([bash('toolu_4', 'node "$FOCUS_SCRATCH/x.mjs"', 'toolu_agent'), result('toolu_4', 'ok', false, 'toolu_agent')])).toEqual([]);
  });
});

describe('the background tasks', () => {
  it('are what Claude Code last listed, leaving out the ambient ones', () => {
        const ctx: { background?: string[] } & Record<string, unknown> = { cwd: '/w', calls: new Map(), helpers: new Map(), workflows: new Set(), parents: new Map() };
    const hooks = { lines: () => undefined, activity: () => undefined } as unknown as RunHooks;
    const changed = (tasks: unknown[]) => ({ type: 'system', subtype: 'background_tasks_changed', tasks }) as unknown as SDKMessage;
    handleMessage(changed([{ task_id: 'w1', task_type: 'local_workflow', description: 'Review' }, { task_id: 'm1', task_type: 'monitor', description: 'Watch', ambient: true }]), ctx as unknown as RunContext, hooks);
    expect(ctx.background).toEqual(['local_workflow']);
    handleMessage(changed([]), ctx as unknown as RunContext, hooks);
    expect(ctx.background).toEqual([]);
  });
});

describe('a commit', () => {
  const bash = (id: string, command: string) => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  const result = (id: string, isError = false) => ({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content: '', is_error: isError }] } });
  it('counts once git says it worked, with its message', () => {
    const commits: (string | undefined)[] = [];
    const hooks = { lines: () => undefined, activity: () => undefined, commit: (m?: string) => commits.push(m) } as unknown as RunHooks;
        const ctx = { cwd: '/w', calls: new Map(), helpers: new Map(), workflows: new Set(), modelled: new Set(), probes: new Set(), commits: new Map() };
    const heredoc = `git commit -m "$(cat <<'EOF'\nShow the slice under way\n\nBody\nEOF\n)"`;
    for (const m of [bash('t1', 'git add -A && git commit -m "Heading on the chart"'), result('t1'), bash('t2', 'git commit -m "Nothing to commit"'), result('t2', true), bash('t3', heredoc), result('t3')]) handleMessage(m as SDKMessage, ctx as unknown as RunContext, hooks);
    expect(commits).toEqual(['Heading on the chart', 'Show the slice under way']);
  });
});
