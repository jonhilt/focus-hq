import { relPath, todoList } from '../../shared/stepText';
import type { AgentStatus, BrowserFrame, SessionStep } from '../../shared/types';
import { truncate } from '../util';
import { contentBlocks, field } from './transcript';

/** What a tool call has the session busy with. */
export interface Activity {
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
function imageUrl(block: unknown): string | undefined {
  if (field(block, 'type') !== 'image') return undefined;
  const source = field(block, 'source');
  const [sourceData, sourceType, data, mimeType] = [field(source, 'data'), field(source, 'media_type'), field(block, 'data'), field(block, 'mimeType')];
  if (field(source, 'type') === 'base64' && typeof sourceData === 'string') return `data:${typeof sourceType === 'string' ? sourceType : 'image/png'};base64,${sourceData}`;
  if (typeof data === 'string') return `data:${typeof mimeType === 'string' ? mimeType : 'image/png'};base64,${data}`;
  return undefined;
}

/**
 * A screenshot the agent looked at (a PNG it read, another browser tool's capture), as a frame for its laptop screen.
 * Our own browser tool streams its frames as it goes, so its results are left alone.
 */
export function screenshotFrame(result: Block, call: ToolCall | undefined, lastUrl: string | undefined, at: number): BrowserFrame | null {
  if (call?.name.startsWith('mcp__browser__') || !Array.isArray(result.content)) return null;
  const image = result.content.map(imageUrl).filter((url) => url !== undefined).at(-1);
  if (!image) return null;
  const file = typeof call?.input.file_path === 'string' ? call.input.file_path : undefined;
  const name = file?.split(/[/\\]/).pop();
  return { url: lastUrl ?? file ?? call?.name ?? 'screenshot', title: lastUrl ? name : undefined, image, at };
}

/** What a tool call has the session busy with: its status (null to keep the one it has) and its activity line. */
export function toolActivity(name: string, input: Record<string, unknown>, cwd: string): Activity {
  const rel = (p: unknown) => relPath(p, cwd);

  if (name.startsWith('mcp__browser__')) {
    const action = name.slice('mcp__browser__'.length);
    const arg = str(input.url ?? input.selector ?? input.text ?? input.key ?? input.expression ?? '');
    return { status: 'testing', activity: action === 'open' ? `Testing ${arg} in the browser` : `Testing in the browser (${action})` };
  }

  switch (name) {
    case 'Bash':
      return { status: 'working', activity: `Running ${truncate(str(input.command).split('\n')[0], 60)}` };
    case 'Read':
      return { status: 'working', activity: `Reading ${rel(input.file_path)}` };
    case 'Write':
      return { status: 'working', activity: `Writing ${rel(input.file_path)}` };
    case 'Edit':
    case 'MultiEdit':
      return { status: 'working', activity: `Editing ${rel(input.file_path)}` };
    case 'apply_patch':
      return { status: 'working', activity: 'Editing files' };
    case 'Glob':
      return { status: 'working', activity: `Looking for ${str(input.pattern)}` };
    case 'Grep':
      return { status: 'working', activity: `Searching for "${truncate(str(input.pattern), 40)}"` };
    case 'TodoWrite': {
      const current = todoList(input.todos).find((t) => t.status === 'in_progress');
      return { activity: current ? truncate(current.content, 70) : undefined };
    }
    case 'Task':
    case 'Agent':
      return { status: 'working', activity: `Delegating: ${truncate(str(input.description), 50)}` };
    case 'WebSearch':
      return { activity: `Searching the web for ${truncate(str(input.query), 40)}` };
    case 'WebFetch':
      return { activity: `Reading ${truncate(str(input.url), 50)}` };
    default:
      return { activity: `Using ${name}` };
  }
}

/** A tool call as a step: all of its input, and where it ran. */
export const callStep = (id: string, tool: string, input: Record<string, unknown>, cwd: string): SessionStep => ({ kind: 'call', id, tool, input, cwd });

/** A tool result as a step: all of its text, and the images it gave back as data URLs (Focus saves them as it prints). */
export function resultStep(id: string, block: { content?: unknown; is_error?: boolean | null }): SessionStep {
  const content = block.content;
  const text = typeof content === 'string' ? content : contentBlocks(content).flatMap((c) => (c.type === 'text' ? [str(c.text)] : [])).join('\n');
  const images = Array.isArray(content) ? content.flatMap((c) => imageUrl(c) ?? []).map((src) => ({ src })) : [];
  return { kind: 'result', id, ok: !block.is_error, text, ...(images.length > 0 && { images }) };
}
