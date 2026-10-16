import type { LogKind, LogLine, LogTone } from '../../shared/captainsLog';
import type { LedgerEvent } from '../../shared/ledger';
import { ledgerRow } from '../../shared/ledgerReview';
import { evolveReview, EMPTY_REVIEW, type ReviewEntry } from './reviewJournal';
import { factLine, type JournalEntry } from './runJournal';
import { EMPTY_SLICE, evolveSlice, type SliceFact } from './sliceJournal';

// The captain's log, pure: every journal (each agent's run, each pull request's review, each goal's slices) and the
// ledger, on one timeline, oldest first. Each journal is told by its own machine's facts, so a line is only as good as
// the fact behind it; most facts are the office's bookkeeping (a message queued, a turn asked for), so only the ones a
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
  slices: Source<SliceFact & { seq: number; t: number }>[];
  ledger: readonly LedgerEvent[];
  /** A crew member's name, by agent id, when they're known. */
  nameOf: (agentId: string) => string | undefined;
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
function sliceLines(src: Source<SliceFact & { seq: number; t: number }>, since: number): LogLine[] {
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

const LEDGER_KINDS: Partial<Record<LedgerEvent['kind'], LogKind>> = { merged: 'merged', closed: 'closed' };

function ledgerLines(events: readonly LedgerEvent[], since: number): LogLine[] {
  return events.filter((e) => e.at > since).map((e) => {
    const row = ledgerRow(e);
    const kind = e.kind === 'qa-verdict' ? (e.verdict === 'pass' ? 'pass' : 'fail') : (LEDGER_KINDS[e.kind] ?? 'other');
    const who = e.kind === 'qa-verdict' ? e.reviewer : e.kind === 'session-digest' ? e.agent : 'Office';
    // the detail names who and the goal, which the line has on its own
    const detail = row.detail?.split(' · ').filter((d) => d !== who && d !== row.goal).join(' · ');
    return { t: e.at, who, source: 'ledger', kind, tag: row.tag, tone: row.tone, text: [row.title, detail].filter(Boolean).join(' · '), projectId: e.projectId, ...(row.goal && { goal: row.goal }) };
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
