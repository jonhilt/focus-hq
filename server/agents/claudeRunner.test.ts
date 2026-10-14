import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TermLine } from '../../shared/types';
import type { BrowserPool } from './browserTool';
import { allowedWithoutAsking, ClaudeRunner, claudeConfig, endedOutcome, failedOutcome, holdsInput, Listening, permissionOptions, runningInBackground, withResult, type SoFar } from './claudeRunner';
import { CLOUD_UNAVAILABLE } from './cloud';
import { LIMIT_REACHED, STOPPED_BY_CAPTAIN, type ProbeEvent, type RunHooks, type WorkflowEvent } from './types';

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
    const ctx = { cwd: '/w', cloud: false, calls: new Map(), helpers: new Map(), workflows: new Set(), probes: new Set(), commits: new Map(), parents: new Map() };
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
    const runner = new ClaudeRunner(null as unknown as BrowserPool) as unknown as { handle(m: SDKMessage, ctx: unknown, h: RunHooks): unknown };
    const ctx = { cwd: '/w', cloud: false, calls: new Map(), helpers: new Map(), workflows: new Set(), probes: new Set(), commits: new Map(), parents: new Map() };
    for (const m of messages) runner.handle(m, ctx, hooks);
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
    const runner = new ClaudeRunner(null as unknown as BrowserPool) as unknown as { handle(m: SDKMessage, ctx: unknown, h: RunHooks): unknown };
    const ctx = { cwd: '/w', cloud: false, calls: new Map(), helpers: new Map(), workflows: new Set(), modelled: new Set(), scratch: '/tmp/focus-scratch/lead_x', probes: new Set(), commits: new Map() };
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
  it('keeps listening while anything runs in the background: a workflow, a subagent, a command or a monitor', () => {
    expect(holdsInput(['local_workflow'])).toBe(true);
    expect(holdsInput(['local_agent'])).toBe(true);
    expect(holdsInput(['local_bash'])).toBe(true);
  });

  it('doesn’t once nothing does', () => {
    expect(holdsInput([])).toBe(false);
  });
});

describe('runningInBackground', () => {
  it('is what Claude Code listed', () => {
    expect(runningInBackground(['local_bash'], 0)).toEqual(['local_bash']);
    expect(runningInBackground(['local_workflow'], 1)).toEqual(['local_workflow']);
  });

  it('counts a workflow the office has seen start and not end, even when the list leaves it out', () => {
    expect(runningInBackground([], 1)).toEqual(['local_workflow']);
    expect(holdsInput(runningInBackground([], 2))).toBe(true);
  });
});

describe('Listening', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const session = () => {
    const closed = { count: 0, waited: [] as boolean[] };
    return { closed, listening: new Listening((waited) => (closed.count++, closed.waited.push(waited)), 1000) };
  };

  it('stops once a turn is over with nothing queued and nothing in the background', () => {
    const { closed, listening } = session();
    listening.turnEnded(false);
    expect(closed.count).toBe(1);
  });

  it('keeps listening while a message is queued, or a task runs in the background', () => {
    const { closed, listening } = session();
    listening.turnEnded(true);
    listening.backgroundChanged(['local_bash']);
    listening.turnStarted();
    listening.turnEnded(false);
    expect(closed.count).toBe(0);
  });

  // the cause of "The user doesn't want to take this action right now": the turn that took a background command's
  // result found the input closed, and Claude Code cancelled every tool that needed approval
  it('keeps listening through the turn Claude Code takes when the background task ends, and stops once it’s over', () => {
    const { closed, listening } = session();
    listening.backgroundChanged(['local_bash']);
    listening.turnEnded(false);
    listening.backgroundChanged([]);
    expect(closed.count).toBe(0);
    listening.turnStarted();
    vi.advanceTimersByTime(5000);
    expect(closed.count).toBe(0);
    listening.turnEnded(false);
    expect(closed.count).toBe(1);
  });

  it('stops after a while when no turn comes once the background task ends', () => {
    const { closed, listening } = session();
    listening.backgroundChanged(['local_workflow']);
    listening.turnEnded(false);
    listening.backgroundChanged([]);
    vi.advanceTimersByTime(999);
    expect(closed.count).toBe(0);
    vi.advanceTimersByTime(1);
    expect(closed.count).toBe(1);
    expect(closed.waited).toEqual([true]);
  });

  it('doesn’t wait for a turn when a background task ends during one', () => {
    const { closed, listening } = session();
    listening.backgroundChanged(['local_bash']);
    listening.backgroundChanged([]);
    vi.advanceTimersByTime(5000);
    expect(closed.count).toBe(0);
    listening.turnEnded(false);
    expect(closed.count).toBe(1);
  });
});

describe('the background tasks', () => {
  it('are what Claude Code last listed, leaving out the ambient ones', () => {
    const runner = new ClaudeRunner(null as unknown as BrowserPool) as unknown as { handle(m: SDKMessage, ctx: unknown, h: RunHooks): unknown };
    const ctx: { background?: string[] } & Record<string, unknown> = { cwd: '/w', cloud: false, calls: new Map(), helpers: new Map(), workflows: new Set(), parents: new Map() };
    const hooks = { lines: () => undefined, activity: () => undefined } as unknown as RunHooks;
    const changed = (tasks: unknown[]) => ({ type: 'system', subtype: 'background_tasks_changed', tasks }) as unknown as SDKMessage;
    runner.handle(changed([{ task_id: 'w1', task_type: 'local_workflow', description: 'Review' }, { task_id: 'm1', task_type: 'monitor', description: 'Watch', ambient: true }]), ctx, hooks);
    expect(ctx.background).toEqual(['local_workflow']);
    runner.handle(changed([]), ctx, hooks);
    expect(ctx.background).toEqual([]);
  });
});

describe('a commit', () => {
  const bash = (id: string, command: string) => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  const result = (id: string, isError = false) => ({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content: '', is_error: isError }] } });
  it('counts once git says it worked, with its message', () => {
    const commits: (string | undefined)[] = [];
    const hooks = { lines: () => undefined, activity: () => undefined, commit: (m?: string) => commits.push(m) } as unknown as RunHooks;
    const runner = new ClaudeRunner(null as unknown as BrowserPool) as unknown as { handle(m: SDKMessage, ctx: unknown, h: RunHooks): unknown };
    const ctx = { cwd: '/w', cloud: false, calls: new Map(), helpers: new Map(), workflows: new Set(), modelled: new Set(), probes: new Set(), commits: new Map() };
    const heredoc = `git commit -m "$(cat <<'EOF'\nShow the slice under way\n\nBody\nEOF\n)"`;
    for (const m of [bash('t1', 'git add -A && git commit -m "Heading on the chart"'), result('t1'), bash('t2', 'git commit -m "Nothing to commit"'), result('t2', true), bash('t3', heredoc), result('t3')]) runner.handle(m as SDKMessage, ctx, hooks);
    expect(commits).toEqual(['Heading on the chart', 'Show the slice under way']);
  });
});

describe('allowedWithoutAsking', () => {
  it('lets ask mode use its plain tools and the browser, and nothing else', () => {
    expect(allowedWithoutAsking('ask', 'Edit')).toBe(true);
    expect(allowedWithoutAsking('ask', 'mcp__browser__open')).toBe(true);
    expect(allowedWithoutAsking('ask', 'Bash')).toBe(false);
    expect(allowedWithoutAsking('ask', 'mcp__office__ship')).toBe(false);
  });

  it('asks the classifier in auto mode, and never asks in full', () => {
    expect(allowedWithoutAsking('auto', 'Edit')).toBe(false);
    expect(allowedWithoutAsking('full', 'Bash')).toBe(true);
    expect(allowedWithoutAsking('full', 'mcp__office__ship')).toBe(true);
  });
});

describe('permissionOptions', () => {
  const canUseTool = () => Promise.resolve({ behavior: 'allow' as const, updatedInput: {} });
  const rules = ['Bash(git status:*)'];

  it('starts a local session able to switch to any mode', () => {
    for (const [mode, permissionMode] of [['ask', 'acceptEdits'], ['auto', 'auto'], ['full', 'bypassPermissions']] as const) {
      expect(permissionOptions(mode, false, rules, canUseTool)).toEqual({ permissionMode, allowDangerouslySkipPermissions: true, allowedTools: rules, canUseTool });
    }
  });

  it("gives a cloud session only what its turn's mode needs", () => {
    expect(permissionOptions('full', true, rules, canUseTool)).toEqual({ permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true });
    expect(permissionOptions('auto', true, rules, canUseTool)).toEqual({ permissionMode: 'auto', canUseTool });
    expect(permissionOptions('ask', true, rules, canUseTool)).toEqual({ permissionMode: 'acceptEdits', allowedTools: rules, canUseTool });
  });
});

describe('a session’s outcome', () => {
  const fresh: SoFar = { ok: false, summary: '', started: true };
  const answered = withResult(fresh, { text: 'Done', isError: false, queued: 0, structured: { verdict: 'pass' } });
  const calm = { stopping: false, limited: false };
  const failure = { ...calm, aborted: false, cloud: false, stderr: '' };

  it('is its last turn’s result, keeping the structured answer when a later turn gives none', () => {
    const later = withResult(answered, { text: 'And a follow-up', isError: false, queued: 0 });
    expect(endedOutcome(later, calm)).toEqual({ ok: true, summary: 'And a follow-up', structured: { verdict: 'pass' }, started: true });
  });

  it('fails with the turn’s text when the last turn was an error, after one that passed', () => {
    const failed = withResult(answered, { text: 'Prompt is too long', isError: true, queued: 0 });
    expect(endedOutcome(failed, calm)).toMatchObject({ ok: false, summary: 'Prompt is too long', error: 'Prompt is too long' });
  });

  it('is a stop when the captain sent them home, even once the usage limit was reached too', () => {
    expect(endedOutcome(answered, { stopping: true, limited: true })).toEqual({ ok: false, summary: 'Done', error: STOPPED_BY_CAPTAIN, aborted: true, started: true });
  });

  it('is the usage limit when that ended the session', () => {
    expect(endedOutcome(answered, { stopping: false, limited: true })).toEqual({ ok: false, summary: 'Done', error: LIMIT_REACHED, limited: true, started: true });
  });

  it('is the usage limit when Claude Code throws after reaching it, unless the captain stopped them', () => {
    expect(failedOutcome(answered, new Error('aborted'), { ...failure, limited: true, aborted: true })).toMatchObject({ error: LIMIT_REACHED, limited: true });
    expect(failedOutcome(answered, new Error('aborted'), { ...failure, limited: true, stopping: true })).toMatchObject({ error: STOPPED_BY_CAPTAIN, aborted: true });
  });

  it('is a stop when Claude Code throws because the session was aborted', () => {
    expect(failedOutcome(fresh, new Error('Claude Code process aborted'), { ...failure, aborted: true })).toEqual({ ok: false, summary: '', error: STOPPED_BY_CAPTAIN, aborted: true, started: true });
  });

  it('is the cloud being unavailable when the CLI refused to start a cloud session, and only for a cloud session', () => {
    const refusal = { ...failure, stderr: 'Error: --cloud requires an interactive terminal\n' };
    expect(failedOutcome({ ...fresh, started: false }, new Error('exited with code 1'), { ...refusal, cloud: true })).toEqual({ ok: false, summary: '', error: CLOUD_UNAVAILABLE, started: false });
    expect(failedOutcome(fresh, new Error('exited with code 1'), refusal).error).not.toBe(CLOUD_UNAVAILABLE);
  });

  it('is the error, with the last three lines Claude Code wrote, otherwise', () => {
    const stderr = 'one\ntwo\nthree\nfour\n';
    expect(failedOutcome(answered, new Error('exited with code 1'), { ...failure, stderr })).toEqual({ ok: false, summary: 'Done', error: 'exited with code 1 — two three four', started: true });
    expect(failedOutcome(answered, new Error('exited with code 1'), failure).error).toBe('exited with code 1');
  });
});
