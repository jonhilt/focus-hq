// Where a briefing's receipts are looked up: the lead's checkout (each file cited at the commit it's at, and
// whether it's changed since), the lead's own words in their session's transcript, the ship's log by line, and a pull
// request on GitHub (its title, description, comments, QA's report among them, and reviews). The
// Ops' real sources are `opsSources`; `receiptFor` works on any, so the explain tool is tested on stand-ins.
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { isAbsolute, relative, resolve } from 'node:path';
import { blocks, type LeadToolContext, type PluginHost, run, transcriptLines } from '../../plugin-api/server';
import { quoteLine, type Receipt, type Ref } from './receipts';

/** What a ref can be looked up in. */
export interface Sources {
  /** A file in the lead's checkout: its text, and how it's cited (its path and commit); or why it can't be read. */
  file(lead: LeadToolContext, where: string): Promise<{ text: string; cite: string } | { error: string }>;
  /** What the lead has said so far in their session, each with when. */
  said(lead: LeadToolContext): Promise<{ text: string; at: string }[]>;
  /** A line of the ship's log by its number, as text, and how it's cited. */
  ledger(seq: number): { text: string; cite: string } | undefined;
  /** A pull request, by its repo and number: everything said on it, and how it's cited; or why it can't be read. */
  pr(repo: string, number: number): Promise<{ text: string; cite: string } | { error: string }>;
}

/** The pull request a ref's where names ("owner/repo#12", "repo#12" or "#12"), in one of the lead's repos; or why not. */
export function prOf(where: string, repos: readonly string[]): { repo: string; number: number } | string {
  const m = /^\s*(?:([\w.-]+\/)?([\w.-]+))?\s*#\s*(\d+)\s*$/.exec(where);
  if (!m) return `"${where}" isn't a pull request: give it as owner/repo#number.`;
  const number = Number(m[3]);
  if (!m[2]) return repos.length === 1 ? { repo: repos[0], number } : `say which repo #${number} is in: ${repos.join(', ')}.`;
  const repo = repos.find((r) => r === `${m[1] ?? ''}${m[2]}` || (!m[1] && r.split('/')[1] === m[2]));
  return repo ? { repo, number } : `${m[1] ?? ''}${m[2]} isn't one of your repos (${repos.join(', ')}).`;
}

/** A docs page (with or without the line it's cited at), which is markdown like the lead's words and a pull request's. */
const MARKDOWN_FILE = /\.(md|markdown)(:\d+(-\d+)?)?$/i;

const short = (quote: string, most = 60) => (quote.length > most ? `${quote.slice(0, most - 1).trimEnd()}…` : quote);

/** A ref found in its source, as a receipt; or what's wrong with it, for the lead. */
export async function receiptFor(ref: Ref, lead: LeadToolContext, sources: Sources): Promise<Receipt | string> {
  const quote = ref.quote.trim();
  if (!quote) return `a ${ref.kind} ref with nothing quoted: quote the words that say it.`;
  if (ref.kind === 'file') {
    if (!ref.where) return `a file ref needs where: the file's path.`;
    const file = await sources.file(lead, ref.where);
    if ('error' in file) return file.error;
    const line = quoteLine(file.text, quote, MARKDOWN_FILE.test(ref.where));
    return line ? { label: file.cite.replace('{line}', String(line)), quote } : `"${short(quote)}" isn't in ${ref.where}: quote it exactly as the file has it.`;
  }
  if (ref.kind === 'said') {
    const turn = (await sources.said(lead)).find((t) => quoteLine(t.text, quote, true));
    return turn ? { label: `${lead.agent.name ?? 'Lead'}, ${turn.at}: “${short(quote, 32)}”`, quote } : `"${short(quote)}" isn't anything you've said in this session: quote your own words exactly.`;
  }
  if (ref.kind === 'pr') {
    const which = prOf(ref.where ?? '', lead.checkouts.map((c) => c.repo));
    if (typeof which === 'string') return which;
    const pr = await sources.pr(which.repo, which.number);
    if ('error' in pr) return pr.error;
    return quoteLine(pr.text, quote, true) ? { label: pr.cite, quote } : `"${short(quote)}" isn't in ${which.repo}#${which.number}: quote its title, description or a comment exactly.`;
  }
  const seq = Number(ref.where);
  const event = Number.isInteger(seq) ? sources.ledger(seq) : undefined;
  if (!event) return `there's no line ${ref.where ?? ''} in the ship's log: give a ledger line's seq as where.`;
  return quoteLine(event.text, quote) ? { label: event.cite, quote } : `"${short(quote)}" isn't in ledger line ${seq}.`;
}

/** Every string and number in a ledger line, a line each, for a quote to be found in. */
function flatten(v: unknown): string[] {
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(flatten);
  if (v && typeof v === 'object') return Object.values(v).flatMap(flatten);
  return [];
}

const said = z.array(z.object({ body: z.string().nullish() })).nullish();
/** What `gh pr view` says of a pull request, and its inline review comments from the API. */
const PR_VIEW = z.object({ title: z.string(), body: z.string().nullish(), comments: said, reviews: said });
const INLINE = z.array(z.object({ path: z.string().nullish(), line: z.number().nullish(), body: z.string().nullish() }));

/** Everything said on a pull request, for a quote to be found in: title, description, comments, reviews, and its inline review comments with where they are. */
export function prText(view: z.infer<typeof PR_VIEW>, inline: z.infer<typeof INLINE>): string {
  return [
    view.title,
    view.body ?? '',
    ...(view.comments ?? []).map((c) => c.body ?? ''),
    ...(view.reviews ?? []).map((r) => r.body ?? ''),
    ...inline.map((c) => `${c.path ?? ''}${c.line ? `:${c.line}` : ''}\n${c.body ?? ''}`),
  ].filter(Boolean).join('\n');
}

const clock = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'earlier');

/** Ops' own sources: the lead's checkouts on disk, their session's transcript, and the ledger. */
export function opsSources(host: PluginHost): Sources {
  return {
    async file(lead, where) {
      const path = where.replace(/:\d+(-\d+)?$/, '');
      // a path may start with its repo's folder, which only matters when the goal has more than one
      for (const { dir } of lead.checkouts) {
        const folder = dir.split('/').at(-1) ?? '';
        const inside = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
        const full = resolve(dir, inside);
        const rel = relative(dir, full);
        if (rel.startsWith('..') || isAbsolute(rel)) continue;
        const text = await readFile(full, 'utf8').catch(() => undefined);
        if (text === undefined) continue;
        const sha = (await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir }).catch(() => '')).trim();
        const changed = (await run('git', ['status', '--porcelain', '--', rel], { cwd: dir }).catch(() => '')).trim();
        return { text, cite: `${rel}:{line}${sha ? ` @${sha}` : ''}${changed ? ' (uncommitted)' : ''}` };
      }
      return { error: `there's no file ${path} in your checkout.` };
    },
    async said(lead) {
      const id = lead.agent.sessionId;
      const jsonl = id ? await host.transcript(id) : undefined;
      if (!jsonl) return [];
      const said: { text: string; at: string }[] = [];
      for (const line of transcriptLines(jsonl)) {
        if (line.type !== 'assistant') continue;
        const text = blocks(line).filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n');
        if (text) said.push({ text, at: clock(line.timestamp) });
      }
      return said;
    },
    ledger(seq) {
      const event = host.ledger().find((e) => e.seq === seq);
      return event && { text: flatten(event).join('\n'), cite: `ledger #${seq} · ${event.kind} · ${clock(new Date(event.at).toISOString())}` };
    },
    async pr(repo, number) {
      try {
        const view = PR_VIEW.parse(JSON.parse(await run('gh', ['pr', 'view', String(number), '--repo', repo, '--json', 'title,body,comments,reviews'])));
        const inline = INLINE.parse(JSON.parse(await run('gh', ['api', `repos/${repo}/pulls/${number}/comments?per_page=100`])));
        return { text: prText(view, inline), cite: `${repo}#${number} · ${short(view.title, 40)}` };
      } catch {
        return { error: `couldn't read ${repo}#${number} on GitHub: is the number right?` };
      }
    },
  };
}
