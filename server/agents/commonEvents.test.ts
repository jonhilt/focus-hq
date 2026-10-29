import type { ConversationEvent } from 'agent-host';
import { describe, expect, it } from 'vitest';
import type { TermLine } from '../../shared/types';
import type { BackgroundEvent } from './backgroundTasks';
import { backgroundEvents, focusTool, handleCommonEvent, newCommonContext, patchLines } from './commonEvents';
import type { HelperEvent, RunHooks } from './types';

const main = { _tag: 'Main' as const };
const sub = { _tag: 'Subagent' as const, id: 'child' };

function recorder() {
  const lines: Omit<TermLine, 't'>[] = [];
  const helperLines: [string, string][] = [];
  const helpers: HelperEvent[] = [];
  const background: BackgroundEvent[] = [];
  const sessions: [string, string | undefined][] = [];
  const activities: string[] = [];
  const costs: number[] = [];
  const hooks: RunHooks = {
    lines: (ls) => void lines.push(...ls),
    activity: (_s, a) => void activities.push(a),
    browser: () => undefined,
    screenshot: () => undefined,
    session: (id, key) => void sessions.push([id, key]),
    cost: (usd) => void costs.push(usd),
    helper: (e) => void helpers.push(e),
    helperLines: (id, ls) => void helperLines.push(...ls.map((l): [string, string] => [id, l.text])),
    background: (e) => void background.push(e),
    permission: () => Promise.resolve(true),
    question: () => Promise.resolve(undefined),
  };
  return { hooks, lines, helperLines, helpers, background, sessions, activities, costs };
}

const run = (events: ConversationEvent[], cwd = '/repo') => {
  const r = recorder();
  const ctx = newCommonContext(cwd);
  for (const e of events) handleCommonEvent(e, ctx, r.hooks);
  return { ...r, ctx };
};

describe('focusTool', () => {
  it("draws Codex's shell as Bash, its searches and image views as Claude Code's, and the client's tools by their MCP names", () => {
    expect(focusTool('shell', { command: 'ls', cwd: '/x' })).toEqual({ name: 'Bash', input: { command: 'ls' } });
    expect(focusTool('web_search', { query: 'q' })).toEqual({ name: 'WebSearch', input: { query: 'q' } });
    expect(focusTool('view_image', { path: '/a.png' })).toEqual({ name: 'Read', input: { file_path: '/a.png' } });
    expect(focusTool('browser.open', { url: 'http://x' })).toEqual({ name: 'mcp__browser__open', input: { url: 'http://x' } });
    expect(focusTool('agents.spawnAgent', { prompt: 'p' })).toEqual({ name: 'agents.spawnAgent', input: { prompt: 'p' } });
  });
});

describe('patchLines', () => {
  it('shows each file a patch changes, relative to the folder, with the first lines of its diff', () => {
    const lines = patchLines([{ path: '/repo/src/a.ts', kind: { type: 'update', move_path: null }, diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n++count;\n context' }, { path: '/repo/b.ts', kind: { type: 'add' }, diff: '+hello' }], '/repo');
    expect(lines).toEqual([
      { kind: 'tool', text: '⏺ Update(src/a.ts)' },
      { kind: 'error', text: '  - old' },
      { kind: 'success', text: '  + new' },
      { kind: 'success', text: '  + +count;' },
      { kind: 'tool', text: '⏺ Write(b.ts)' },
      { kind: 'success', text: '  + hello' },
    ]);
    expect(patchLines(undefined, '/repo')).toEqual([]);
  });
});

describe('backgroundEvents', () => {
  it('starts the commands new to the set and ends the ones gone from it', () => {
    expect(backgroundEvents(new Map([['a', 'sleep 5']]), [{ id: 'b', description: 'npm run dev' }])).toEqual([
      { kind: 'started', id: 'b', task: 'shell', description: 'npm run dev' },
      { kind: 'ended', id: 'a', status: 'done' },
    ]);
  });
});

describe('handleCommonEvent', () => {
  it("reports the Codex thread as the session, and the turn's answer as its result", () => {
    const r = run([
      { _tag: 'AgentSessionOpened', agentSessionId: 'thread-1', keySource: 'none', source: main },
      { _tag: 'AssistantMessage', text: 'Fixed it.\nDetails…', source: main },
      { _tag: 'StructuredAnswer', value: { verdict: 'pass' }, source: main },
      { _tag: 'TurnEnded', outcome: 'completed', source: main },
    ]);
    expect(r.sessions).toEqual([['thread-1', 'none']]);
    expect(r.ctx.result).toEqual({ text: 'Fixed it.\nDetails…', isError: false, queued: 0, structured: { verdict: 'pass' } });
    expect(r.activities).toContain('Fixed it.');
    expect(r.lines.map((l) => l.text)).toEqual(['✻ Codex', expect.stringContaining('Fixed it.'), '  Details…', '✔ Done']);
  });

  it('draws tool steps as the old runner does, with their output', () => {
    const r = run([
      { _tag: 'ToolStepStarted', toolUseId: 't1', name: 'shell', input: { command: 'pnpm test' }, source: main },
      { _tag: 'ToolStepEnded', toolUseId: 't1', ok: false, output: { head: 'FAIL a.test.ts', tail: '', totalBytes: 14 }, source: main },
    ]);
    expect(r.lines).toEqual([
      { kind: 'tool', text: '⏺ Bash(pnpm test)' },
      { kind: 'error', text: '  ⎿  FAIL a.test.ts' },
    ]);
    expect(r.activities).toEqual(['Running pnpm test']);
    expect(r.ctx.calls.size).toBe(0);
  });

  it("gives a spawned agent a transcript of its own, and its answer isn't the turn's", () => {
    const r = run([
      { _tag: 'SubagentStarted', id: 'child', description: 'look around', source: main },
      { _tag: 'ToolStepStarted', toolUseId: 't2', name: 'shell', input: { command: 'ls' }, source: sub },
      { _tag: 'AssistantMessage', text: 'found it', source: sub },
      { _tag: 'SubagentFinished', id: 'child', ok: true, source: main },
    ]);
    expect(r.helpers).toEqual([
      { kind: 'started', id: 'child', description: 'look around' },
      { kind: 'activity', id: 'child', activity: 'Running ls' },
      { kind: 'ended', id: 'child', ok: true },
    ]);
    expect(r.helperLines.map(([, t]) => t)).toEqual(['✻ look around', '⏺ Bash(ls)', expect.stringContaining('found it'), '✔ Done']);
    expect(r.lines).toEqual([]);
    expect(r.ctx.result).toBeUndefined();
  });

  it('follows the background commands as they start and end', () => {
    const r = run([
      { _tag: 'BackgroundChanged', tasks: [{ id: 'c1', description: 'sleep 5' }], waiting: true, source: main },
      { _tag: 'BackgroundChanged', tasks: [], waiting: false, source: main },
    ]);
    expect(r.background).toEqual([
      { kind: 'started', id: 'c1', task: 'shell', description: 'sleep 5' },
      { kind: 'ended', id: 'c1', status: 'done' },
    ]);
  });

  it('says how a turn that went wrong ended', () => {
    expect(run([{ _tag: 'TurnEnded', outcome: 'failed', error: 'Codex exited.', source: main }]).lines).toEqual([{ kind: 'error', text: '✘ failed: Codex exited.' }]);
  });

  it('draws a patch as file updates, and reports cost, compaction and a busy helper', () => {
    const r = run([
      { _tag: 'ToolStepStarted', toolUseId: 'p1', name: 'apply_patch', input: { changes: [{ path: '/repo/a.ts', kind: { type: 'update' }, diff: '-x\n+y' }] }, source: main },
      { _tag: 'SubagentBusy', id: 'child', activity: 'Reading a.ts', source: main },
      { _tag: 'Usage', costUsd: 0.25, source: main },
      { _tag: 'Usage', inputTokens: 10, source: main },
      { _tag: 'Compacted', text: '', source: main },
      { _tag: 'TurnEnded', outcome: 'interrupted', source: main },
    ]);
    expect(r.lines.map((l) => l.text)).toEqual(['⏺ Update(a.ts)', '  - x', '  + y', '✻ Conversation compacted', '✘ interrupted']);
    expect(r.activities).toEqual(['Editing files']);
    expect(r.helpers).toEqual([{ kind: 'activity', id: 'child', activity: 'Reading a.ts' }]);
    expect(r.costs).toEqual([0.25]);
  });

  it("indents a helper's lines in the session's own when there's no transcript of their own to put them in", () => {
    const r = recorder();
    const hooks = { ...r.hooks, helperLines: undefined };
    const ctx = newCommonContext('/repo');
    handleCommonEvent({ _tag: 'ToolStepStarted', toolUseId: 't', name: 'shell', input: { command: 'ls' }, source: sub }, ctx, hooks);
    handleCommonEvent({ _tag: 'SubagentFinished', id: 'child', ok: false, summary: 'gave up', source: main }, ctx, hooks);
    expect(r.lines).toEqual([{ kind: 'tool', text: '    ⏺ Bash(ls)' }]);
    expect(r.helpers).toEqual([{ kind: 'activity', id: 'child', activity: 'Running ls' }, { kind: 'ended', id: 'child', ok: false, summary: 'gave up' }]);
  });
});
