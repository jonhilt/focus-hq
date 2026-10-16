import type { ClaudeTask } from '../../shared/types';

// The task list an agent keeps for itself with Claude Code's task tools, followed from its session's messages: the
// office watches it, and never asks for one or changes how the agent keeps it.

/** The tools an agent keeps its task list with. */
export const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList']);

const STATUSES: ClaudeTask['status'][] = ['pending', 'in_progress', 'completed'];
const status = (v: unknown, fallback: ClaudeTask['status']): ClaudeTask['status'] => STATUSES.find((s) => s === v) ?? fallback;
const text = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
// the input as the model sent it: Claude Code repairs `id`/`task_id` and `active_form` before it runs the tool, but the
// stream carries them unrepaired
const taskId = (input: Record<string, unknown>) => text(input.taskId) || text(input.id) || text(input.task_id);
const activeForm = (input: Record<string, unknown>) => text(input.activeForm) || text(input.active_form) || undefined;

/**
 * The task list after one call to a task tool: `input` is what the agent sent, `result` the tool's structured output
 * (Claude Code's `tool_use_result`) and `resultText` what the agent read back. The same list when the call changed
 * nothing, or wasn't one we follow.
 */
export function applyTaskTool(tasks: ClaudeTask[], name: string, input: Record<string, unknown>, result?: unknown, resultText = ''): ClaudeTask[] {
  switch (name) {
    // the whole list, every time
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      return todos
        .map((t, i) => ({ id: String(i + 1), subject: text(record(t).content), status: status(record(t).status, 'pending'), activeForm: text(record(t).activeForm) || undefined }))
        .filter((t) => t.subject);
    }
    // one more: its id comes back in the result
    case 'TaskCreate': {
      const created = record(record(result).task);
      const id = text(created.id) || /#(\d+)/.exec(resultText)?.[1];
      const subject = text(input.subject) || text(created.subject);
      if (!id || !subject || tasks.some((t) => t.id === id)) return tasks;
      return [...tasks, { id, subject, status: 'pending', activeForm: activeForm(input) }];
    }
    case 'TaskUpdate': {
      const id = taskId(input);
      const task = tasks.find((t) => t.id === id);
      if (!task || record(result).success === false) return tasks;
      if (input.status === 'deleted') return tasks.filter((t) => t !== task);
      const next: ClaudeTask = {
        ...task,
        subject: text(input.subject) || task.subject,
        status: status(input.status, task.status),
        activeForm: activeForm(input) ?? task.activeForm,
      };
      return tasks.map((t) => (t === task ? next : t));
    }
    // the list as Claude Code has it: what we followed gives way to it
    case 'TaskList': {
      const listed = record(result).tasks;
      if (!Array.isArray(listed)) return tasks;
      return listed
        .map((t) => {
          const r = record(t);
          const id = text(r.id);
          return { id, subject: text(r.subject), status: status(r.status, 'pending'), activeForm: tasks.find((k) => k.id === id)?.activeForm };
        })
        .filter((t) => t.id && t.subject);
    }
    default:
      return tasks;
  }
}
