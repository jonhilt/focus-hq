import type { QaBadgeState } from './qa';
import type { AgentTask, GoalRecord, TriageAction } from './types';

// The ship's log of how work went: what QA said, who merged what and whether QA had passed it, conflicts, triage,
// closed goals, and a digest of each agent session as it ends. The office appends to it as things happen and never
// rewrites it (data/ledger.jsonl), so it outlives the reviews, agents and transcripts it's about. Each line carries the
// format's version and a sequence number, so a gap or a line cut short shows on load (`checkLedger`). The chief
// engineer reads it, and `reportCard` sums it up for their screen.

/** The version of the line format: 1 was the first ledger's (no `v`, no `seq`). */
export const LEDGER_VERSION = 2;

/** Who merged or closed a pull request: the office (auto-merge), the captain (the board), the operations officer, or someone on GitHub. */
export type Closer = 'office' | 'captain' | 'officer' | 'github';

interface PrRef {
  repo: string;
  pr: number;
  /** The goal the PR is a slice of, by title. */
  goal?: string;
}

export type LedgerEntry =
  | (PrRef & { kind: 'qa-verdict'; verdict: 'pass' | 'fail'; sha?: string; reviewer: string; checks: { pass: number; fail: number; skip: number }; failedRounds: number })
  /** `qa` is the PR's QA badge as it merged: anything but `passed` merged without QA passing its head commit. */
  | (PrRef & { kind: 'merged'; by: Closer; qa: QaBadgeState; failedRounds: number; triages: number })
  | (PrRef & { kind: 'closed'; by: Closer; qa: QaBadgeState; failedRounds: number; triages: number })
  /** The PR conflicted with its base: the office merged the base in cleanly, or an agent had to resolve them. */
  | (PrRef & { kind: 'conflicts'; resolved: 'office' | 'agent' | 'up-to-date' })
  | (PrRef & { kind: 'checks-sent-back'; checks: string[] })
  | (PrRef & { kind: 'triage'; officer: string; action: TriageAction; note: string })
  | { kind: 'goal-closed'; goal: GoalRecord }
  /** A span of an agent's session, digested when it ends (or a lead's slice lands): see `SessionFacts`. */
  | SessionDigest;

/**
 * What code alone can tell about a span of an agent's session, from its transcript and the ledger. A wasted call is
 * one that errored (a refusal included), or ran a call that had already failed again unchanged; running something that
 * worked again (the tests after an edit) isn't. A nudge is the captain saying little more than "go on".
 */
export interface SessionFacts {
  minutes: number;
  /** Assistant messages in the transcript (Claude Code writes each block of a reply as one). */
  turns: number;
  toolCalls: number;
  failedCalls: number;
  /** Of the failed calls: those a guard, hook or permission check refused. */
  refusedCalls: number;
  /** Calls that had already failed, run again unchanged. */
  repeatedCalls: number;
  wastedCalls: number;
  /** What the span cost, from the agent's running total; missing when the office doesn't know. */
  costUsd?: number;
  captainMessages: number;
  nudges: number;
  officeMessages: number;
  compactions: number;
  /** The ledger's QA fails and conflicts on the span's pull requests, so far. */
  qaFails: number;
  conflicts: number;
}

export interface SessionDigest {
  kind: 'session-digest';
  /** `<session id>:<last transcript line's uuid>`: the same span is never digested twice. */
  key: string;
  sessionId: string;
  agentId: string;
  agent: string;
  task: AgentTask;
  /** The pull requests the span was for. */
  prs: { repo: string; pr: number }[];
  goal?: string;
  /** The span: the uuid of the transcript line it starts after (missing from the start), and of its last line. */
  afterUuid?: string;
  toUuid: string;
  from?: string;
  to?: string;
  /** What the session had cost by the end of the span (its running total): where the next span's cost starts. */
  sessionCostUsd?: number;
  facts: SessionFacts;
}

export type LedgerEvent = LedgerEntry & { at: number; projectId: string; seq: number };

/** A ledger line as written: the event, with the format's version first. */
export function ledgerLine(event: LedgerEvent): string {
  const { seq, ...rest } = event;
  return `${JSON.stringify({ v: LEDGER_VERSION, seq, ...rest })}\n`;
}

export interface LedgerCheck {
  events: LedgerEvent[];
  /** The sequence number the next line gets. */
  nextSeq: number;
  /** Bytes of the text that hold whole lines; anything after is a line cut short, to be cut off. */
  goodBytes: number;
  /** A last line cut short when Focus stopped mid-write: dropped. */
  tornTail: boolean;
  /** Lines in the first format (no `seq`), numbered here: the file wants rewriting in this one. */
  migrated: boolean;
  /** Damage in the middle: lines that don't parse, sequence numbers missing, repeated or going back. */
  problems: string[];
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * Reads the ledger's text, checking it's whole: numbered without gaps, every line readable. A last line cut short (a
 * write interrupted) is expected now and then and only dropped; anything else is reported, never silently skipped.
 */
export function checkLedger(text: string): LedgerCheck {
  const check: LedgerCheck = { events: [], nextSeq: 1, goodBytes: bytes(text), tornTail: false, migrated: false, problems: [] };
  const lines = text.split('\n');
  const tail = lines.pop() ?? '';
  if (tail.trim()) {
    // no newline after it: written in full only if it parses
    try {
      JSON.parse(tail);
      lines.push(tail);
    } catch {
      check.tornTail = true;
      check.goodBytes -= bytes(tail);
    }
  }
  let sawV2 = false;
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      check.problems.push(`line ${i + 1} isn’t readable`);
      continue;
    }
    if (typeof raw.at !== 'number' || typeof raw.kind !== 'string') {
      check.problems.push(`line ${i + 1} isn’t an event`);
      continue;
    }
    const { v: _v, ...event } = raw;
    if (typeof raw.seq !== 'number') {
      if (sawV2) check.problems.push(`line ${i + 1} has no sequence number`);
      check.migrated = true;
      check.events.push({ ...event, seq: check.nextSeq++ } as LedgerEvent);
      continue;
    }
    sawV2 = true;
    if (raw.seq > check.nextSeq) check.problems.push(raw.seq === check.nextSeq + 1 ? `line ${check.nextSeq} is missing` : `lines ${check.nextSeq}–${raw.seq - 1} are missing`);
    else if (raw.seq < check.nextSeq) check.problems.push(`line ${i + 1} repeats or goes back to number ${raw.seq}`);
    check.events.push(event as LedgerEvent);
    check.nextSeq = Math.max(check.nextSeq, raw.seq + 1);
  }
  return check;
}

export interface ReportCard {
  /** The window it covers, in days back from `now`. */
  days: number;
  merged: number;
  /** Merged without QA passing the head commit: the captain overriding, or a merge on GitHub. */
  mergedUnpassed: number;
  /** Merged with QA's first verdict a pass. */
  mergedFirstTime: number;
  closed: number;
  verdicts: number;
  fails: number;
  /** Failed QA rounds per merged PR. */
  roundsPerMerge: number;
  /** PRs that conflicted with their base, and those that needed an agent to resolve them. */
  conflicts: number;
  conflictsForAgent: number;
  checksSentBack: number;
  triages: number;
  goalsClosed: number;
  /** Agent sessions digested, what they cost and the tool calls they wasted, per merged PR (0 with nothing merged). */
  sessions: number;
  costPerMerge: number;
  wastedPerMerge: number;
  /** Agent spend the office knows of, all told. */
  costUsd: number;
  /** Damage found in the ledger when the office opened it: it needs a look. */
  warnings?: string[];
  /** Not damage, but worth knowing: another office holds the ledger, so this one's lines aren't kept. */
  notes?: string[];
}

const DAY = 24 * 60 * 60 * 1000;

/** The last `days` of the ledger, summed up. */
export function reportCard(events: LedgerEvent[], now: number, days = 30): ReportCard {
  const recent = events.filter((e) => e.at > now - days * DAY);
  const of = <K extends LedgerEvent['kind']>(kind: K) => recent.filter((e): e is Extract<LedgerEvent, { kind: K }> => e.kind === kind);
  const merged = of('merged');
  const verdicts = of('qa-verdict');
  const conflicted = distinctPrs(of('conflicts').filter((e) => e.resolved !== 'up-to-date'));
  return {
    days,
    merged: merged.length,
    mergedUnpassed: merged.filter((e) => e.qa !== 'passed').length,
    mergedFirstTime: merged.filter((e) => e.qa === 'passed' && e.failedRounds === 0).length,
    closed: of('closed').length,
    verdicts: verdicts.length,
    fails: verdicts.filter((e) => e.verdict === 'fail').length,
    roundsPerMerge: merged.length ? merged.reduce((n, e) => n + e.failedRounds, 0) / merged.length : 0,
    conflicts: conflicted.length,
    conflictsForAgent: distinctPrs(of('conflicts').filter((e) => e.resolved === 'agent')).length,
    checksSentBack: of('checks-sent-back').length,
    triages: of('triage').length,
    goalsClosed: of('goal-closed').length,
    ...spend(of('session-digest'), merged.length),
  };
}

function spend(digests: SessionDigest[], merged: number) {
  const costUsd = digests.reduce((n, d) => n + (d.facts.costUsd ?? 0), 0);
  const wasted = digests.reduce((n, d) => n + d.facts.wastedCalls, 0);
  return { sessions: digests.length, costUsd, costPerMerge: merged ? costUsd / merged : 0, wastedPerMerge: merged ? wasted / merged : 0 };
}

function distinctPrs(events: (PrRef & { kind: string })[]): string[] {
  return [...new Set(events.map((e) => `${e.repo}#${e.pr}`))];
}

const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');

/** The report card as the engineer's screen shows it: a headline and a few lines. */
export function reportLines(card: ReportCard): { headline: string; lines: string[] } {
  const shown = reportBody(card);
  const first = [...(card.warnings?.length ? [`⚠ Ledger damaged: ${card.warnings[0]}`] : []), ...(card.notes?.length ? [`Ledger: ${card.notes[0]}`] : [])];
  return { ...shown, lines: [...first, ...shown.lines] };
}

function reportBody(card: ReportCard): { headline: string; lines: string[] } {
  if (!card.merged && !card.closed && !card.verdicts) return { headline: 'Gathering evidence', lines: ['Nothing merged or reviewed yet', `Logging QA, merges and conflicts`] };
  return {
    headline: `${card.merged} merged · last ${card.days} days`,
    lines: [
      `QA passed first time: ${percent(card.mergedFirstTime, card.merged)}`,
      `QA rounds failed per merge: ${card.roundsPerMerge.toFixed(1)}`,
      `Merged without a QA pass: ${card.mergedUnpassed}`,
      `Conflicts: ${card.conflicts} (${card.conflictsForAgent} needed an agent)`,
      `Checks sent back: ${card.checksSentBack} · Triaged: ${card.triages}`,
      `Closed unmerged: ${card.closed} · Goals closed: ${card.goalsClosed}`,
      ...(card.sessions ? [`Per merge: $${card.costPerMerge.toFixed(2)} · ${card.wastedPerMerge.toFixed(1)} wasted tool calls`] : []),
    ],
  };
}
