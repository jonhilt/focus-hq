import { truncate } from './text';
import type { SessionStep, TermEntry, TextLine } from './types';

// A session's steps as lines of text, for views that only draw text (a screen drawn on a canvas, a terminal a line at a
// time): each the way Claude Code's own UI shows it, cut to a glance. The steps themselves are kept whole; it's only
// here that a long one is shortened.

type Call = Extract<SessionStep, { kind: 'call' }>;
type Result = Extract<SessionStep, { kind: 'result' }>;

/** What starts the first line of each of Claude's replies, drawn as text; the rest are indented two. */
export const REPLY = '⏺ ';

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));

/** The objects in a list the model sent: its input is only checked against the tool's schema after we've seen it. */
export const records = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : [];

/** The todos in a TodoWrite call: those with something to do. */
export const todoList = (v: unknown): { content: string; status: unknown }[] =>
  records(v).flatMap((t) => (typeof t.content === 'string' ? [{ content: t.content, status: t.status }] : []));

/** A path inside the checkout relative to it (the checkout itself as .), any other as it is. */
export function relPath(p: unknown, cwd: string): string {
  const s = str(p);
  return cwd && s.startsWith(cwd) ? s.slice(cwd.length).replace(/^[/\\]/, '') || '.' : s;
}

/** What a tool call is called and what it acts on, as Claude Code heads it: `Update` and `a.ts` for an edit. */
export function callTitle(call: Pick<Call, 'tool' | 'input' | 'cwd'>): { label: string; arg: string } {
  const { tool, input, cwd } = call;
  if (tool.startsWith('mcp__browser__')) return { label: `Browser.${tool.slice('mcp__browser__'.length)}`, arg: str(input.url ?? input.selector ?? input.text ?? input.key ?? input.expression ?? '') };
  switch (tool) {
    case 'Bash':
      return { label: 'Bash', arg: str(input.command) };
    case 'Read':
    case 'Write':
      return { label: tool, arg: relPath(input.file_path, cwd) };
    case 'Edit':
      return { label: 'Update', arg: relPath(input.file_path, cwd) };
    case 'MultiEdit':
      return { label: 'MultiEdit', arg: relPath(input.file_path, cwd) };
    case 'Glob':
      return { label: 'Glob', arg: str(input.pattern) };
    case 'Grep':
      return { label: 'Search', arg: `"${str(input.pattern)}"` };
    case 'TodoWrite':
      return { label: 'Update Todos', arg: '' };
    case 'Task':
    case 'Agent':
      return { label: 'Task', arg: str(input.description) };
    case 'WebSearch':
      return { label: 'Web Search', arg: str(input.query) };
    case 'WebFetch':
      return { label: 'Fetch', arg: str(input.url) };
    case 'apply_patch':
      return { label: 'Patch', arg: patchFiles(input.changes).map((c) => relPath(c.path, cwd)).join(', ') };
    default:
      return { label: tool.replace(/^mcp__/, ''), arg: str(Object.values(input)[0]) };
  }
}

/** A Codex patch's files: each one's path, what it does to it, and its diff. */
export function patchFiles(changes: unknown): { path: string; kind: string; diff: string }[] {
  return records(changes).map((c) => ({ path: str(c.path), kind: str(records([c.kind])[0]?.type), diff: str(c.diff) }));
}

/** A call's head line: `⏺ Bash(pnpm test)`, or `⏺ Update Todos` for a call with nothing to show beside its name. */
export function callHead(call: Call): TextLine {
  const { label, arg } = callTitle(call);
  return { kind: 'tool', text: call.tool === 'TodoWrite' ? `⏺ ${label}` : `⏺ ${label}(${truncate(arg, 120)})` };
}

const added = (l: string): TextLine => ({ kind: 'success', text: `  + ${truncate(l, 140)}` });
const removed = (l: string): TextLine => ({ kind: 'error', text: `  - ${truncate(l, 140)}` });

/** A call as Claude Code shows it: its head, and a glance at what it writes or changes or ticks off. */
export function callLines(call: Call): TextLine[] {
  const { tool, input, cwd } = call;
  const head = callHead(call);
  if (tool === 'Write') {
    const content = str(input.content).split('\n');
    return [head, ...content.slice(0, 4).map(added), ...(content.length > 4 ? [{ kind: 'output' as const, text: `  … +${content.length - 4} lines` }] : [])];
  }
  if (tool === 'Edit' || tool === 'MultiEdit') {
    const edits = (tool === 'Edit' ? [input] : records(input.edits)).slice(0, 2);
    return [head, ...edits.flatMap((e) => [...str(e.old_string).split('\n').slice(0, 3).map(removed), ...str(e.new_string).split('\n').slice(0, 3).map(added)])];
  }
  if (tool === 'TodoWrite') {
    return [head, ...todoList(input.todos).map((t): TextLine => ({
      kind: t.status === 'completed' ? 'success' : 'output',
      text: `  ${t.status === 'completed' ? '☒' : t.status === 'in_progress' ? '◐' : '☐'} ${truncate(t.content, 120)}`,
    }))];
  }
  if (tool === 'apply_patch') return patchLines(input.changes, cwd);
  return [head];
}

/** A Codex patch: each file it changes, with the first lines of its diff. */
export function patchLines(changes: unknown, cwd: string): TextLine[] {
  return patchFiles(changes).slice(0, 3).flatMap((c): TextLine[] => {
    const label = c.kind === 'add' ? 'Write' : c.kind === 'delete' ? 'Delete' : 'Update';
    const diff = c.diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
    return [
      { kind: 'tool', text: `⏺ ${label}(${truncate(relPath(c.path, cwd), 120)})` },
      ...diff.slice(0, 6).map((l): TextLine => ({ kind: l.startsWith('+') ? 'success' : 'error', text: `  ${l[0]} ${truncate(l.slice(1), 140)}` })),
    ];
  });
}

/** A result's first few lines, dimmed, like Claude Code's ⎿ output, and how many more there are. */
export function resultLines(result: Pick<Result, 'ok' | 'text' | 'images'>): TextLine[] {
  const kind = result.ok ? 'output' : 'error';
  const images = (result.images ?? []).map(() => '[screenshot]');
  const all = [...result.text.replace(/\r/g, '').split('\n'), ...images].filter((l) => l.trim().length > 0);
  if (all.length === 0) return [{ kind, text: '  ⎿  (no output)' }];
  const shown = all.slice(0, 4).map((l, i): TextLine => ({ kind, text: `  ${i === 0 ? '⎿' : ' '}  ${truncate(l, 160)}` }));
  if (all.length > 4) shown.push({ kind: 'output', text: `     … +${all.length - 4} lines` });
  return shown;
}

/** A reply as lines: the first marked as Claude's, the rest indented under it. */
export function replyLines(text: string, kind: TextLine['kind'] = 'text'): TextLine[] {
  return text.replace(/\r/g, '').split('\n').map((l, i) => ({ kind, text: `${i === 0 ? REPLY : '  '}${l}` }));
}

/** Any entry as lines of text: a step at a glance, a subagent's indented under the session's; a line as it is. */
export function entryLines(entry: TermEntry): TextLine[] {
  if (isTextLine(entry)) return [entry];
  const lines = stepLines(entry);
  return entry.helper === undefined ? lines : lines.map((l) => ({ ...l, text: `    ${l.text}` }));
}

function stepLines(entry: SessionStep): TextLine[] {
  switch (entry.kind) {
    case 'reply':
      // a subagent's reply is no part of the session's own: drawn as output, so no reader takes it for the session's words
      return replyLines(entry.text, entry.helper === undefined ? 'text' : 'output');
    case 'think':
      return [{ kind: 'thinking', text: `✻ ${entry.text.trim() ? entry.text.trim() : 'Thinking…'}` }];
    case 'call':
      return callLines(entry);
    case 'result':
      return resultLines(entry);
  }
}

const STEP_KINDS = new Set<string>(['reply', 'think', 'call', 'result']);

/** Whether an entry is a line of text (a notice, a message sent, a line from before steps were typed) rather than a step. */
export function isTextLine(entry: TermEntry): entry is TextLine {
  return !STEP_KINDS.has(entry.kind);
}
