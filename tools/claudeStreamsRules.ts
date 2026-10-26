// What `pnpm run claude-streams` keeps of a real Claude Code session's SDK messages: their shapes, never their words.
// Pure: the script feeds it each message as it comes.
import { isRecord } from '../shared/records';

/** One SDK message, as Focus's code reads it: kinds, flags, tool names and counts, with ids made up in order. */
export type Shape = Record<string, string | number | boolean | string[] | null>;

const asRecord = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : asArray(v).map((b) => asRecord(b).text ?? '').join(' '));

/** Names real ids by the order they were first seen (`t1`, `t2`…), so a shape says which task is which and nothing else. */
export class Ids {
  private readonly seen = new Map<string, string>();
  constructor(private readonly prefix: string) {}
  of(id: unknown): string | null {
    if (typeof id !== 'string' || !id) return null;
    const known = this.seen.get(id);
    if (known) return known;
    const named = `${this.prefix}${this.seen.size + 1}`;
    this.seen.set(id, named);
    return named;
  }
}

/**
 * What a tool result says, as Focus reads it: a command gone to the background, a tool cancelled because nobody
 * was there to approve it (in the words Focus's transcripts show, or those 2.1.289 used once Focus's input had
 * closed), or neither.
 */
export function resultKind(content: unknown): 'background' | 'cancelled' | 'other' {
  const said = text(content);
  if (/running in background with ID/.test(said)) return 'background';
  if (/doesn.t want to take this action right now|Tool permission request failed: AbortError: Stream closed/.test(said)) return 'cancelled';
  return 'other';
}

/** The shape of one SDK message: what Focus's code depends on, with no text, paths or prompts. */
export function shapeOf(msg: unknown, tasks: Ids, tools: Ids): Shape {
  const m = asRecord(msg);
  const type = String(m.type ?? '');
  if (type === 'system') {
    const subtype = String(m.subtype ?? '');
    const shape: Shape = { type, subtype };
    if ('task_id' in m) shape.task = tasks.of(m.task_id);
    if (typeof m.task_type === 'string') shape.task_type = m.task_type;
    if (typeof m.status === 'string') shape.status = m.status;
    if (typeof m.is_backgrounded === 'boolean') shape.is_backgrounded = m.is_backgrounded;
    if (typeof m.tool_use_id === 'string') shape.tool = tools.of(m.tool_use_id);
    if (subtype === 'background_tasks_changed') {
      shape.tasks = asArray(m.tasks).map((t) => {
        const r = asRecord(t);
        return `${tasks.of(r.task_id)}:${String(r.task_type)}${r.ambient ? ':ambient' : ''}`;
      });
    }
    if (subtype === 'task_updated') shape.patch = Object.keys(asRecord(m.patch)).sort();
    return shape;
  }
  if (type === 'assistant' || type === 'user') {
    const message = asRecord(m.message);
    const blocks = typeof message.content === 'string' ? ['text'] : asArray(message.content).map((b) => {
      const r = asRecord(b);
      if (r.type === 'tool_use') return `tool_use:${String(r.name)}:${tools.of(r.id)}${asRecord(r.input).run_in_background ? ':background' : ''}`;
      if (r.type === 'tool_result') return `tool_result:${tools.of(r.tool_use_id)}:${resultKind(r.content)}${r.is_error ? ':error' : ''}`;
      return String(r.type);
    });
    return { type, blocks, sub: m.parent_tool_use_id != null };
  }
  if (type === 'result') {
    return { type, subtype: String(m.subtype ?? ''), is_error: !!m.is_error, num_turns: Number(m.num_turns ?? 0), queued_turn_count: typeof m.queued_turn_count === 'number' ? m.queued_turn_count : null, cost: Number(m.total_cost_usd ?? 0) };
  }
  return { type };
}

/** Spend so far, from each turn's result: Claude Code's `total_cost_usd` is the session's running total. */
export function spentOf(shapes: Shape[]): number {
  return shapes.reduce((most, s) => (s.type === 'result' && typeof s.cost === 'number' ? Math.max(most, s.cost) : most), 0);
}
