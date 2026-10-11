import { describe, expect, it } from 'vitest';
import { applyBackgroundEvent, BackgroundTracker, endedStatus, OUTPUT_TAIL, outputFileOf, outputLines } from './backgroundTasks';

// as the probes saw them: a backgrounded command, a monitor (a local_bash task too, started by the Monitor tool)
const tools: Record<string, string> = { toolu_bash: 'Bash', toolu_mon: 'Monitor', toolu_fg: 'Bash' };
const tracker = () => new BackgroundTracker((id) => (id ? tools[id] : undefined));
const FILE = '/private/tmp/claude-501/-w/9d31/tasks/bye8.output';

describe('BackgroundTracker', () => {
  it('starts a backgrounded command, learns where its output goes, and ends it by its exit code', () => {
    const t = tracker();
    expect(t.system({ subtype: 'task_started', task_type: 'local_bash', task_id: 'bye8', tool_use_id: 'toolu_bash', description: 'pnpm run dev', is_backgrounded: true }))
      .toEqual([{ kind: 'started', id: 'bye8', task: 'shell', description: 'pnpm run dev' }]);
    expect(t.toolResult(`Command running in background with ID: bye8. Output is being written to: ${FILE}. You will be notified`))
      .toEqual([{ kind: 'output', id: 'bye8', file: FILE }]);
    expect(t.system({ subtype: 'task_notification', task_id: 'bye8', status: 'completed', summary: 'Background command "pnpm run dev" completed (exit code 1)' }))
      .toEqual([{ kind: 'ended', id: 'bye8', status: 'failed', summary: 'Background command "pnpm run dev" completed (exit code 1)' }]);
  });

  it('knows a monitor by the tool that started it, and where its output goes from the session’s other commands', () => {
    const t = tracker();
    t.toolResult(`Command running in background with ID: bye8. Output is being written to: ${FILE}.`);
    expect(t.system({ subtype: 'task_started', task_type: 'local_bash', task_id: 'mon1', tool_use_id: 'toolu_mon', description: 'watch for ready.txt', is_backgrounded: true }))
      .toEqual([
        { kind: 'started', id: 'mon1', task: 'monitor', description: 'watch for ready.txt' },
        { kind: 'output', id: 'mon1', file: '/private/tmp/claude-501/-w/9d31/tasks/mon1.output' },
      ]);
  });

  it('leaves a foreground command alone, unless it’s moved into the background', () => {
    const t = tracker();
    expect(t.system({ subtype: 'task_started', task_type: 'local_bash', task_id: 'fg1', tool_use_id: 'toolu_fg', description: 'sleep 20', is_backgrounded: false })).toEqual([]);
    expect(t.system({ subtype: 'task_updated', task_id: 'fg1', patch: { is_backgrounded: true } })).toEqual([{ kind: 'started', id: 'fg1', task: 'shell', description: 'sleep 20' }]);
    const other = tracker();
    other.system({ subtype: 'task_started', task_type: 'local_bash', task_id: 'fg2', tool_use_id: 'toolu_fg', description: 'ls', is_backgrounded: false });
    expect(other.system({ subtype: 'task_notification', task_id: 'fg2', status: 'completed', summary: 'ls' })).toEqual([]);
  });

  it('ignores the session’s other kinds of task', () => {
    expect(tracker().system({ subtype: 'task_started', task_type: 'local_workflow', task_id: 'w1', description: 'Review' })).toEqual([]);
    expect(tracker().system({ subtype: 'task_notification', task_id: 'nobody', status: 'completed' })).toEqual([]);
  });
});

describe('endedStatus', () => {
  it('reads stopped, failed, a non-zero exit and done', () => {
    expect(endedStatus('stopped')).toBe('stopped');
    expect(endedStatus('killed')).toBe('stopped');
    expect(endedStatus('failed')).toBe('failed');
    expect(endedStatus('completed', 'completed (exit code 2)')).toBe('failed');
    expect(endedStatus('completed', 'completed (exit code 0)')).toBe('done');
    expect(endedStatus('completed', 'watch for ready.txt')).toBe('done');
  });
});

describe('outputFileOf', () => {
  it('is null for a result that isn’t a backgrounded command’s', () => {
    expect(outputFileOf('hello')).toBeNull();
  });
});

describe('applyBackgroundEvent', () => {
  const started = applyBackgroundEvent([], { kind: 'started', id: 'b1', task: 'shell', description: 'pnpm run dev' }, 5);

  it('floats a new command up once, ends it once, and leaves its output file to the manager', () => {
    expect(started).toEqual([{ id: 'b1', kind: 'shell', description: 'pnpm run dev', status: 'running', startedAt: 5 }]);
    expect(applyBackgroundEvent(started, { kind: 'started', id: 'b1', task: 'shell', description: 'again' }, 6)).toBe(started);
    expect(applyBackgroundEvent(started, { kind: 'output', id: 'b1', file: FILE }, 6)).toBe(started);
    const ended = applyBackgroundEvent(started, { kind: 'ended', id: 'b1', status: 'stopped', summary: 'stopped' }, 9);
    expect(ended[0]).toMatchObject({ status: 'stopped', endedAt: 9, summary: 'stopped' });
    expect(applyBackgroundEvent(ended, { kind: 'ended', id: 'b1', status: 'done' }, 10)).toBe(ended);
  });
});

describe('outputLines', () => {
  it('is the end of the output, line by line, without the empty line after the last', () => {
    expect(outputLines('tick 1\ntick 2\n').map((l) => l.text)).toEqual(['tick 1', 'tick 2']);
    const long = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    const lines = outputLines(long);
    expect(lines.at(-1)?.text).toBe('line 1999');
    expect(lines.map((l) => l.text).join('\n').length).toBeLessThanOrEqual(OUTPUT_TAIL);
  });
});
