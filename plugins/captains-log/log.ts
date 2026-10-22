import {
  type Agent,
  EMPTY_REVIEW,
  EMPTY_SLICE,
  evolveReview,
  evolveSlice,
  factLine,
  type JournalEntry,
  type LedgerEvent,
  ledgerRow,
  type LentJournals,
  type Project,
  type ReviewEntry,
  type SliceFact,
  type Stamped,
} from '../../plugin-api/server';
import type { LogKind, LogLine, LogTone } from './shared';

// The captain's log, pure: every journal (each agent's run, each pull request's review, each goal's slices) and the
// ledger, on one timeline, oldest first. Each journal is told by its own machine's facts, so a line is only as good as
// the fact behind it; most facts are Ops' bookkeeping (a message queued, a turn asked for), so only the ones a
// captain coming back would want to hear make a line. QA's verdicts and merges come from the ledger, which has them all.

/** A journal, with who and what it's about. */
export interface Source<E> {
  /** An agent's id, a pull request's key (`owner/repo#12`), or a lead's id. */
  key: string;
  who: string;
  projectId?: string;
  goal?: string;
  agentId?: string;
  entries: readonly E[];
}

export interface LogSources {
  runs: Source<JournalEntry>[];
  reviews: Source<ReviewEntry>[];
  slices: Source<Stamped<SliceFact>>[];
  ledger: readonly LedgerEvent[];
  /** A crew member's name, by agent id, when they're known. */
  nameOf: (agentId: string) => string | undefined;
}

/** What Ops lends the log: its journals written to in the window, its agents, its projects and the ledger. */
export interface LogHost {
  journals: LentJournals;
  agents: readonly Agent[];
  projects: readonly Project[];
  ledger: readonly LedgerEvent[];
}

/** Only the fields that are there. */
const about = (o: { projectId?: string; goal?: string; agentId?: string }) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * Ops' journals, with who and what each is about: a crew member who's gone home is named from the ledger,
 * where their sessions and goals were kept.
 */
export function logSources({ journals, agents, projects, ledger }: LogHost): LogSources {
  const names = new Map<string, string>();
  const goals = new Map<string, { title: string; projectId: string }>();
  for (const e of ledger) {
    if (e.kind === 'session-digest') names.set(e.agentId, e.agent);
    if (e.kind === 'goal-closed') {
      names.set(e.goal.id, e.goal.leadName);
      goals.set(e.goal.id, { title: e.goal.title, projectId: e.projectId });
    }
  }
  const byId = new Map(agents.map((a) => [a.id, a]));
  for (const a of agents) {
    names.set(a.id, a.name);
    if (a.lead) goals.set(a.id, { title: a.lead.title, projectId: a.projectId });
  }
  const nameOf = (id: string) => names.get(id);
  const roomOf = (repo: string) => projects.find((p) => p.repos.includes(repo))?.id;
  const leadOf = (repo: string, number: number) => agents.find((a) => a.lead?.prs.some((p) => p.repo === repo && p.number === number));
  return {
    runs: journals.runs.map(({ key, entries }) => {
      const a = byId.get(key);
      const goal = goals.get(a?.reviewFor ?? key);
      return { key, who: nameOf(key) ?? 'A crew member who’s gone home', ...about({ agentId: key, projectId: a?.projectId ?? goal?.projectId, goal: goal?.title }), entries };
    }),
    reviews: journals.reviews.map(({ key, entries }) => {
      const [repo, number] = [key.slice(0, key.lastIndexOf('#')), Number(key.slice(key.lastIndexOf('#') + 1))];
      return { key, who: 'QA', ...about({ projectId: roomOf(repo), goal: leadOf(repo, number)?.lead?.title }), entries };
    }),
    slices: journals.slices.map(({ key, entries }) => {
      const goal = goals.get(key);
      return { key, who: nameOf(key) ?? 'A lead who’s gone home', ...about({ agentId: key, projectId: goal?.projectId, goal: goal?.title }), entries };
    }),
    ledger,
    nameOf,
  };
}

type Said = { kind: LogKind; tag: string; tone: LogTone; text: string };
const said = (kind: LogKind, tag: string, tone: LogTone, text: string): Said => ({ kind, tag, tone, text });

const short = (key: string) => key.split('/').pop() ?? key;

/** A fact of an agent's run, as a line, if it's one worth a line. */
function runSaid(e: JournalEntry): Said | undefined {
  switch (e.kind) {
    case 'turn-ended':
      if (e.outcome.ok || e.outcome.limited) return undefined;
      return e.outcome.aborted ? said('stopped', 'Stopped', 'info', factLine(e)) : said('failed', 'Failed', 'bad', factLine(e));
    case 'interrupted':
      return said('interrupted', 'Cut off', 'warn', 'Turn cut off when Focus stopped');
    case 'sign-in-mismatch':
      return said('mismatch', 'Sign-in', 'bad', factLine(e));
    case 'asked':
      return said('asked', 'Hand up', 'warn', factLine(e));
    case 'answered':
      return e.dropped ? undefined : said('answered', 'Answered', 'info', factLine(e));
    case 'held':
      return said('held', 'Held', 'warn', factLine(e));
    case 'unheld':
      return said('unheld', 'Off hold', 'info', factLine(e));
    case 'delivered':
      return e.pr ? said('pr', 'PR', 'ok', `Their work is on GitHub: pull request #${e.pr}`) : undefined;
    case 'delivery-failed':
      return said('failed', 'Failed', 'bad', factLine(e));
    default:
      return undefined;
  }
}

function runLines(src: Source<JournalEntry>, since: number): LogLine[] {
  return src.entries.flatMap((e) => {
    const s = e.t > since ? runSaid(e) : undefined;
    return s ? [line(src, e.t, 'run', s)] : [];
  });
}

/** A review's facts as lines: QA picking the PR up, starting again after a restart, ending without a verdict. */
function reviewLines(src: Source<ReviewEntry>, since: number, nameOf: (id: string) => string | undefined): LogLine[] {
  let state = EMPTY_REVIEW;
  const out: LogLine[] = [];
  const pr = short(src.key);
  for (const e of src.entries) {
    state = evolveReview(state, e);
    if (e.t <= since) continue;
    const who = (state.agent && nameOf(state.agent)) ?? 'QA';
    const s =
      e.kind === 'testing' ? said('testing', 'QA', 'info', `Testing ${pr} at ${e.sha.slice(0, 7)}`)
      : e.kind === 'restarted' ? said('restarted', 'Restarted', 'warn', `${pr} starts again: Focus restarted while QA was checking it out`)
      : e.kind === 'ended' ? said('failed', 'QA error', 'bad', `${pr} ended without a verdict: ${e.error}`)
      : e.kind === 'posted' && !e.url ? said('failed', 'Not posted', 'bad', `Couldn't post QA's verdict on ${pr}`)
      : undefined;
    if (s) out.push(line({ ...src, who }, e.t, 'review', s));
  }
  return out;
}

/** A goal's slice facts as lines: the goal taken up, each ship (or ship that failed), each move to fresh code. */
function sliceLines(src: Source<Stamped<SliceFact>>, since: number): LogLine[] {
  let state = EMPTY_SLICE;
  const out: LogLine[] = [];
  for (const e of src.entries) {
    const before = state;
    state = evolveSlice(state, e);
    if (e.t <= since) continue;
    const prs = state.prs.map((p) => `${short(p.repo)} #${p.number}`).join(', ');
    const s =
      e.kind === 'started' ? said('started', 'Goal', 'info', `Took up the goal: slice ${e.slice}`)
      : e.kind === 'shipped' ? said('shipped', 'Shipped', 'ok', `Shipped slice ${state.slice || '?'}${before.ship ? `: ${before.ship.title}` : ''}${prs ? ` → ${prs}` : ''}`)
      : e.kind === 'ship-ended' && e.error ? said('ship-failed', 'Ship failed', 'bad', `Couldn't ship${before.ship ? ` “${before.ship.title}”` : ''}: ${e.error}`)
      : e.kind === 'moved' ? said('moved', `Slice ${state.slice}`, 'info', `Slice ${state.slice} starts on fresh code`)
      : undefined;
    if (s) out.push(line(src, e.t, 'slice', s));
  }
  return out;
}

/** A plugin by its id, as the log names who did something: `chief-of-staff` is the Chief of Staff. */
const pluginName = (id: string): string => id.split('-').map((w) => (w === 'of' ? w : w[0].toUpperCase() + w.slice(1))).join(' ');

const LEDGER_KINDS: Partial<Record<LedgerEvent['kind'], LogKind>> = { merged: 'merged', closed: 'closed' };

function ledgerLines(events: readonly LedgerEvent[], since: number): LogLine[] {
  return events.filter((e) => e.at > since).map((e) => {
    const row = ledgerRow(e);
    const kind = e.kind === 'qa-verdict' ? (e.verdict === 'pass' ? 'pass' : 'fail') : (LEDGER_KINDS[e.kind] ?? 'other');
    const who = e.kind === 'qa-verdict' ? e.reviewer : e.kind === 'session-digest' ? e.agent : e.kind === 'cos-verdict' || e.kind === 'cos-lane' ? 'Chief of Staff' : e.kind === 'lane-raised' ? pluginName(e.by) : 'Ops';
    // the detail names who and the goal, which the line has on its own
    const detail = row.detail?.split(' · ').filter((d) => d !== who && d !== row.goal).join(' · ');
    return { t: e.at, who, source: 'ledger', kind, tag: row.tag, tone: row.tone, text: [row.title, detail].filter(Boolean).join(' · '), ...(row.quotes && { quotes: row.quotes }), projectId: e.projectId, ...(row.goal && { goal: row.goal }) };
  });
}

function line(src: Pick<Source<unknown>, 'who' | 'projectId' | 'goal' | 'agentId'>, t: number, source: LogLine['source'], s: Said): LogLine {
  return { t, who: src.who, source, ...s, ...(src.projectId && { projectId: src.projectId }), ...(src.goal && { goal: src.goal }), ...(src.agentId && { agentId: src.agentId }) };
}

/** Everything since `since`, from every journal and the ledger, oldest first (the ledger's before a journal's at the same moment). */
export function captainsLog(sources: LogSources, since: number): LogLine[] {
  const order = { ledger: 0, slice: 1, review: 2, run: 3 } as const;
  return [
    ...sources.slices.flatMap((s) => sliceLines(s, since)),
    ...sources.reviews.flatMap((s) => reviewLines(s, since, sources.nameOf)),
    ...sources.runs.flatMap((s) => runLines(s, since)),
    ...ledgerLines(sources.ledger, since),
  ].sort((a, b) => a.t - b.t || order[a.source] - order[b.source]);
}
