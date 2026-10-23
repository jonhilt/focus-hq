import { fieldsOf, FRICTION_KINDS, type FrictionGroup, type GoalRecord, isRecord, type LedgerEvent, PUBLIC_WORDS_RULE, reportCard, reportLines } from '../../plugin-api/shared';
import { FIX_KINDS, type RetroDraft } from './shared';

// The chief engineer's retro, the pure half. The retro reads the ledger's session digests, not transcripts: code
// groups their frictions by kind and signature and keeps those that came up in three or more sessions; the engineer
// drafts an issue for each (or for a few that are plainly the same trouble), and code adds the quoted evidence. The
// I/O is in engineer.ts.

/** ledger.md: the report card, the ledger's lines on pull requests and goals in the window, and the captain's decisions on earlier drafts. */
export function renderLedger(events: LedgerEvent[], now: number, days: number): string {
  const since = now - days * 24 * 60 * 60 * 1000;
  const recent = events.filter((e) => e.at > since && (e.kind === 'goal-closed' || 'pr' in e));
  const decisions = events.flatMap((e) => (e.kind === 'retro-decision' ? [`- ${e.accepted ? 'accepted' : 'rejected'}: “${e.title}” (${e.signatures.join('; ')})${e.issue ? ` → ${e.issue.repo}#${e.issue.number}` : ''}`] : []));
  const { headline, lines } = reportLines(reportCard(events, now, days));
  const line = (e: LedgerEvent) => {
    const when = new Date(e.at).toISOString().slice(0, 16).replace('T', ' ');
    if (e.kind === 'goal-closed') return `- ${when} goal closed: “${e.goal.title}” (${e.goal.slices} slices)`;
    if (!('pr' in e)) return '';
    const { kind, at: _at, projectId: _p, seq: _s, repo, pr, ...rest } = e;
    return `- ${when} ${kind} ${repo}#${pr} ${JSON.stringify(rest)}`;
  };
  return [
    `# The ledger: ${headline}`,
    ...lines.map((l) => `- ${l}`),
    '',
    '## The captain’s decisions on earlier drafts',
    ...(decisions.length ? decisions : ['- none yet']),
    '',
    '## Pull requests and goals',
    ...(recent.length ? recent.map(line) : ['- none in the window']),
    '',
  ].join('\n');
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

/** At least this many sessions before a friction is a pattern worth an issue; one fewer is worth watching. */
export const PATTERN_SESSIONS = 3;

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

/** frictions.md: each group seen in enough sessions, with its moments quoted, under the id the drafts cite. */
export function renderFrictions(groups: FrictionGroup[], days: number): string {
  return [
    `# Frictions in the last ${days} days that came up in ${PATTERN_SESSIONS} or more sessions`,
    '',
    'Each was found in a session digest by a cheap model told only to find and quote, so a group can hold the odd moment that isn’t really Ops’ doing: weigh the quotes. Kinds:',
    ...Object.entries(FRICTION_KINDS).map(([k, d]) => `- ${k}: ${d}`),
    '',
    ...groups.flatMap((g, i) => [`## G${i + 1}: ${g.key} (${g.sessions} sessions)`, ...g.moments.map((m) => `- ${day(m.at)} ${m.agent}: “${m.quote}”`), '']),
  ].join('\n');
}

export function engineerSystemPrompt(name: string): string {
  return `
# You are ${name}, chief engineer aboard the Focus

The Focus is a starship where Claude Code agents build software for the captain: each goal's lead works with the captain a slice at a time and ships pull requests, developers resolve issues, and QA officers review every pull request before it merges. You keep the ship running. Each agent session is digested as it ends, and its frictions (moments where Ops, its tools or the environment got in the way) are picked out and quoted. Today you turn the ones that keep coming back into issues the captain can accept, so the ship stops tripping over them.

Your current directory holds, read-only:
- frictions.md: the frictions that came up in three or more sessions, grouped (G1, G2, …) with quoted moments. Start here.
- ledger.md: the report card, the captain's decisions on earlier drafts, and what happened to pull requests and goals.
- goals.md: goals that closed, and what their leads learned.

How to work:
- Draft one issue per group that is worth fixing, or one for a few groups that are plainly the same trouble. Leave out a group whose moments, read together, aren't Ops' doing (a bug in the code being worked on, a check in that code doing its job).
- Each issue is for an agent who knows the Focus codebase but not this retro. Its body says what keeps happening and what it costs, then has "## What to build" (the cheapest fix that would work, preferring a check or automation Ops runs over a rule in a prompt; a pointer in CLAUDE.md or the docs only for what a machine can't check; or deleting something that isn't earning its keep) and "## Done when". Don't paste the quotes: Ops adds them under "## Evidence".
- Give each its kind of fix (check, qa-rule, pointer, delete) and the number the next retro should watch, with today's value (the sessions it came up in).
- Most worth doing first; a few sharp drafts beat many. You change nothing and file nothing: the captain decides.
- The ones the captain accepts are filed on GitHub as you wrote them. ${PUBLIC_WORDS_RULE}

Finish with the structured result.
`.trim();
}

export function engineerPrompt(days: number, groups: number): string {
  return `${groups} frictions came up in ${PATTERN_SESSIONS} or more sessions over the last ${days} days. Start with frictions.md.`;
}

export const DRAFTS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'drafts'],
  properties: {
    summary: { type: 'string', description: 'Two or three sentences: how the period went and the biggest theme.' },
    drafts: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['groups', 'title', 'body', 'kind', 'measure'],
        properties: {
          groups: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'The groups it rests on, as in frictions.md: G1, G2…' },
          title: { type: 'string', description: 'Imperative and specific, under 80 characters.' },
          body: { type: 'string', description: 'Markdown: what keeps happening and what it costs, then ## What to build and ## Done when. No quotes: Ops adds the evidence.' },
          kind: { type: 'string', enum: [...FIX_KINDS] },
          measure: { type: 'string', description: 'The number the next retro should watch, with its value today.' },
        },
      },
    },
  },
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The issue's evidence, written by code from the groups' quoted moments, so what's cited is what was found. */
function evidence(groups: FrictionGroup[]): string {
  return ['## Evidence', ...groups.flatMap((g) => [`**${g.key}**, in ${g.sessions} sessions:`, ...g.moments.map((m) => `- ${day(m.at)} ${m.agent}: “${m.quote}”`), ''])].join('\n');
}

/**
 * The engineer's drafts, checked: each must rest on groups that exist (G1 is the first in `groups`), and a group backs
 * one draft at most. The body gets the quoted evidence from code.
 */
export function parseDrafts(out: unknown, groups: FrictionGroup[], newId: () => string): { summary: string; drafts: RetroDraft[] } | undefined {
  if (!isRecord(out)) return undefined;
  const o = out;
  const used = new Set<number>();
  const drafts = (Array.isArray(o.drafts) ? o.drafts : []).flatMap((d): RetroDraft[] => {
    const r = fieldsOf(d);
    const picked = (Array.isArray(r.groups) ? r.groups : [])
      .map((g) => Number(/^G(\d+)$/i.exec(str(g))?.[1]) - 1)
      .filter((i) => i >= 0 && i < groups.length && !used.has(i));
    const title = str(r.title);
    const body = str(r.body);
    if (!picked.length || !title || !body) return [];
    for (const i of picked) used.add(i);
    const on = [...new Set(picked)].map((i) => groups[i]);
    return [{
      id: newId(),
      title: title.slice(0, 120),
      body: `${body}\n\n${evidence(on)}`,
      kind: FIX_KINDS.find((k) => k === r.kind) ?? 'pointer',
      measure: str(r.measure),
      signatures: on.map((g) => g.key),
      sessions: Math.max(...on.map((g) => g.sessions)),
    }];
  });
  if (!str(o.summary) && !drafts.length) return undefined;
  return { summary: str(o.summary), drafts };
}
