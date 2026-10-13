import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config';
import { clip, messageFrom } from './retro';
import type { AgentLog, SessionLogs, SubagentMeta } from './sessionTimeline';
import { blocks, transcriptLines } from './transcript';

// The Claude Code sessions on this Mac that the studio's computer can read, for a video built from what really
// happened (docs/studio.md): Claude Code's own transcripts (~/.claude/projects, or CLAUDE_CONFIG_DIR's), and nothing
// else. It finds them by what they were about and loads one whole, its subagents' and workflows' transcripts with it,
// for sessionTimeline.ts to tell.

/** How much of a transcript's start is read to say what it's about. */
const HEAD_BYTES = 256 * 1024;
/** How many of the newest sessions are looked through for a search. */
const LOOKED_THROUGH = 400;

export interface SessionSummary {
  id: string;
  /** Its folder under the projects folder: Claude Code names it after the session's working directory. */
  project: string;
  modifiedAt: number;
  bytes: number;
  /** Claude Code's own title for it, if it gave one. */
  title?: string;
  /** What was first asked in it. */
  asked?: string;
  agents: number;
}

/** The folders the studio may read sessions from. */
export const sessionRoots = (): string[] => [paths.transcripts];

/** Whether `file` is inside `root` (both resolved): a session is only ever read from inside a root. */
export function inside(root: string, file: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** What a transcript's start says it's about: Claude Code's title, and the first thing asked. */
export function aboutSession(head: string): { title?: string; asked?: string } {
  let title: string | undefined;
  let asked: string | undefined;
  for (const line of transcriptLines(head)) {
    const raw = line as { type?: string; aiTitle?: string };
    if (raw.type === 'ai-title' && raw.aiTitle) title ??= raw.aiTitle;
    if (!asked && line.type === 'user' && !line.isMeta) {
      for (const b of blocks(line)) {
        const text = b.type === 'text' ? b.text ?? '' : '';
        if (clip(text, 1) && messageFrom(text) === 'captain') asked = clip(text, 240);
      }
    }
    if (title && asked) break;
  }
  return { ...(title && { title }), ...(asked && { asked }) };
}

/** What each agent of a workflow run returned to its script, by agent id, from the run's journal. */
export function journalResults(journal: string): Map<string, string> {
  const results = new Map<string, string>();
  for (const line of transcriptLines(journal)) {
    const entry = line as { type?: string; agentId?: string; result?: unknown };
    if (entry.type === 'result' && entry.agentId) results.set(entry.agentId, typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result));
  }
  return results;
}

/** A session's subagents' transcripts (and its workflows' agents'), with what Claude Code noted beside each. */
async function agentLogs(dir: string): Promise<AgentLog[]> {
  const read = async (folder: string, workflow?: string): Promise<AgentLog[]> => {
    const names = await fs.readdir(folder).catch(() => [] as string[]);
    // a workflow run's journal says what each of its agents returned to the script
    const results = workflow ? journalResults(await fs.readFile(path.join(folder, 'journal.jsonl'), 'utf8').catch(() => '')) : new Map<string, string>();
    return Promise.all(names.filter((n) => /^agent-[\w-]+\.jsonl$/.test(n)).map(async (n) => {
      const jsonl = await fs.readFile(path.join(folder, n), 'utf8');
      const meta = await fs.readFile(path.join(folder, n.replace(/\.jsonl$/, '.meta.json')), 'utf8').then((t) => JSON.parse(t) as SubagentMeta).catch(() => ({}));
      const result = results.get(n.slice('agent-'.length, -'.jsonl'.length));
      return { meta, jsonl, ...(workflow && { workflow }), ...(result !== undefined && { result }) };
    }));
  };
  const runs = await fs.readdir(path.join(dir, 'subagents', 'workflows')).catch(() => [] as string[]);
  const nested = await Promise.all(runs.map((run) => read(path.join(dir, 'subagents', 'workflows', run), run)));
  return [...(await read(path.join(dir, 'subagents'))), ...nested.flat()];
}

/** Every session transcript in the roots, newest first: its file, when it last changed and its size. */
async function transcripts(): Promise<{ file: string; project: string; id: string; modifiedAt: number; bytes: number }[]> {
  const found: { file: string; project: string; id: string; modifiedAt: number; bytes: number }[] = [];
  for (const root of sessionRoots()) {
    const projects = await fs.readdir(root).catch(() => [] as string[]);
    for (const project of projects) {
      const names = await fs.readdir(path.join(root, project)).catch(() => [] as string[]);
      for (const name of names.filter((n) => n.endsWith('.jsonl'))) {
        const file = path.join(root, project, name);
        const stat = await fs.stat(file).catch(() => undefined);
        if (stat?.isFile()) found.push({ file, project, id: name.slice(0, -'.jsonl'.length), modifiedAt: stat.mtimeMs, bytes: stat.size });
      }
    }
  }
  return found.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** The newest sessions, or those whose title, first ask or folder mentions `query`: at most `limit`. */
export async function listSessions(query = '', limit = 20): Promise<SessionSummary[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: SessionSummary[] = [];
  for (const t of (await transcripts()).slice(0, LOOKED_THROUGH)) {
    const handle = await fs.open(t.file, 'r');
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(HEAD_BYTES), 0, HEAD_BYTES, 0).finally(() => void handle.close());
    const about = aboutSession(buffer.subarray(0, bytesRead).toString('utf8'));
    const text = `${about.title ?? ''} ${about.asked ?? ''} ${t.project}`.toLowerCase();
    if (!words.every((w) => text.includes(w))) continue;
    const agents = (await agentLogs(t.file.slice(0, -'.jsonl'.length)).catch(() => [])).length;
    out.push({ id: t.id, project: t.project, modifiedAt: t.modifiedAt, bytes: t.bytes, ...about, agents });
    if (out.length >= limit) break;
  }
  return out;
}

/** A session by its id or its transcript's path, read whole with its agents: only from inside the roots. */
export async function loadSession(ref: string): Promise<SessionLogs> {
  const wanted = ref.trim();
  let file: string | undefined;
  if (wanted.includes('/') || wanted.endsWith('.jsonl')) {
    const real = await fs.realpath(wanted.replace(/^~(?=\/)/, process.env.HOME ?? '~')).catch(() => undefined);
    if (real && real.endsWith('.jsonl') && (await Promise.all(sessionRoots().map((r) => fs.realpath(r).catch(() => r)))).some((r) => inside(r, real))) file = real;
    if (!file) throw new Error(`The studio can only read Claude Code's own session transcripts (a .jsonl under ${sessionRoots().join(' or ')}), and ${wanted} isn't one.`);
  } else {
    if (!/^[\w-]+$/.test(wanted)) throw new Error('Give a session by its id (as the sessions tool lists them) or its transcript\'s path.');
    file = (await transcripts()).find((t) => t.id === wanted)?.file;
    if (!file) throw new Error(`There's no session ${wanted}: look it up with the sessions tool.`);
  }
  const main = await fs.readFile(file, 'utf8');
  return { id: path.basename(file, '.jsonl'), main, agents: await agentLogs(file.slice(0, -'.jsonl'.length)) };
}
