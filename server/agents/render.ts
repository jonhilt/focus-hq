import type { AgentStatus, BrowserFrame, TermLine } from '../../shared/types';
import { REPLY } from '../../shared/termText';
import { truncate } from '../util';

type Line = Omit<TermLine, 't'>;

export interface Rendered {
  lines: Line[];
  status?: AgentStatus;
  activity?: string;
}

type Block = { type: string; [key: string]: unknown };

/** A tool call, remembered until its result comes back. */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));

/** The objects in a list the model sent: its input is only checked against the tool's schema after we've seen it. */
const records = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : [];

/** The todos in a TodoWrite call: those with something to do. */
const todoList = (v: unknown): { content: string; status: unknown }[] =>
  records(v).flatMap((t) => (typeof t.content === 'string' ? [{ content: t.content, status: t.status }] : []));

const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?[^\s'"`)<>\\]*/g;

/**
 * The page a tool call points a browser at, so a screenshot that comes back later can say what it shows: a browser
 * tool's `url`, or the last local address in a command or script ("node shot.mjs http://localhost:5173/cart").
 */
export function appUrl(call: ToolCall): string | undefined {
  if (call.name === 'WebFetch' || call.name === 'WebSearch') return undefined;
  if (typeof call.input.url === 'string' && /^https?:\/\//.test(call.input.url)) return call.input.url;
  const found = Object.values(call.input).flatMap((v) => (typeof v === 'string' ? (v.match(LOCAL_URL) ?? []) : []));
  return found.at(-1);
}

/** An image block as a data URL: the API's shape (source.base64) or MCP's (data + mimeType). */
function imageUrl(block: Block): string | undefined {
  if (block.type !== 'image') return undefined;
  const source = block.source as { type?: unknown; media_type?: unknown; data?: unknown } | undefined;
  if (source?.type === 'base64' && typeof source.data === 'string') {
    return `data:${typeof source.media_type === 'string' ? source.media_type : 'image/png'};base64,${source.data}`;
  }
  if (typeof block.data === 'string') return `data:${typeof block.mimeType === 'string' ? block.mimeType : 'image/png'};base64,${block.data}`;
  return undefined;
}

/**
 * A screenshot the agent looked at (a PNG it read, another browser tool's capture), as a frame for its laptop screen.
 * Our own browser tool streams its frames as it goes, so its results are left alone.
 */
export function screenshotFrame(result: Block, call: ToolCall | undefined, lastUrl: string | undefined, at: number): BrowserFrame | null {
  if (call?.name.startsWith('mcp__browser__') || !Array.isArray(result.content)) return null;
  const image = (result.content as Block[]).map(imageUrl).filter((url) => url !== undefined).at(-1);
  if (!image) return null;
  const file = typeof call?.input.file_path === 'string' ? call.input.file_path : undefined;
  const name = file?.split(/[/\\]/).pop();
  return { url: lastUrl ?? file ?? call?.name ?? 'screenshot', title: lastUrl ? name : undefined, image, at };
}

/** Turns Claude Code tool calls into terminal lines that look like Claude Code's own UI. */
export function renderToolUse(name: string, input: Record<string, unknown>, cwd: string): Rendered {
  const rel = (p: unknown) => {
    const s = str(p);
    return s.startsWith(cwd) ? s.slice(cwd.length).replace(/^[/\\]/, '') || '.' : s;
  };
  const head = (label: string, arg: string): Line => ({ kind: 'tool', text: `⏺ ${label}(${truncate(arg, 120)})` });

  if (name.startsWith('mcp__browser__')) {
    const action = name.slice('mcp__browser__'.length);
    const arg = str(input.url ?? input.selector ?? input.text ?? input.key ?? input.expression ?? '');
    return {
      lines: [head(`Browser.${action}`, arg)],
      status: 'testing',
      activity: action === 'open' ? `Testing ${arg} in the browser` : `Testing in the browser (${action})`,
    };
  }

  switch (name) {
    case 'Bash': {
      const cmd = str(input.command);
      return { lines: [head('Bash', cmd)], status: 'working', activity: `Running ${truncate(cmd.split('\n')[0], 60)}` };
    }
    case 'Read':
      return { lines: [head('Read', rel(input.file_path))], status: 'working', activity: `Reading ${rel(input.file_path)}` };
    case 'Write': {
      const content = str(input.content).split('\n');
      return {
        lines: [
          head('Write', rel(input.file_path)),
          ...content.slice(0, 4).map((l): Line => ({ kind: 'success', text: `  + ${truncate(l, 140)}` })),
          ...(content.length > 4 ? [{ kind: 'output' as const, text: `  … +${content.length - 4} lines` }] : []),
        ],
        status: 'working',
        activity: `Writing ${rel(input.file_path)}`,
      };
    }
    case 'Edit':
    case 'MultiEdit': {
      const edits = (name === 'Edit' ? [input] : records(input.edits)).slice(0, 2);
      const lines: Line[] = [head(name === 'Edit' ? 'Update' : 'MultiEdit', rel(input.file_path))];
      for (const edit of edits) {
        for (const l of str(edit.old_string).split('\n').slice(0, 3)) lines.push({ kind: 'error', text: `  - ${truncate(l, 140)}` });
        for (const l of str(edit.new_string).split('\n').slice(0, 3)) lines.push({ kind: 'success', text: `  + ${truncate(l, 140)}` });
      }
      return { lines, status: 'working', activity: `Editing ${rel(input.file_path)}` };
    }
    case 'Glob':
      return { lines: [head('Glob', str(input.pattern))], status: 'working', activity: `Looking for ${str(input.pattern)}` };
    case 'Grep':
      return { lines: [head('Search', `"${str(input.pattern)}"`)], status: 'working', activity: `Searching for "${truncate(str(input.pattern), 40)}"` };
    case 'TodoWrite': {
      const todos = todoList(input.todos);
      const current = todos.find((t) => t.status === 'in_progress');
      return {
        lines: [
          { kind: 'tool', text: '⏺ Update Todos' },
          ...todos.map((t): Line => ({
            kind: t.status === 'completed' ? 'success' : 'output',
            text: `  ${t.status === 'completed' ? '☒' : t.status === 'in_progress' ? '◐' : '☐'} ${truncate(t.content, 120)}`,
          })),
        ],
        activity: current ? truncate(current.content, 70) : undefined,
      };
    }
    case 'Task':
    case 'Agent':
      return { lines: [head('Task', str(input.description))], status: 'working', activity: `Delegating: ${truncate(str(input.description), 50)}` };
    case 'WebSearch':
      return { lines: [head('Web Search', str(input.query))], activity: `Searching the web for ${truncate(str(input.query), 40)}` };
    case 'WebFetch':
      return { lines: [head('Fetch', str(input.url))], activity: `Reading ${truncate(str(input.url), 50)}` };
    default: {
      const first = Object.values(input)[0];
      return { lines: [head(name.replace(/^mcp__/, ''), str(first))], activity: `Using ${name}` };
    }
  }
}

/** Shows the first few lines of a tool result, dimmed, like Claude Code's ⎿ output. */
export function renderToolResult(block: Block): Line[] {
  const content = block.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((c: Block) => (c.type === 'text' ? str(c.text) : c.type === 'image' ? '[screenshot]' : ''))
      .filter(Boolean)
      .join('\n');
  }
  const kind = block.is_error ? 'error' : 'output';
  const all = text.replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
  if (all.length === 0) return [{ kind, text: '  ⎿  (no output)' }];
  const shown = all.slice(0, 4).map((l, i): Line => ({ kind, text: `  ${i === 0 ? '⎿' : ' '}  ${truncate(l, 160)}` }));
  if (all.length > 4) shown.push({ kind: 'output', text: `     … +${all.length - 4} lines` });
  return shown;
}

export function renderText(text: string, kind: TermLine['kind'] = 'text'): Line[] {
  const lines = text.replace(/\r/g, '').split('\n');
  return lines.map((l, i) => ({ kind, text: `${i === 0 ? REPLY : '  '}${l}` }));
}
