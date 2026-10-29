import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Autonomy, TermLine } from '../../shared/types';
import type { BrowserPool } from './browserTool';
import { ClaudeRunner, claudeConfig, DECLINED, UNANSWERED, Listening, permissionAsk, permissionOptions, sessionHooks, toolPermission } from './claudeRunner';
import { WorkflowPermits } from './workflows';
import { type ProbeEvent, type RunHooks, type WorkflowEvent } from './types';

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
    const ctx = { cwd: '/w', calls: new Map(), helpers: new Map(), workflows: new Set(), probes: new Set(), commits: new Map(), parents: new Map() };
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
    const ctx = { cwd: '/w', calls: new Map(), helpers: new Map(), workflows: new Set(), probes: new Set(), commits: new Map(), parents: new Map() };
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
    const ctx = { cwd: '/w', calls: new Map(), helpers: new Map(), workflows: new Set(), modelled: new Set(), scratch: '/tmp/focus-scratch/lead_x', probes: new Set(), commits: new Map() };
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

  // a message that went in as the turn ended isn't in the result's queued count, but Claude Code takes it in a turn
  it('waits for the turn a message sent as the turn ended gets, and stops once it’s over', () => {
    const { closed, listening } = session();
    listening.messageSent();
    listening.turnEnded(false);
    expect(closed.count).toBe(0);
    listening.turnStarted();
    listening.heard();
    vi.advanceTimersByTime(5000);
    expect(closed.count).toBe(0);
    listening.turnEnded(false);
    expect(closed).toEqual({ count: 1, waited: [false] });
  });

  it('stops after the grace if no turn comes for a message sent as the turn ended', () => {
    const { closed, listening } = session();
    listening.messageSent();
    listening.turnEnded(false);
    vi.advanceTimersByTime(999);
    expect(closed.count).toBe(0);
    vi.advanceTimersByTime(1);
    expect(closed).toEqual({ count: 1, waited: [false] });
  });

  it('stops at once when Claude Code said something after the message: it took it in the turn', () => {
    const { closed, listening } = session();
    listening.messageSent();
    listening.heard();
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
    const ctx: { background?: string[] } & Record<string, unknown> = { cwd: '/w', calls: new Map(), helpers: new Map(), workflows: new Set(), parents: new Map() };
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
    const ctx = { cwd: '/w', calls: new Map(), helpers: new Map(), workflows: new Set(), modelled: new Set(), probes: new Set(), commits: new Map() };
    const heredoc = `git commit -m "$(cat <<'EOF'\nShow the slice under way\n\nBody\nEOF\n)"`;
    for (const m of [bash('t1', 'git add -A && git commit -m "Heading on the chart"'), result('t1'), bash('t2', 'git commit -m "Nothing to commit"'), result('t2', true), bash('t3', heredoc), result('t3')]) runner.handle(m as SDKMessage, ctx, hooks);
    expect(commits).toEqual(['Heading on the chart', 'Show the slice under way']);
  });
});

describe('permissionAsk', () => {
  it('names a workflow, and what approving it means', () => {
    expect(permissionAsk('Workflow', { script: "export const meta = { name: 'review-changes' }" }, 'Run a workflow')).toBe('Run workflow review-changes: its agents run their commands without asking, for this run');
  });

  it("takes Claude Code's own title over Ops' summary", () => {
    expect(permissionAsk('Bash', { command: 'git clean -fdx' }, 'Clean the checkout')).toBe('Clean the checkout');
  });

  it('shows a command, else the file, URL or pattern a tool is on, else its first input', () => {
    expect(permissionAsk('Bash', { command: 'git push', description: 'Push' })).toBe('Bash(git push)');
    expect(permissionAsk('Bash', {})).toBe('Bash()');
    expect(permissionAsk('Edit', { old_string: 'a', file_path: '/repo/a.ts' })).toBe('Edit(/repo/a.ts)');
    expect(permissionAsk('WebFetch', { prompt: 'p', url: 'https://example.com' })).toBe('WebFetch(https://example.com)');
    expect(permissionAsk('Grep', { path: 'src', pattern: 'TODO' })).toBe('Grep(TODO)');
    expect(permissionAsk('mcp__office__ship', { repos: ['a'] })).toBe('mcp__office__ship(["a"])');
    expect(permissionAsk('mcp__office__status', {})).toBe('mcp__office__status("")');
  });

  it('cuts a long command short', () => {
    expect(permissionAsk('Bash', { command: 'x'.repeat(400) }).length).toBeLessThan(320);
  });
});

describe('toolPermission', () => {
  const input = { command: 'git push' };
  const call = (extra: { agentID?: string; toolUseID?: string; title?: string } = {}) => ({ signal: new AbortController().signal, toolUseID: 't1', requestId: 'r1', ...extra });
  const setup = (answer: boolean) => {
    const asked: string[] = [];
    const waits: number[] = [];
    const permits = new WorkflowPermits();
    const session: { mode: Autonomy } = { mode: 'ask' };
    const ask = (tool: string, summary: string) => {
      asked.push(`${tool}: ${summary}`);
      return Promise.resolve(answer);
    };
    const wait = (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    };
    const questioned: unknown[] = [];
    const question = (q: unknown) => (questioned.push(q), Promise.resolve(answer ? { 'Grid or list?': 'Grid' } : undefined));
    return { asked, waits, permits, session, questioned, canUseTool: toolPermission(() => session.mode, permits, ask, question, wait) };
  };

  it('hands a question for the user to the question hook, whatever the mode, and their answers back to Claude Code', async () => {
    const q = { questions: [{ question: 'Grid or list?', header: 'Layout', multiSelect: false, options: [{ label: 'Grid', description: 'Rows' }, { label: 'List', description: 'Lines' }] }] };
    for (const mode of ['ask', 'full'] as const) {
      const { asked, questioned, session, canUseTool } = setup(true);
      session.mode = mode;
      expect(await canUseTool('AskUserQuestion', q, call())).toEqual({ behavior: 'allow', updatedInput: { ...q, answers: { 'Grid or list?': 'Grid' } } });
      expect(questioned).toEqual([q]);
      expect(asked).toEqual([]);
    }
    expect(await setup(false).canUseTool('AskUserQuestion', q, call())).toEqual({ behavior: 'deny', message: UNANSWERED });
    expect(await setup(true).canUseTool('AskUserQuestion', { questions: [{ question: 'Hm?' }] }, call())).toMatchObject({ behavior: 'deny' });
  });

  it("lets through what the session's mode allows, without asking", async () => {
    const { asked, canUseTool } = setup(false);
    expect(await canUseTool('Edit', input, call())).toEqual({ behavior: 'allow', updatedInput: input });
    expect(asked).toEqual([]);
  });

  it('asks the captain the rest, and passes on their answer', async () => {
    const yes = setup(true);
    expect(await yes.canUseTool('Bash', input, call())).toEqual({ behavior: 'allow', updatedInput: input });
    expect(yes.asked).toEqual(['Bash: Bash(git push)']);
    const no = setup(false);
    expect(await no.canUseTool('Bash', input, call({ title: 'Push the branch' }))).toEqual({ behavior: 'deny', message: DECLINED });
    expect(no.asked).toEqual(['Bash: Push the branch']);
  });

  it('follows the mode the captain changed it to mid-session', async () => {
    const { asked, session, canUseTool } = setup(false);
    session.mode = 'full';
    expect(await canUseTool('Bash', input, call())).toEqual({ behavior: 'allow', updatedInput: input });
    session.mode = 'auto';
    expect((await canUseTool('Edit', input, call())).behavior).toBe('deny');
    expect(asked).toEqual(['Edit: Edit(git push)']);
  });

  it('lets an approved workflow’s agents run without asking, for that run', async () => {
    const { asked, permits, canUseTool } = setup(true);
    expect((await canUseTool('Workflow', { name: 'fan-out' }, call({ toolUseID: 'w1' }))).behavior).toBe('allow');
    permits.started('wf_1', 'w1');
    permits.seen('wf_1', [{ agentId: 'helper' }]);
    expect(await canUseTool('Bash', input, call({ agentID: 'helper' }))).toEqual({ behavior: 'allow', updatedInput: input });
    expect(asked).toEqual(['Workflow: Run workflow fan-out: its agents run their commands without asking, for this run']);
    permits.ended('wf_1');
    await canUseTool('Bash', input, call({ agentID: 'helper' }));
    expect(asked).toHaveLength(2);
  });

  it("doesn't approve a workflow the captain declined", async () => {
    const { permits, canUseTool } = setup(false);
    await canUseTool('Workflow', { name: 'fan-out' }, call({ toolUseID: 'w1' }));
    permits.started('wf_1', 'w1');
    permits.seen('wf_1', [{ agentId: 'helper' }]);
    expect((await canUseTool('Bash', input, call({ agentID: 'helper' }))).behavior).toBe('deny');
  });

  it('gives a workflow’s progress up to 2 s to name an agent, then asks', async () => {
    const { asked, waits, permits, canUseTool } = setup(true);
    permits.approveCall('w1');
    permits.started('wf_1', 'w1');
    await canUseTool('Bash', input, call({ agentID: 'stranger' }));
    expect(waits).toEqual(Array<number>(10).fill(200));
    expect(asked).toEqual(['Bash: Bash(git push)']);
  });

  it('stops waiting once the progress names the agent', async () => {
    const { asked, waits, permits, canUseTool } = setup(false);
    permits.approveCall('w1');
    permits.started('wf_1', 'w1');
    const pending = canUseTool('Bash', input, call({ agentID: 'helper' }));
    permits.seen('wf_1', [{ agentId: 'helper' }]);
    expect((await pending).behavior).toBe('allow');
    expect(waits).toEqual([200]);
    expect(asked).toEqual([]);
  });
});

describe('permissionOptions', () => {
  const canUseTool = () => Promise.resolve({ behavior: 'allow' as const, updatedInput: {} });
  const rules = ['Bash(git status:*)'];

  it('starts a session able to switch to any mode', () => {
    for (const [mode, permissionMode] of [['ask', 'acceptEdits'], ['auto', 'auto'], ['full', 'bypassPermissions']] as const) {
      expect(permissionOptions(mode, rules, canUseTool)).toEqual({ permissionMode, allowDangerouslySkipPermissions: true, allowedTools: rules, canUseTool });
    }
  });
});

describe('a session’s hooks', () => {
  const signal = new AbortController().signal;
  const post = (file: string) => ({ hook_event_name: 'PostToolUse' as const, tool_name: 'Edit', tool_input: { file_path: file }, tool_response: {}, tool_use_id: 't1', session_id: 's', transcript_path: '', cwd: '/ws/l1' });

  it('reads a lead’s brief again as an edit of it finishes, and gives it back once the conversation’s compacted', async () => {
    const edited = vi.fn();
    const hooks = sessionHooks({ cwd: '/ws/l1', brief: { edited, afterCompact: () => 'The goal: Saved items' } });
    const [onEdit] = hooks?.PostToolUse ?? [];
    expect(onEdit.matcher).toBe('Write|Edit|MultiEdit');
    await onEdit.hooks[0](post('/ws/l1/web/src/app.ts'), 't1', { signal });
    expect(edited).not.toHaveBeenCalled();
    await onEdit.hooks[0](post('/ws/l1/brief.md'), 't1', { signal });
    expect(edited).toHaveBeenCalledOnce();
    const [onStart] = hooks?.SessionStart ?? [];
    expect(onStart.matcher).toBe('compact');
    expect(await onStart.hooks[0]({ hook_event_name: 'SessionStart', source: 'compact', session_id: 's', transcript_path: '', cwd: '/ws/l1' }, undefined, { signal })).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'The goal: Saved items' },
    });
  });

  it('keeps the scratch dir’s guard on Bash, and has none for a session with neither', () => {
    const guard = () => Promise.resolve({});
    expect(sessionHooks({ cwd: '/ws/a1' }, guard)).toEqual({ PreToolUse: [{ matcher: 'Bash', hooks: [guard] }] });
    expect(sessionHooks({ cwd: '/ws/a1' })).toBeUndefined();
  });
});
