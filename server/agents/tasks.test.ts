import { describe, expect, it } from 'vitest';
import type { ClaudeTask } from '../../shared/types';
import { applyTaskTool } from './tasks';

const list: ClaudeTask[] = [
  { id: '1', subject: 'Read the code', status: 'completed' },
  { id: '2', subject: 'Write the fix', status: 'in_progress', activeForm: 'Writing the fix' },
];

describe('applyTaskTool', () => {
  it('takes TodoWrite’s whole list each time, dropping empty items', () => {
    const todos = [
      { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
      { content: ' Add  tests ', status: 'in_progress', activeForm: 'Adding tests' },
      { content: '', status: 'pending' },
      { content: 'Ship it', status: 'nonsense' },
    ];
    expect(applyTaskTool(list, 'TodoWrite', { todos })).toEqual([
      { id: '1', subject: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
      { id: '2', subject: 'Add tests', status: 'in_progress', activeForm: 'Adding tests' },
      { id: '4', subject: 'Ship it', status: 'pending', activeForm: undefined },
    ]);
    expect(applyTaskTool(list, 'TodoWrite', {})).toEqual([]);
  });

  it('passes over items and results that aren’t objects', () => {
    expect(applyTaskTool(list, 'TodoWrite', { todos: [null, 'Read the code', ['Read the code'], { content: 'Ship it' }] })).toEqual([{ id: '4', subject: 'Ship it', status: 'pending', activeForm: undefined }]);
    expect(applyTaskTool(list, 'TaskCreate', { subject: 'Run the tests' }, null, 'Task #7 created successfully').at(-1)?.id).toBe('7');
    expect(applyTaskTool(list, 'TaskCreate', { subject: 'Run the tests' }, { task: 'Run the tests' }, 'Task #8 created successfully').at(-1)?.id).toBe('8');
    expect(applyTaskTool(list, 'TaskList', {}, null)).toBe(list);
    expect(applyTaskTool(list, 'TaskList', {}, { tasks: [null, '1', { id: '1', subject: 'Read the code' }] })).toEqual([{ id: '1', subject: 'Read the code', status: 'pending', activeForm: undefined }]);
  });

  it('adds a TaskCreate with the id Claude Code gave it, from its output or, failing that, what it said', () => {
    expect(applyTaskTool(list, 'TaskCreate', { subject: 'Run the tests', activeForm: 'Running the tests' }, { task: { id: '3', subject: 'Run the tests' } })).toEqual([
      ...list,
      { id: '3', subject: 'Run the tests', status: 'pending', activeForm: 'Running the tests' },
    ]);
    expect(applyTaskTool(list, 'TaskCreate', { subject: 'Run the tests' }, undefined, 'Task #7 created successfully: Run the tests').at(-1)?.id).toBe('7');
    expect(applyTaskTool(list, 'TaskCreate', { subject: 'Run the tests' }, undefined, 'something went wrong')).toBe(list);
    expect(applyTaskTool(list, 'TaskCreate', { subject: 'Again' }, { task: { id: '2' } })).toBe(list);
  });

  it('updates, completes and deletes with TaskUpdate, leaving the list alone when the update failed', () => {
    expect(applyTaskTool(list, 'TaskUpdate', { taskId: '2', status: 'completed' }, { success: true })[1]).toEqual({ id: '2', subject: 'Write the fix', status: 'completed', activeForm: 'Writing the fix' });
    expect(applyTaskTool(list, 'TaskUpdate', { taskId: '1', subject: 'Read it all' })[0].subject).toBe('Read it all');
    expect(applyTaskTool(list, 'TaskUpdate', { taskId: '1', status: 'deleted' })).toEqual([list[1]]);
    expect(applyTaskTool(list, 'TaskUpdate', { taskId: '9', status: 'completed' })).toBe(list);
    // the stream carries the model's key names before Claude Code repairs them
    expect(applyTaskTool(list, 'TaskUpdate', { id: '1', status: 'in_progress', active_form: 'Reading' })[0]).toMatchObject({ status: 'in_progress', activeForm: 'Reading' });
    expect(applyTaskTool(list, 'TaskUpdate', { task_id: '2', status: 'completed' })[1].status).toBe('completed');
    expect(applyTaskTool(list, 'TaskUpdate', { taskId: '2', status: 'completed' }, { success: false })).toBe(list);
  });

  it('takes TaskList’s answer as the list as it stands, keeping what each says while in progress', () => {
    const listed = { tasks: [{ id: '2', subject: 'Write the fix', status: 'in_progress', blockedBy: [] }, { id: '5', subject: 'New', status: 'pending', blockedBy: [] }] };
    expect(applyTaskTool(list, 'TaskList', {}, listed)).toEqual([
      { id: '2', subject: 'Write the fix', status: 'in_progress', activeForm: 'Writing the fix' },
      { id: '5', subject: 'New', status: 'pending', activeForm: undefined },
    ]);
    expect(applyTaskTool(list, 'TaskList', {}, undefined)).toBe(list);
  });

  it('ignores every other tool', () => {
    expect(applyTaskTool(list, 'Bash', { command: 'ls' })).toBe(list);
  });
});
