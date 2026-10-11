import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TermLine } from '../../shared/types';
import type { BrowserPool } from './browserTool';
import { ClaudeRunner, claudeConfig, holdsInput } from './claudeRunner';
import type { ProbeEvent, RunHooks, WorkflowEvent } from './types';

describe('claudeConfig', () => {
  it('loads every settings source, and nothing else, with your own CLAUDE.md on', () => {
    expect(claudeConfig(true, '/home/me/.claude')).toEqual({ settingSources: ['user', 'project', 'local'] });
  });

  it('keeps every settings source but leaves out your own CLAUDE.md and rules with it off', () => {
    expect(claudeConfig(false, '/home/me/.claude')).toEqual({
      settingSources: ['user', 'project', 'local'],
      settings: { claudeMdExcludes: ['/home/me/.claude/CLAUDE.md', '/home/me/.claude/rules/**'] },
    });
  });
});

describe('a subagent’s messages', () => {
  type Line = Omit<TermLine, 't'>;
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
    const runner = new ClaudeRunner(null as unknown as BrowserPool) as unknown as { handle(m: SDKMessage, ctx: unknown, h: RunHooks): unknown };
    const ctx = { cwd: '/w', cloud: false, calls: new Map(), helpers: new Map(), workflows: new Set(), probes: new Set() };
    for (const m of messages) runner.handle(m, ctx, hooks);
    return { own: own.map((l) => l.text), theirs: (theirs.get('toolu_1') ?? []).map((l) => l.text) };
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
    const { own } = run(false);
    expect(own).toContain('    ⏺ Looking');
    expect(own.join('\n')).not.toMatch(/export const cart/);
  });
});

describe('a workflow', () => {
  const messages = [
    { type: 'system', subtype: 'task_started', task_type: 'local_workflow', task_id: 'w1', tool_use_id: 'toolu_9', description: 'Review the diff', workflow_name: 'review-changes' },
    { type: 'system', subtype: 'task_progress', task_id: 'w1', description: 'Review: review:bugs', usage: {}, workflow_progress: [
      { type: 'workflow_phase', index: 1, title: 'Review' },
      { type: 'workflow_agent', index: 1, label: 'review:bugs', phaseIndex: 1, state: 'start', startedAt: 3, promptPreview: 'Find bugs' },
    ] },
    { type: 'system', subtype: 'task_notification', task_id: 'w1', status: 'completed', summary: 'Dynamic workflow completed' },
  ] as unknown as SDKMessage[];

  it('starts, reports how its phases and agents stand, and ends, without seating a helper', () => {
    const events: WorkflowEvent[] = [];
    const helpers: unknown[] = [];
    const hooks = { lines: () => undefined, activity: () => undefined, helper: (e: unknown) => helpers.push(e), workflow: (e: WorkflowEvent) => events.push(e) } as unknown as RunHooks;
    const runner = new ClaudeRunner(null as unknown as BrowserPool) as unknown as { handle(m: SDKMessage, ctx: unknown, h: RunHooks): unknown };
    const ctx = { cwd: '/w', cloud: false, calls: new Map(), helpers: new Map(), workflows: new Set(), probes: new Set() };
    for (const m of messages) runner.handle(m, ctx, hooks);
    expect(events).toEqual([
      { kind: 'started', id: 'w1', name: 'review-changes', description: 'Review the diff' },
      { kind: 'progress', id: 'w1', phases: [{ index: 1, title: 'Review', queued: 0, working: 1, done: 0, failed: 0 }], agents: [{ index: 1, label: 'review:bugs', phase: 1, status: 'working', model: undefined, activity: 'Find bugs' }] },
      { kind: 'ended', id: 'w1', ok: true },
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
    const runner = new ClaudeRunner(null as unknown as BrowserPool) as unknown as { handle(m: SDKMessage, ctx: unknown, h: RunHooks): unknown };
    const ctx = { cwd: '/w', cloud: false, calls: new Map(), helpers: new Map(), workflows: new Set(), modelled: new Set(), scratch: '/tmp/focus-scratch/lead_x', probes: new Set() };
    for (const m of messages) runner.handle(m as SDKMessage, ctx, hooks);
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

describe('holdsInput', () => {
  it('keeps listening while a workflow or a background subagent runs', () => {
    expect(holdsInput(['local_workflow'])).toBe(true);
    expect(holdsInput(['local_bash', 'local_agent'])).toBe(true);
  });

  it('doesn’t for a background shell or monitor, which can run for as long as it likes, or for nothing at all', () => {
    expect(holdsInput(['local_bash'])).toBe(false);
    expect(holdsInput(['monitor', 'mcp_task'])).toBe(false);
    expect(holdsInput([])).toBe(false);
  });
});

describe('the background tasks', () => {
  it('are what Claude Code last listed, leaving out the ambient ones', () => {
    const runner = new ClaudeRunner(null as unknown as BrowserPool) as unknown as { handle(m: SDKMessage, ctx: unknown, h: RunHooks): unknown };
    const ctx: { background?: string[] } & Record<string, unknown> = { cwd: '/w', cloud: false, calls: new Map(), helpers: new Map(), workflows: new Set() };
    const hooks = { lines: () => undefined, activity: () => undefined } as unknown as RunHooks;
    const changed = (tasks: unknown[]) => ({ type: 'system', subtype: 'background_tasks_changed', tasks }) as unknown as SDKMessage;
    runner.handle(changed([{ task_id: 'w1', task_type: 'local_workflow', description: 'Review' }, { task_id: 'm1', task_type: 'monitor', description: 'Watch', ambient: true }]), ctx, hooks);
    expect(ctx.background).toEqual(['local_workflow']);
    runner.handle(changed([]), ctx, hooks);
    expect(ctx.background).toEqual([]);
  });
});
