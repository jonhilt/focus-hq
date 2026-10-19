// Reading a Claude Code transcript (its session's JSONL, one line per message or event), shared by the ledger's
// session digests (sessionDigest.ts) and plugins (through `PluginHost.transcript`): finding the agents' transcripts on
// this machine, reading one, and telling who a message in it is from. A transcript can be mid-write, so a line that doesn't parse is skipped.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export type Block = { type?: string; text?: string; name?: string; id?: string; tool_use_id?: string; input?: unknown; is_error?: boolean; content?: unknown };
/** A transcript line: the fields the office reads are checked, and anything else Claude Code writes is there to narrow. */
export type Line = { type?: string; uuid?: string; timestamp?: string; isMeta?: boolean; message?: { id?: string; content?: unknown }; [field: string]: unknown };

/** Whether a JSON value is an object (not null, not an array): the only kind with fields to read. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A field of a JSON value, or nothing when it isn't an object. */
export const field = (v: unknown, key: string): unknown => (isRecord(v) ? v[key] : undefined);

const optional = (v: unknown, kind: 'string' | 'boolean') => v === undefined || typeof v === kind;

function isBlock(v: unknown): v is Block {
  return isRecord(v) && optional(v.type, 'string') && optional(v.text, 'string') && optional(v.name, 'string') && optional(v.id, 'string')
    && optional(v.tool_use_id, 'string') && optional(v.is_error, 'boolean');
}

function isLine(v: unknown): v is Line {
  return isRecord(v) && optional(v.type, 'string') && optional(v.uuid, 'string') && optional(v.timestamp, 'string') && optional(v.isMeta, 'boolean')
    && (v.message === undefined || (isRecord(v.message) && optional(v.message.id, 'string')));
}

/** A message's or tool result's content as blocks, leaving out anything in it that isn't one. */
export const contentBlocks = (content: unknown): Block[] => (Array.isArray(content) ? content.filter(isBlock) : []);

/** A line's content as blocks: a plain string is one text block. */
export const blocks = (line: Line): Block[] => {
  const content = line.message?.content;
  return typeof content === 'string' ? [{ type: 'text', text: content }] : contentBlocks(content);
};

/** A tool result's text, however it came. */
export const resultText = (content: unknown) => (typeof content === 'string' ? content : contentBlocks(content).map((b) => b.text ?? '').join(' '));

/** Each line of a transcript that parses to a message, in order. */
export function* transcriptLines(jsonl: string): Generator<Line> {
  for (const text of jsonl.split('\n')) {
    if (!text.trim()) continue;
    let line: unknown;
    try {
      line = JSON.parse(text);
    } catch {
      continue; // mid-write, or not a transcript line
    }
    if (isLine(line)) yield line;
  }
}

export type SessionKind = 'lead' | 'agent' | 'qa';

/** Who a message to the agent came from, as far as its wording tells: the office's own messages have set openings. */
export type MessageFrom = 'captain' | 'office' | 'qa' | 'compacted';

/** How the office opens the messages it sends agents, and the harness's own that aren't anyone talking. */
const OPENINGS: [string, MessageFrom | null][] = [
  ['[Office]', 'office'],
  ['[QA officer', 'qa'],
  ['Slice ', 'office'],
  ['Your workspace, with every repo', 'office'],
  ['Please QA pull request', 'office'],
  ['Please resolve GitHub issue', 'office'],
  ['Pull request #', 'office'],
  ['QA failed pull request', 'office'],
  ['Answer with one word', 'office'],
  ['Notes from your manager', 'office'],
  ['This session is being continued', 'compacted'],
  ['<command-name>', null],
  ['<local-command', null],
  ['<task-notification', null],
  ['<system-reminder>', null],
  ['[SYSTEM NOTIFICATION', null],
  ['Another Claude session', null],
  ['[Request interrupted', 'captain'],
];

/** Who a message is from; null for the harness's own (command output, reminders, subagents reporting back). */
export function messageFrom(text: string): MessageFrom | null {
  const t = text.trim();
  for (const [opening, from] of OPENINGS) if (t.startsWith(opening)) return from;
  return 'captain';
}

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

export function clip(text: string, max: number): string {
  const t = text.replace(REMINDER, '').trim();
  return t.length <= max ? t : `${t.slice(0, max)} …[+${t.length - max}]`;
}

/** One session's transcript, as the office found it. */
export interface Transcript {
  /** What its digest is called: unique, and readable in a citation. */
  name: string;
  kind: SessionKind;
  sessionId: string;
  /** Its JSONL: read one at a time, since a long session's runs to tens of MB. */
  read(): Promise<string>;
}

/**
 * Claude Code keeps each session's transcript under <projects>/<its cwd, with every character but letters and digits
 * turned into ->/<session id>.jsonl. The office's agents all work under data/workspaces, so theirs are the folders
 * that start with that path's name; the kind of agent is the next word (agent_…, lead_…, qa_…).
 */
export function transcriptFolders(projectsDir: string, workspacesDir: string): (since: number) => Promise<Transcript[]> {
  const prefix = `${workspacesDir.replace(/[^A-Za-z0-9]/g, '-')}-`;
  return async (since) => {
    const folders = await fsp.readdir(projectsDir).catch((): string[] => []);
    const found: Transcript[] = [];
    for (const folder of folders.filter((f) => f.startsWith(prefix))) {
      const rest = folder.slice(prefix.length);
      const kind = (['lead', 'qa', 'agent'] as const).find((k) => rest.startsWith(`${k}-`));
      if (!kind) continue;
      const dir = path.join(projectsDir, folder);
      for (const file of (await fsp.readdir(dir).catch((): string[] => [])).filter((f) => f.endsWith('.jsonl'))) {
        const full = path.join(dir, file);
        const stat = await fsp.stat(full).catch(() => undefined);
        if (!stat || stat.mtimeMs < since) continue;
        const sessionId = file.slice(0, -'.jsonl'.length);
        found.push({ name: `${rest}__${sessionId.slice(0, 8)}`, kind, sessionId, read: () => fsp.readFile(full, 'utf8') });
      }
    }
    return found;
  };
}

/** Reads an agent session's transcript by its id, wherever under the agents' folders it is; undefined when it isn't on this machine (a cloud session's). */
export function transcriptReader(projectsDir: string, workspacesDir: string): (sessionId: string) => Promise<string | undefined> {
  const prefix = `${workspacesDir.replace(/[^A-Za-z0-9]/g, '-')}-`;
  const found = new Map<string, string>();
  return async (sessionId) => {
    let file = found.get(sessionId);
    if (!file) {
      const folders = (await fsp.readdir(projectsDir).catch((): string[] => [])).filter((f) => f.startsWith(prefix));
      for (const folder of folders) {
        const candidate = path.join(projectsDir, folder, `${sessionId}.jsonl`);
        if (fs.existsSync(candidate)) {
          file = candidate;
          found.set(sessionId, file);
          break;
        }
      }
    }
    return file ? fsp.readFile(file, 'utf8').catch(() => undefined) : undefined;
  };
}
