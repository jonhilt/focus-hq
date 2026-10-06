import type { Breakdown, BreakdownEdits, BreakdownIssue, SubIssueDraft } from '../../shared/types';

/** How many sub-issues a breakdown has. */
export const SUB_ISSUES = { min: 2, max: 5 };

/** JSON schema for the officer's structured result when they break a briefing down. */
export function breakdownSchema(repos: string[]): Record<string, unknown> {
  const issue = (body: string) => ({
    title: { type: 'string', description: 'Imperative and specific, under 70 characters.' },
    body: { type: 'string', description: body },
  });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['repo', 'epic', 'sub_issues'],
    properties: {
      repo: { type: 'string', enum: repos, description: 'The repository the epic and all its sub-issues are filed in.' },
      epic: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'body'],
        properties: issue('The brief in Markdown: Why, Scope, Acceptance criteria for the feature as a whole, Out of scope.'),
      },
      sub_issues: {
        type: 'array',
        minItems: SUB_ISSUES.min,
        maxItems: SUB_ISSUES.max,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'body', 'depends_on'],
          properties: {
            ...issue('Markdown: Context, What to build, Acceptance criteria, Out of scope. No "Depends on" line.'),
            depends_on: {
              type: 'array',
              items: { type: 'integer' },
              description: '1-based positions of earlier sub-issues that must merge before this one can start. Usually empty.',
            },
          },
        },
      },
    },
  };
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * The officer's structured result as a breakdown. A dependency may only point at an earlier sub-issue, so the
 * sub-issues can be filed in order with every `Depends on` number already known, and there's no cycle to untangle.
 */
export function asBreakdown(out: unknown, repos: string[]): Breakdown {
  const raw = (out ?? {}) as { repo?: unknown; epic?: { title?: unknown; body?: unknown }; sub_issues?: unknown };
  const epic = { title: text(raw.epic?.title), body: text(raw.epic?.body) };
  if (!epic.title || !epic.body) throw new Error('Finished without writing the epic');
  const subs = (Array.isArray(raw.sub_issues) ? (raw.sub_issues as { title?: unknown; body?: unknown; depends_on?: unknown }[]) : [])
    .map((s) => ({ title: text(s?.title), body: text(s?.body), depends: Array.isArray(s?.depends_on) ? (s.depends_on as unknown[]) : [] }))
    .filter((s) => s.title && s.body)
    .slice(0, SUB_ISSUES.max);
  if (subs.length < SUB_ISSUES.min) throw new Error(`Finished with ${subs.length} sub-issue${subs.length === 1 ? '' : 's'}, not ${SUB_ISSUES.min} to ${SUB_ISSUES.max}`);
  const key = (position: number) => `s${position}`;
  return {
    repo: repos.find((r) => r === raw.repo) ?? repos[0],
    epic,
    subIssues: subs.map((s, i) => ({
      key: key(i + 1),
      title: s.title,
      body: s.body,
      dependsOn: [...new Set(s.depends.filter((p): p is number => Number.isInteger(p) && (p as number) >= 1 && (p as number) <= i))].map(key),
    })),
  };
}

/**
 * The breakdown with the manager's edits: new titles and bodies, and the sub-issues they left out dropped (along with
 * any dependency on them). Anything already filed stays as it was filed.
 */
export function applyEdits(breakdown: Breakdown, edits: BreakdownEdits): Breakdown {
  const edit = <T extends BreakdownIssue>(issue: T, change: { title: string; body: string } | undefined): T =>
    issue.number !== undefined || !change ? issue : { ...issue, title: change.title.trim(), body: change.body.trim() };
  const changes = new Map(edits.subIssues.map((s) => [s.key, s]));
  const kept = breakdown.subIssues.filter((s) => s.number !== undefined || changes.has(s.key));
  const keys = new Set(kept.map((s) => s.key));
  const next = {
    repo: breakdown.repo,
    epic: edit(breakdown.epic, edits.epic),
    subIssues: kept.map((s) => ({ ...edit(s, changes.get(s.key)), dependsOn: s.dependsOn.filter((k) => keys.has(k)) })),
  };
  if (!next.subIssues.length) throw new Error('Keep at least one sub-issue, or wrap up as one issue instead');
  const untitled = [next.epic, ...next.subIssues].find((i) => !i.title);
  if (untitled) throw new Error(untitled === next.epic ? 'The epic needs a title' : 'Every sub-issue needs a title');
  return next;
}

/** A sub-issue's body as filed: its `Depends on` line, with the real numbers, first. */
export function filedBody(sub: SubIssueDraft, numbers: ReadonlyMap<string, number>): string {
  const deps = sub.dependsOn.map((k) => numbers.get(k)).filter((n) => n !== undefined);
  return deps.length ? `Depends on ${deps.map((n) => `#${n}`).join(', ')}\n\n${sub.body}` : sub.body;
}
