import { describe, expect, it } from 'vitest';
import { type AgentLog, clock, mostAtOnce, sessionTimeline, windowTime } from './sessionTimeline';
import { aboutSession, inside, journalResults, readableTranscript, sessionRef, subagentMeta } from './studioSessions';

// local times on 9 Oct 2026, as the timeline shows them
const at = (hh: number, mm: number, ss = 0) => new Date(2026, 9, 9, hh, mm, ss).toISOString();
const jsonl = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const user = (t: string, text: string) => ({ type: 'user', timestamp: t, message: { content: text } });
const said = (t: string, text: string, id = 'm-said') => ({ type: 'assistant', timestamp: t, message: { id, content: [{ type: 'text', text }] } });
const call = (t: string, id: string, name: string, input: object, message = `m-${id}`) => ({ type: 'assistant', timestamp: t, message: { id: message, content: [{ type: 'tool_use', id, name, input }] } });
const result = (t: string, id: string, content: string) => ({ type: 'user', timestamp: t, message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const agent = (meta: AgentLog['meta'], from: string, to: string, answer?: string, more: Partial<AgentLog> = {}): AgentLog => ({
  meta,
  jsonl: jsonl(
    user(from, `Brief for ${meta.description}`),
    call(from, `${meta.description}-1`, 'Read', { file_path: 'a.ts' }),
    ...(answer ? [call(to, `${meta.description}-h`, 'SubagentHandback', { message: answer })] : [said(to, 'Now the next file.')]),
  ),
  ...more,
});

describe('sessionTimeline', () => {
  const main = jsonl(
    user(at(10, 0), 'How should we show workflows?'),
    said(at(10, 1), 'I’ll prototype three at once.'),
    call(at(10, 2), 'a1', 'Agent', { description: 'Prototype A' }, 'fan'),
    call(at(10, 2, 5), 'a2', 'Agent', { description: 'Prototype B' }, 'fan'),
    result(at(10, 2, 10), 'a1', 'Async agent launched successfully.'),
    call(at(10, 30), 'b1', 'Bash', { command: 'pnpm test' }),
    call(at(10, 30, 5), 'b2', 'Bash', { command: 'pnpm run lint' }),
    call(at(10, 40), 'w1', 'Workflow', { script: "export const meta = { name: 'review-changes', phases: [] }" }),
    result(at(10, 40, 1), 'w1', 'Workflow launched in background.\nTranscript dir: /x/subagents/workflows/wf_abc-123'),
    user(at(11, 0), 'Looks good, ship it'),
  );
  const logs = {
    id: 's1',
    main,
    agents: [
      agent({ description: 'Prototype A', toolUseId: 'a1', agentType: 'general-purpose' }, at(10, 2), at(10, 20), 'Built the holo-table.'),
      agent({ description: 'Prototype B', toolUseId: 'a2', agentType: 'general-purpose' }, at(10, 3), at(10, 10)),
      agent({ description: 'impl:a', workflowPhase: 'Implement', model: 'sonnet' }, at(10, 41), at(10, 45), undefined, { workflow: 'wf_abc-123', result: 'Did a.' }),
      agent({ description: 'impl:b', workflowPhase: 'Implement', model: 'sonnet' }, at(10, 41), at(10, 46), undefined, { workflow: 'wf_abc-123', result: 'Did b.' }),
      agent({ description: 'review', workflowPhase: 'Review', model: 'opus' }, at(10, 47), at(10, 50), undefined, { workflow: 'wf_abc-123', result: 'All good.' }),
    ],
  };

  it('tells the session in order: what was asked, what Claude said and ran, and when', () => {
    const out = sessionTimeline(logs);
    expect(out).toContain('2026-10-09 10:00 → 2026-10-09 11:00 (60 minutes), 2 messages from the user, 5 agents (1 workflow run)');
    const order = ['[10:00] USER: How should we show workflows?', '[10:01] CLAUDE: I’ll prototype three at once.', '[10:02] FAN-OUT', '[10:30] tools: Bash ×2', '[10:40] WORKFLOW', '[11:00] USER: Looks good, ship it'];
    expect(order.map((s) => out.indexOf(s))).toEqual([...order.map((s) => out.indexOf(s))].sort((a, b) => a - b));
    expect(order.every((s) => out.includes(s))).toBe(true);
  });

  it('stitches in the subagents a message started together, with what each handed back or that it stopped', () => {
    const out = sessionTimeline(logs);
    expect(out).toContain('FAN-OUT: 2 subagents started together, at most 2 running at once');
    expect(out).toContain('“Prototype A” (general-purpose) ran 10:02–10:20 (18m, 1 calls)\n      came back: Built the holo-table.');
    expect(out).toContain('“Prototype B” (general-purpose) ran 10:03–10:10 (7m, 1 calls)\n      stopped without handing back; its last words: Now the next file.');
  });

  it('shows a workflow’s phases in order, with their agents, models and how many ran at once', () => {
    const out = sessionTimeline(logs);
    expect(out).toContain('WORKFLOW “review-changes”: 3 agents, ran 10:41–10:50, at most 2 at once');
    expect(out).toContain('phase Implement: 2 agents (sonnet) 10:41–10:46, at most 2 at once: impl:a, impl:b');
    expect(out).toContain('phase Review: 1 agent (opus) 10:47–10:50, at most 1 at once: review');
  });

  it('zooms in on a stretch with each call, and each agent’s brief and answer', () => {
    const out = sessionTimeline(logs, { from: '2026-10-09 10:30', to: '2026-10-09 10:40' });
    expect(out).toContain('Zoomed in on 2026-10-09 10:30 to 2026-10-09 10:40: 2 of 6 events.');
    expect(out).toContain('  - Bash: pnpm test\n  - Bash: pnpm run lint');
    expect(out).toContain('asked: Brief for impl:a');
    expect(out).toContain('came back: Did a.');
    expect(out).not.toContain('Looks good');
  });

  it('leaves Claude’s tool runs out first when the session runs long, never what was asked', () => {
    const long = jsonl(...Array.from({ length: 200 }, (_, i) => [user(at(9, 0, i), `Ask ${i}`), call(at(9, 0, i), `c${i}`, 'Bash', { command: 'x' }), said(at(9, 0, i), 'y'.repeat(300))]).flat());
    const out = sessionTimeline({ id: 's2', main: long, agents: [] });
    expect(out).toMatch(/\(\d+ lines of Claude's tool runs and words left out to fit/);
    expect(out).not.toContain('tools: Bash');
    expect(out).toContain('USER: Ask 0');
    expect(out).toContain('USER: Ask 199');
  });
});

describe('the timeline’s parts', () => {
  it('counts the most runs going at once', () => {
    expect(mostAtOnce([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 10, end: 20 }, { start: 30, end: 40 }])).toBe(2);
    expect(mostAtOnce([])).toBe(0);
  });

  it('reads times as the overview shows them, or ISO', () => {
    expect(clock(windowTime('2026-10-09 14:35'))).toBe('14:35');
    expect(windowTime(at(14, 35))).toBe(Date.parse(at(14, 35)));
    expect(windowTime('soon')).toBeNaN();
  });
});

describe('studio sessions', () => {
  it('only reads inside a root', () => {
    expect(inside('/home/me/.claude/projects', '/home/me/.claude/projects/p/s.jsonl')).toBe(true);
    expect(inside('/home/me/.claude/projects', '/home/me/.claude/projects/../secrets.jsonl')).toBe(false);
    expect(inside('/home/me/.claude/projects', '/home/me/.claude/projects')).toBe(false);
    expect(inside('/home/me/.claude/projects', '/etc/passwd')).toBe(false);
  });

  it('reads a ref as a transcript’s path or a session’s id, and refuses anything else', () => {
    expect(sessionRef('  ~/.claude/projects/p/s.jsonl ', '/home/me')).toEqual({ path: '/home/me/.claude/projects/p/s.jsonl' });
    expect(sessionRef('/tmp/x/s.jsonl', '/home/me')).toEqual({ path: '/tmp/x/s.jsonl' });
    // a bare file name is a path, read where the office runs, so the roots decide
    expect(sessionRef('s.jsonl', '/home/me')).toEqual({ path: 's.jsonl' });
    // only a leading ~/ is home, and with no home it stays as written (and won't resolve)
    expect(sessionRef('a/~/s.jsonl', '/home/me')).toEqual({ path: 'a/~/s.jsonl' });
    expect(sessionRef('~/s.jsonl', undefined)).toEqual({ path: '~/s.jsonl' });
    expect(sessionRef(' 2053e196-be92_x ', '/home/me')).toEqual({ id: '2053e196-be92_x' });
    expect(sessionRef('..', '/home/me')).toHaveProperty('error');
    expect(sessionRef('a b', '/home/me')).toHaveProperty('error');
    expect(sessionRef('', '/home/me')).toHaveProperty('error');
  });

  it('only reads a .jsonl inside one of the roots', () => {
    const roots = ['/home/me/.claude/projects', '/srv/claude/projects'];
    expect(readableTranscript('/home/me/.claude/projects/p/s.jsonl', roots)).toBe(true);
    expect(readableTranscript('/srv/claude/projects/p/s.jsonl', roots)).toBe(true);
    expect(readableTranscript('/home/me/.claude/projects/p/s.json', roots)).toBe(false);
    expect(readableTranscript('/home/me/.ssh/s.jsonl', roots)).toBe(false);
    expect(readableTranscript('/home/me/.claude/projects/p/s.jsonl', [])).toBe(false);
  });

  it('says what a session is about: Claude Code’s title and the first thing asked', () => {
    const head = jsonl({ type: 'ai-title', aiTitle: 'Workflow visualisation' }, user(at(9, 0), '<system-reminder>ignore</system-reminder>'), user(at(9, 1), 'Show me workflows'));
    expect(aboutSession(head)).toEqual({ title: 'Workflow visualisation', asked: 'Show me workflows' });
  });

  it('reads what each workflow agent returned from its run’s journal', () => {
    const journal = jsonl({ type: 'launched' }, { type: 'started', agentId: 'a1' }, { type: 'result', agentId: 'a1', result: 'Done' }, { type: 'result', agentId: 'a2', result: { ok: true } });
    expect([...journalResults(journal)]).toEqual([['a1', 'Done'], ['a2', '{"ok":true}']]);
  });

  it('reads past a line that isn’t a message, and a title or agent id that isn’t text', () => {
    expect(aboutSession(`null\n${jsonl({ type: 'ai-title', aiTitle: 7 }, { type: 'ai-title', aiTitle: 'Kept' })}`)).toEqual({ title: 'Kept' });
    expect([...journalResults(`null\n${jsonl({ type: 'result', agentId: 3, result: 'x' }, { type: 'result', agentId: 'a1', result: 'Done' })}`)]).toEqual([['a1', 'Done']]);
  });

  it('keeps what a subagent’s notes say in the shape it expects, and nothing else', () => {
    expect(subagentMeta('{"agentType":"Explore","description":"Look","toolUseId":"t1","workflowPhase":"Plan","model":"opus","spawnDepth":2,"extra":1}'))
      .toEqual({ agentType: 'Explore', description: 'Look', toolUseId: 't1', workflowPhase: 'Plan', model: 'opus', spawnDepth: 2 });
    expect(subagentMeta('{"description":5,"spawnDepth":"2","model":"opus"}')).toEqual({ model: 'opus' });
    expect(subagentMeta('null')).toEqual({});
    expect(subagentMeta('[1]')).toEqual({});
  });
});
