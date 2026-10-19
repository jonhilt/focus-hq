import { describe, expect, it } from 'vitest';
import { Ids, resultKind, shapeOf, spentOf } from './claudeStreamsRules';

describe('shapeOf', () => {
  it('keeps a background list’s kinds and order, naming each task by when it was first seen', () => {
    const tasks = new Ids('t');
    const tools = new Ids('u');
    const listed = shapeOf({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'b9x', task_type: 'local_bash', description: 'secret' }, { task_id: 'w1', task_type: 'local_workflow', description: 'x', ambient: true }] }, tasks, tools);
    expect(listed).toEqual({ type: 'system', subtype: 'background_tasks_changed', tasks: ['t1:local_bash', 't2:local_workflow:ambient'] });
    expect(shapeOf({ type: 'system', subtype: 'task_notification', task_id: 'w1', status: 'completed', tool_use_id: 'toolu_a', summary: 'secret' }, tasks, tools)).toEqual({ type: 'system', subtype: 'task_notification', task: 't2', status: 'completed', tool: 'u1' });
  });

  it('keeps tool names and flags, never their input or output', () => {
    const tools = new Ids('u');
    const said = shapeOf({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'secret' }, { type: 'tool_use', id: 'toolu_a', name: 'Bash', input: { command: 'rm -rf /secret', run_in_background: true } }] } }, new Ids('t'), tools);
    expect(said).toEqual({ type: 'assistant', blocks: ['text', 'tool_use:Bash:u1:background'], sub: false });
    expect(JSON.stringify(said)).not.toContain('secret');
    const result = shapeOf({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_a', is_error: true, content: 'Tool permission request failed: AbortError: Stream closed' }] } }, new Ids('t'), tools);
    expect(result).toEqual({ type: 'user', blocks: ['tool_result:u1:cancelled:error'], sub: false });
  });

  it('keeps what a turn’s result counts', () => {
    expect(shapeOf({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, queued_turn_count: 0, total_cost_usd: 0.02, result: 'secret' }, new Ids('t'), new Ids('u'))).toEqual({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, queued_turn_count: 0, cost: 0.02 });
  });
});

describe('resultKind', () => {
  it('tells a command gone to the background and a tool nobody could approve from anything else', () => {
    expect(resultKind('Command running in background with ID: b1. Output is being written to: /tmp/b1.output')).toBe('background');
    expect(resultKind([{ type: 'text', text: 'The user doesn’t want to take this action right now' }])).toBe('cancelled');
    expect(resultKind('ok')).toBe('other');
  });
});

describe('spentOf', () => {
  it('is the session’s running total, the last result’s', () => {
    expect(spentOf([{ type: 'result', cost: 0.01 }, { type: 'assistant' }, { type: 'result', cost: 0.03 }])).toBe(0.03);
    expect(spentOf([])).toBe(0);
  });
});
