import { FIX_KINDS, type FixKind, type GoalRecord, type RetroEvidence, type RetroProposal } from '../../shared/types';
import { type LedgerEvent, reportCard, reportLines } from '../../shared/ledger';

// The chief engineer's retro, the pure half: what the office makes of its agents' Claude Code transcripts before the
// engineer reads them, and what it asks of the engineer. Transcripts are huge (tool output, file contents); a session's
// digest keeps who said what to the agent, when, what the agent had just said before the captain spoke, QA's verdicts
// and the tool errors, which is what a retro looks for. The I/O is in engineer.ts.

export type SessionKind = 'lead' | 'agent' | 'qa';

/** Who a message to the agent came from, as far as its wording tells: the office's own messages have set openings. */
export type MessageFrom = 'captain' | 'office' | 'qa' | 'compacted';

export interface DigestMessage {
  at?: string;
  from: MessageFrom;
  text: string;
  /** For the captain's messages: the last thing the agent said before it. */
  before?: string;
}

export interface SessionDigest {
  /** The digest's file name under sessions/, which proposals cite. */
  name: string;
  kind: SessionKind;
  sessionId: string;
  title?: string;
  first?: string;
  last?: string;
  turns: number;
  toolCalls: number;
  errors: string[];
  messages: DigestMessage[];
  verdicts: { verdict: string; summary: string }[];
}

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

const LIMIT: Record<MessageFrom, number> = { captain: 2000, office: 700, qa: 900, compacted: 200 };

type Block = { type?: string; text?: string; name?: string; input?: unknown; is_error?: boolean; content?: unknown };

function blocks(message: unknown): Block[] {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Block[]).map((b) => b.text ?? '').join(' ');
}

/** One session's transcript (Claude Code's JSONL), digested. Lines that don't parse are skipped. */
export function digestSession(jsonl: string, meta: { name: string; kind: SessionKind; sessionId: string }): SessionDigest {
  const digest: SessionDigest = { ...meta, turns: 0, toolCalls: 0, errors: [], messages: [], verdicts: [] };
  let lastSaid = '';
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let entry: { type?: string; timestamp?: string; isMeta?: boolean; message?: unknown; aiTitle?: string };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    const at = entry.timestamp;
    if (at) {
      digest.first ??= at;
      digest.last = at;
    }
    if (entry.type === 'ai-title' && entry.aiTitle) digest.title = entry.aiTitle;
    if (entry.type === 'assistant') {
      digest.turns++;
      for (const b of blocks(entry.message)) {
        if (b.type === 'tool_use') {
          digest.toolCalls++;
          const input = (b.input ?? {}) as { verdict?: unknown; summary?: unknown };
          if (b.name === 'StructuredOutput' && typeof input.verdict === 'string') digest.verdicts.push({ verdict: input.verdict, summary: clip(String(input.summary ?? ''), 400) });
        } else if (b.type === 'text' && b.text?.trim()) lastSaid = b.text;
      }
    }
    if (entry.type === 'user' && !entry.isMeta) {
      for (const b of blocks(entry.message)) {
        if (b.type === 'tool_result' && b.is_error) digest.errors.push(clip(resultText(b.content).split('\n')[0] ?? '', 200));
        if (b.type !== 'text' || !b.text?.trim()) continue;
        const from = messageFrom(b.text);
        if (!from) continue;
        digest.messages.push({ at, from, text: clip(b.text, LIMIT[from]), before: from === 'captain' && lastSaid ? clip(lastSaid, 400) : undefined });
      }
    }
  }
  return digest;
}

const minute = (at?: string) => (at ? at.slice(0, 16).replace('T', ' ') : '?');

/** A digest as the engineer reads it. */
export function renderDigest(d: SessionDigest): string {
  const out = [
    `# ${d.name}`,
    `${d.kind} session ${d.sessionId}${d.title ? ` · ${d.title}` : ''}`,
    `${minute(d.first)} → ${minute(d.last)} · ${d.turns} assistant messages · ${d.toolCalls} tool calls · ${d.errors.length} tool errors`,
    '',
    '## Messages to the agent',
    ...d.messages.map((m) => `- [${minute(m.at)}] ${m.from.toUpperCase()}: ${m.text}${m.before ? `\n  (the agent had just said: ${JSON.stringify(m.before)})` : ''}`),
  ];
  if (d.verdicts.length) out.push('', '## QA verdicts', ...d.verdicts.map((v) => `- ${v.verdict}: ${v.summary}`));
  if (d.errors.length) out.push('', '## Tool errors', ...d.errors.slice(0, 12).map((e) => `- ${e}`), ...(d.errors.length > 12 ? [`- …and ${d.errors.length - 12} more`] : []));
  return out.join('\n') + '\n';
}

/**
 * A tool error with its specifics blurred, so the same failure in different sessions counts as one: every word that
 * isn't plain letters (a path, a port, a glob, a quoted command) becomes …, and the first few words are what's left.
 */
export function errorShape(error: string): string {
  return error
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (/^[a-z]+[:,.]?$/.test(word) ? word : '…'))
    .join(' ')
    .replace(/…( …)+/g, '…')
    .trim()
    .split(' ')
    .slice(0, 8)
    .join(' ');
}

/** The tool errors seen in more than one session, most widespread first, with the sessions they were in. */
export function frequentErrors(digests: SessionDigest[], top = 15): { shape: string; sessions: string[]; count: number }[] {
  const seen = new Map<string, { sessions: Set<string>; count: number }>();
  for (const d of digests) {
    for (const e of d.errors) {
      const shape = errorShape(e);
      const entry = seen.get(shape) ?? { sessions: new Set<string>(), count: 0 };
      entry.sessions.add(d.name);
      entry.count++;
      seen.set(shape, entry);
    }
  }
  return [...seen.entries()]
    .filter(([, e]) => e.sessions.size > 1)
    .map(([shape, e]) => ({ shape, sessions: [...e.sessions], count: e.count }))
    .sort((a, b) => b.sessions.length - a.sessions.length || b.count - a.count)
    .slice(0, top);
}

/** INDEX.md: every session in a line, the widespread tool errors, and where to start. */
export function renderIndex(digests: SessionDigest[], days: number): string {
  const byKind = (k: SessionKind) => digests.filter((d) => d.kind === k).length;
  const captain = (d: SessionDigest) => d.messages.filter((m) => m.from === 'captain').length;
  const fails = (d: SessionDigest) => d.verdicts.filter((v) => v.verdict !== 'pass').length;
  const rows = [...digests]
    .sort((a, b) => (a.first ?? '').localeCompare(b.first ?? ''))
    .map((d) => `| ${d.name} | ${d.kind} | ${minute(d.first)} | ${captain(d)} | ${d.messages.length - captain(d)} | ${d.verdicts.map((v) => v.verdict).join(' ') || '–'} | ${d.toolCalls} | ${d.errors.length} |`);
  const errors = frequentErrors(digests);
  return [
    `# The last ${days} days: ${digests.length} sessions (${byKind('lead')} leads, ${byKind('agent')} developers, ${byKind('qa')} QA)`,
    '',
    `Captain messages: ${digests.reduce((n, d) => n + captain(d), 0)} · QA verdicts: ${digests.reduce((n, d) => n + d.verdicts.length, 0)} (${digests.reduce((n, d) => n + fails(d), 0)} not passed) · tool errors: ${digests.reduce((n, d) => n + d.errors.length, 0)}`,
    '',
    '## Tool errors in more than one session',
    ...(errors.length ? errors.map((e) => `- ${e.sessions.length} sessions, ${e.count}×: \`${e.shape}\` (${e.sessions.slice(0, 6).join(', ')}${e.sessions.length > 6 ? ', …' : ''})`) : ['- none']),
    '',
    '## Sessions (files under sessions/)',
    '| file | kind | started | captain msgs | other msgs | QA verdicts | tool calls | tool errors |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n') + '\n';
}

/** ledger.md: the report card and the ledger's lines in the window, one per event. */
export function renderLedger(events: LedgerEvent[], now: number, days: number): string {
  const since = now - days * 24 * 60 * 60 * 1000;
  const recent = events.filter((e) => e.at > since);
  const { headline, lines } = reportLines(reportCard(events, now, days));
  const line = (e: LedgerEvent) => {
    const when = new Date(e.at).toISOString().slice(0, 16).replace('T', ' ');
    if (e.kind === 'goal-closed') return `- ${when} goal closed: “${e.goal.title}” (${e.goal.slices} slices)`;
    const { kind, at: _at, projectId: _p, repo, pr, ...rest } = e;
    return `- ${when} ${kind} ${repo}#${pr} ${JSON.stringify(rest)}`;
  };
  return [`# The ledger: ${headline}`, ...lines.map((l) => `- ${l}`), '', '## Events', ...(recent.length ? recent.map(line) : ['- none yet: the ledger only started recently']), ''].join('\n');
}

/** goals.md: the goals closed in the window, with what each lead learned. */
export function renderGoals(goals: (GoalRecord & { project: string })[], now: number, days: number): string {
  const since = now - days * 24 * 60 * 60 * 1000;
  const recent = goals.filter((g) => g.closedAt > since);
  return [
    '# Goals closed in the window, and what their leads learned',
    ...recent.flatMap((g) => [`## ${g.title} (${g.project}, lead ${g.leadName}, ${g.slices} slices)`, ...(g.note?.learned.length ? g.note.learned.map((l) => `- ${l}`) : ['- (nothing noted)']), '']),
    ...(recent.length ? [] : ['- none']),
  ].join('\n') + '\n';
}

export function engineerSystemPrompt(name: string): string {
  return `
# You are ${name}, chief engineer aboard the Focus

The Focus is an office where Claude Code agents build software for the captain: each goal's lead works with the captain a slice at a time and ships pull requests, developers resolve issues, and QA officers review every pull request before it merges. You keep the ship running. Today you look back over the office's recent sessions and bring the captain a short list of changes to how the office works (its harness, prompts, checks and habits) so goals get done more reliably and easily, and the code can be trusted.

Your current directory holds what the office gathered for you, read-only:
- INDEX.md: every session in a line (who spoke, QA verdicts, tool calls and errors) and the tool errors seen in more than one session. Start here.
- sessions/<file>.md: one digest per session, in order: each message the agent got (CAPTAIN, OFFICE, QA, COMPACTED), what the agent had just said before the captain spoke, QA's verdicts, and its tool errors.
- ledger.md: what happened to pull requests (QA verdicts, merges and who merged them, conflicts, triage) and the report card.
- goals.md: goals that closed, and what their leads learned.

How to work:
- Read before you judge. Go through the sessions with the most captain messages, QA fails, office fix requests and tool errors first, then sample the rest. Note each notable moment: the captain correcting, re-asking or nudging ("continue", "go"), asking for an explanation, an agent stopping when it needn't have, rework (QA fails, conflicts, re-shipping), the same tool error again, QA passing something that later needed fixing, time lost to the environment.
- Only a pattern with at least two moments in different places becomes a proposal, and every moment you cite must be in a digest: name its file, its time, and a short quote. If you can't trace a proposal to specific moments, drop it. No generic advice.
- Prefer the cheapest fix that would work, in this order: a check or automation the office runs (check), a rule for QA (qa-rule), a pointer in a prompt, CLAUDE.md or the docs (pointer), or taking out something that isn't earning its keep (delete). A rule written in prose is the last resort for anything a machine could check.
- Say how the next retro can tell whether a fix worked: a number to watch, with its value today.
- Rank by what costs the captain and the office most. Ten proposals at most; fewer, sharper ones are better.
- Note a few things that clearly went well, and one-off worries to watch that aren't patterns yet.
- You change nothing and file nothing: the captain decides what to do with each proposal.

Finish with the structured result.
`.trim();
}

export function engineerPrompt(days: number, sessions: number): string {
  return `Look back over the last ${days} days: ${sessions} sessions are digested in sessions/. Start with INDEX.md.`;
}

export const RETRO_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'proposals', 'wentWell', 'watch'],
  properties: {
    summary: { type: 'string', description: 'Two to four sentences: how the period went and the biggest theme.' },
    proposals: {
      type: 'array',
      maxItems: 10,
      description: 'Most worth doing first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'problem', 'evidence', 'fix', 'kind', 'measure'],
        properties: {
          title: { type: 'string', description: 'Imperative, under 80 characters.' },
          problem: { type: 'string', description: 'What keeps happening and what it costs.' },
          evidence: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['session', 'quote'],
              properties: {
                session: { type: 'string', description: 'The digest file name under sessions/, without .md, or "ledger".' },
                at: { type: 'string', description: 'The time, as the digest shows it.' },
                quote: { type: 'string', description: 'A short quote or description of the moment.' },
              },
            },
          },
          fix: { type: 'string', description: 'What to change, concretely.' },
          kind: { type: 'string', enum: [...FIX_KINDS] },
          measure: { type: 'string', description: 'The number the next retro should watch, with its value today.' },
        },
      },
    },
    wentWell: { type: 'array', items: { type: 'string' } },
    watch: { type: 'array', items: { type: 'string' }, description: 'One-offs worth keeping an eye on.' },
  },
};

export interface RetroFindings {
  summary: string;
  proposals: RetroProposal[];
  wentWell: string[];
  watch: string[];
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strings = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/**
 * The engineer's structured result, checked: a proposal resting on fewer than two moments, or citing a session that
 * isn't among the digests, doesn't make it through. That's the rule that keeps a retro from inventing generic advice.
 */
export function parseRetro(out: unknown, sessionNames: ReadonlySet<string>): RetroFindings | undefined {
  if (!out || typeof out !== 'object') return undefined;
  const o = out as Record<string, unknown>;
  const known = (e: RetroEvidence) => e.session === 'ledger' || sessionNames.has(e.session.replace(/\.md$/, '').replace(/^sessions\//, ''));
  const proposals = (Array.isArray(o.proposals) ? o.proposals : []).flatMap((p): RetroProposal[] => {
    const r = (p ?? {}) as Record<string, unknown>;
    const evidence = (Array.isArray(r.evidence) ? r.evidence : [])
      .map((e) => {
        const x = (e ?? {}) as Record<string, unknown>;
        return { session: str(x.session).replace(/\.md$/, '').replace(/^sessions\//, ''), at: str(x.at) || undefined, quote: str(x.quote) };
      })
      .filter((e) => e.session && e.quote && known(e));
    const kind: FixKind = FIX_KINDS.find((k) => k === r.kind) ?? 'pointer';
    if (!str(r.title) || evidence.length < 2) return [];
    return [{ title: str(r.title), problem: str(r.problem), evidence, fix: str(r.fix), kind, measure: str(r.measure) }];
  });
  if (!str(o.summary) && !proposals.length) return undefined;
  return { summary: str(o.summary), proposals, wentWell: strings(o.wentWell), watch: strings(o.watch) };
}
