// A lead's background commands and monitors, from what its session reports about them. Pure: the runner feeds it
// Claude Code's messages, the manager keeps the result on the lead and reads their output files.
import type { BackgroundTask, TermLine } from '../../shared/types';
import { truncate } from '../util';

/** How long an ended command's probe stays by the lead's chair, so you see how it ended before it goes. */
export const BACKGROUND_LINGER_MS = 15_000;
/** How much of a command's output its panel shows: the end of it. */
export const OUTPUT_TAIL = 8 * 1024;

/** What Claude Code says about a background command or monitor: it started, where its output goes, it ended. */
export type BackgroundEvent =
  | { kind: 'started'; id: string; task: BackgroundTask['kind']; description: string }
  | { kind: 'output'; id: string; file: string }
  | { kind: 'ended'; id: string; status: Exclude<BackgroundTask['status'], 'running'>; summary?: string };

type Msg = { subtype?: string; task_id?: string; task_type?: string; tool_use_id?: string; description?: string; is_backgrounded?: boolean; patch?: { is_backgrounded?: boolean }; status?: string | null; summary?: string; output_file?: string };

/** How a command ended: stopped (by the captain, or Claude), failed (or a non-zero exit), or done. */
export function endedStatus(status: string | null | undefined, summary = ''): Exclude<BackgroundTask['status'], 'running'> {
  if (status === 'stopped' || status === 'killed') return 'stopped';
  if (status === 'failed') return 'failed';
  const code = /exit code (\d+)/i.exec(summary)?.[1];
  return code && code !== '0' ? 'failed' : 'done';
}

/** Where a backgrounded command's output goes, from what the Bash tool told Claude: its task id and file. */
export function outputFileOf(text: string): { id: string; file: string } | null {
  const m = /ID: (\w+)\. Output is being written to: (\S+?\.output)/.exec(text);
  return m?.[1] && m[2] ? { id: m[1], file: m[2] } : null;
}

/**
 * Follows a session's background commands through Claude Code's task messages: a command (local_bash) counts once it's
 * in the background, started there or moved there later; a monitor is one the Monitor tool started. Foreground
 * commands, and the session's other kinds of task, aren't its business.
 */
export class BackgroundTracker {
  /** Every command Claude Code has started, by task id, until it ends: whether it's in the background yet. */
  private readonly commands = new Map<string, { task: BackgroundTask['kind']; description: string; background: boolean }>();
  /** Where the session's commands write their output: each into a file named after it, all in one folder. */
  private folder: string | undefined;

  /** `toolName` names the tool a tool call (by its id) is: a monitor is the Monitor tool's. */
  constructor(private readonly toolName: (toolUseId: string | undefined) => string | undefined) {}

  /** What a system message says about the session's background commands. */
  system(msg: Msg): BackgroundEvent[] {
    const id = msg.task_id;
    if (!id) return [];
    if (msg.subtype === 'task_started' && msg.task_type === 'local_bash') {
      const task = this.toolName(msg.tool_use_id) === 'Monitor' ? 'monitor' : 'shell';
      const command = { task, description: truncate(msg.description ?? '', 300), background: !!msg.is_backgrounded } as const;
      this.commands.set(id, command);
      return command.background ? this.started(id, command) : [];
    }
    const command = this.commands.get(id);
    if (!command) return [];
    if (msg.subtype === 'task_updated' && msg.patch?.is_backgrounded && !command.background) {
      command.background = true;
      return this.started(id, command);
    }
    if (msg.subtype === 'task_notification') {
      this.commands.delete(id);
      if (!command.background) return [];
      const ended: BackgroundEvent = { kind: 'ended', id, status: endedStatus(msg.status, msg.summary), summary: msg.summary ? truncate(msg.summary, 200) : undefined };
      return msg.output_file ? [{ kind: 'output', id, file: msg.output_file }, ended] : [ended];
    }
    return [];
  }

  /** What a tool's result told Claude about where a backgrounded command's output goes. */
  toolResult(text: string): BackgroundEvent[] {
    const found = outputFileOf(text);
    if (!found) return [];
    this.folder = found.file.slice(0, found.file.length - `${found.id}.output`.length);
    return [{ kind: 'output', id: found.id, file: found.file }];
  }

  private started(id: string, command: { task: BackgroundTask['kind']; description: string }): BackgroundEvent[] {
    const events: BackgroundEvent[] = [{ kind: 'started', id, task: command.task, description: command.description }];
    // a monitor's result doesn't say where its output goes: where the session's commands' does
    if (this.folder) events.push({ kind: 'output', id, file: `${this.folder}${id}.output` });
    return events;
  }
}

/**
 * The lead's background commands after an event: a new one floats up by their chair, an ended one says how it went
 * (and goes once it has lingered). Where its output goes isn't the lead's to show (`output` changes nothing here).
 */
export function applyBackgroundEvent(tasks: BackgroundTask[], event: BackgroundEvent, now: number): BackgroundTask[] {
  if (event.kind === 'output') return tasks;
  if (event.kind === 'started') {
    if (tasks.some((t) => t.id === event.id)) return tasks;
    return [...tasks, { id: event.id, kind: event.task, description: event.description, status: 'running', startedAt: now }];
  }
  const task = tasks.find((t) => t.id === event.id);
  if (!task || task.status !== 'running') return tasks;
  return tasks.map((t) => (t.id === event.id ? { ...t, status: event.status, endedAt: now, summary: event.summary } : t));
}

/** The end of a command's output, as terminal lines. */
export function outputLines(text: string): Omit<TermLine, 't'>[] {
  const tail = text.length > OUTPUT_TAIL ? text.slice(text.indexOf('\n', text.length - OUTPUT_TAIL) + 1) : text;
  return tail.replace(/\r/g, '').split('\n').filter((l, i, all) => l || i < all.length - 1).map((text) => ({ kind: 'output' as const, text }));
}
