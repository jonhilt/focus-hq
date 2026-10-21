import { cosAddressee, type CosRoute, type Friction, frictionKey, frictionsByDigest, type LedgerEvent, type SessionDigest } from './ledger';
import { recordOf } from './records';

// Reviewing the ledger at main engineering's master systems table: each event as a line of the log, and the trace of a
// pull request, a goal or a friction, everything the ledger says about it in order, with what it cost. Pure, so the panel only draws.

/** How far back the review can look: the ledger's a few thousand lines at most in that time. */
export const MAX_DAYS = 90;

/** The events of the last `days` days (a whole number from 1 to MAX_DAYS; anything else is 14). */
export function ledgerWindow(events: LedgerEvent[], now: number, days: number): LedgerEvent[] {
  const d = Number.isInteger(days) && days >= 1 ? Math.min(days, MAX_DAYS) : 14;
  return events.filter((e) => e.at > now - d * 86_400_000);
}

/** What the log can be filtered by: a few kinds of event each. */
export const REVIEW_GROUPS = ['qa', 'merged', 'conflicts', 'goals', 'retro', 'sessions', 'frictions'] as const;
export type ReviewGroup = (typeof REVIEW_GROUPS)[number];

export const GROUP_LABEL: Record<ReviewGroup, string> = {
  qa: 'QA',
  merged: 'Merged',
  conflicts: 'Conflicts',
  goals: 'Goals',
  retro: 'Retro',
  sessions: 'Sessions',
  frictions: 'Frictions',
};

/** Shown until the captain says otherwise: sessions and frictions are most of the ledger, and show in each trace. */
export const SHOWN_AT_FIRST: readonly ReviewGroup[] = ['qa', 'merged', 'conflicts', 'goals', 'retro'];

export function groupOf(e: LedgerEvent): ReviewGroup {
  switch (e.kind) {
    case 'qa-verdict':
    case 'checks-sent-back':
    case 'triage':
      return 'qa';
    case 'merged':
    case 'closed':
    case 'merge-check':
      return 'merged';
    case 'conflicts':
      return 'conflicts';
    case 'goal-closed':
      return 'goals';
    case 'retro-decision':
      return 'retro';
    case 'session-digest':
    case 'captain-replies':
    case 'captain-decision':
    case 'cos-verdict':
      return 'sessions';
    case 'session-frictions':
      return 'frictions';
  }
}

/** What a trace follows: one pull request, or every one a goal opened. */
export type TraceSubject =
  | { kind: 'pr'; repo: string; pr: number }
  | { kind: 'goal'; title: string }
  /** A friction, by its `<kind>: <signature>` key: every session it came up in. */
  | { kind: 'friction'; key: string };

export type Tone = 'ok' | 'bad' | 'warn' | 'info';

/** An event as a line of the log. */
export interface LedgerRow {
  seq: number;
  at: number;
  projectId: string;
  group: ReviewGroup;
  /** A word or two on its pill. */
  tag: string;
  tone: Tone;
  title: string;
  detail?: string;
  /** The pull request it's about, to trace. */
  pr?: { repo: string; pr: number };
  goal?: string;
  /** Moments quoted from a session. */
  quotes?: string[];
}

const short = (repo: string) => repo.split('/').pop() ?? repo;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (usd: number) => `$${usd.toFixed(2)}`;

const BY: Record<string, string> = { office: 'by the office', captain: 'by the captain', officer: 'by the operations officer', github: 'on GitHub' };
const RESOLVED: Record<string, string> = {
  office: 'the office merged its base in cleanly',
  auto: 'settled by the repo’s rules for union and generated files',
  agent: 'an agent resolved them',
  'up-to-date': 'already up to date',
};
const MERGE_CHECK: Record<string, string> = {
  passed: 'merge checked',
  failed: 'merge refused, a check failed',
  conflicts: 'merge refused, it conflicts',
  broken: 'merge refused, couldn’t check it',
  overridden: 'merged past the check',
};
/** Where the chief of staff would have sent a lead's turn, in a word or two. */
const COS_ROUTE: Record<CosRoute, string> = { 1: 'carry on', 2: 'card', 3: 'interrupt', 4: 'back to the lead' };
const TRIAGE: Record<string, string> = {
  'retry-qa': 'ran QA again',
  'send-back': 'sent it back',
  'rerun-checks': 'reran its checks',
  close: 'closed it',
  escalate: 'asked the captain',
};

/** How a session span reads: who, for how long, and what it cost and wasted. */
function sessionLine(d: SessionDigest): { title: string; detail: string } {
  const f = d.facts;
  const bits = [plural(f.minutes, 'min', 'min'), f.costUsd !== undefined ? money(f.costUsd) : null, f.wastedCalls ? plural(f.wastedCalls, 'wasted call') : null]
    .filter(Boolean)
    .join(' · ');
  const said = [f.nudges ? plural(f.nudges, 'nudge') : null, f.compactions ? plural(f.compactions, 'compaction') : null, f.captainMessages ? plural(f.captainMessages, 'message') + ' from the captain' : null]
    .filter(Boolean)
    .join(' · ');
  const prs = d.prs.map((p) => `${short(p.repo)} #${p.pr}`).join(', ');
  return { title: `${d.agent} (${d.task}) · ${bits}`, detail: [prs, said, d.backfilled ? 'digested later' : null].filter(Boolean).join(' · ') };
}

const quotes = (frictions: Friction[]) => frictions.map((f) => `${f.signature}: “${f.quote}”`);

/** An event as a line of the log. */
export function ledgerRow(e: LedgerEvent): LedgerRow {
  const base = { seq: e.seq, at: e.at, projectId: e.projectId, group: groupOf(e) };
  switch (e.kind) {
    case 'qa-verdict': {
      const pass = e.verdict === 'pass';
      const total = e.checks.pass + e.checks.fail + e.checks.skip;
      const checks = pass ? `${plural(e.checks.pass, 'check')} passed` : `${e.checks.fail} of ${plural(total, 'check')} failed`;
      const rounds = pass ? (e.failedRounds ? ` · after ${plural(e.failedRounds, 'failed round')}` : ' · first time') : ` · fail ${e.failedRounds}`;
      return { ...base, tag: pass ? 'QA pass' : 'QA fail', tone: pass ? 'ok' : 'bad', title: `${short(e.repo)} #${e.pr} · ${checks}${rounds}`, detail: [e.goal, e.reviewer].filter(Boolean).join(' · '), pr: e, goal: e.goal };
    }
    case 'merged':
    case 'closed': {
      const passed = e.qa === 'passed';
      const qa = passed ? (e.failedRounds ? `QA passed after ${plural(e.failedRounds, 'failed round')}` : 'QA passed first time') : `without a QA pass (QA ${e.qa})`;
      const closes = e.kind === 'merged' && e.closes?.length ? ` · closed ${e.closes.map((n) => `#${n}`).join(', ')}` : '';
      return {
        ...base,
        tag: e.kind === 'merged' ? 'Merged' : 'Closed',
        tone: e.kind === 'closed' ? 'warn' : passed ? 'ok' : 'warn',
        title: `${short(e.repo)} #${e.pr} · ${BY[e.by] ?? e.by} · ${qa}`,
        detail: [e.goal, e.triages ? plural(e.triages, 'triage') : null].filter(Boolean).join(' · ') + closes,
        pr: e,
        goal: e.goal,
      };
    }
    case 'conflicts':
      return {
        ...base,
        tag: 'Conflicts',
        tone: e.resolved === 'agent' ? 'bad' : 'warn',
        title: `${short(e.repo)} #${e.pr} · ${RESOLVED[e.resolved] ?? e.resolved}${e.files?.length ? ` · ${plural(e.files.length, 'file')}` : ''}`,
        detail: [e.files?.join(', '), e.broke ? `broke ${e.broke}` : null, e.goal].filter(Boolean).join(' · '),
        pr: e,
        goal: e.goal,
      };
    case 'merge-check': {
      const said = MERGE_CHECK[e.outcome] ?? e.outcome;
      const at = e.head && e.base ? ` · ${e.head.slice(0, 7)} onto ${e.base.slice(0, 7)}` : '';
      const tone = e.outcome === 'passed' ? 'ok' : e.outcome === 'overridden' || e.outcome === 'broken' ? 'warn' : 'bad';
      return { ...base, tag: 'Merge check', tone, title: `${short(e.repo)} #${e.pr} · ${said} ${BY[e.by] ?? e.by}${at}`, detail: [e.failed, e.goal].filter(Boolean).join(' · '), pr: e, goal: e.goal };
    }
    case 'checks-sent-back':
      return { ...base, tag: 'Sent back', tone: 'warn', title: `${short(e.repo)} #${e.pr} · failing checks sent back: ${e.checks.join(', ')}`, detail: e.goal, pr: e, goal: e.goal };
    case 'triage':
      return { ...base, tag: 'Triage', tone: e.action === 'escalate' ? 'bad' : 'warn', title: `${short(e.repo)} #${e.pr} · ${e.officer} ${TRIAGE[e.action] ?? e.action}`, detail: [e.note, e.goal].filter(Boolean).join(' · '), pr: e, goal: e.goal };
    case 'goal-closed': {
      const g = e.goal;
      const days = Math.max(0, Math.round((g.closedAt - g.openedAt) / 86_400_000));
      return { ...base, tag: 'Goal', tone: 'info', title: `Closed: ${g.title}`, detail: `${g.leadName} · ${plural(g.slices, 'slice')} · ${plural(g.prs.length, 'pull request')} · open ${days ? plural(days, 'day') : 'under a day'}`, goal: g.title };
    }
    case 'retro-decision':
      return {
        ...base,
        tag: 'Retro',
        tone: e.accepted ? 'ok' : 'info',
        title: `${e.accepted ? 'Accepted' : 'Rejected'}: ${e.title}`,
        detail: [e.issue ? `filed as ${short(e.issue.repo)} #${e.issue.number}` : null, plural(e.signatures.length, 'friction signature')].filter(Boolean).join(' · '),
      };
    case 'session-digest': {
      const { title, detail } = sessionLine(e);
      return { ...base, tag: 'Session', tone: e.facts.wastedCalls > 5 || e.facts.nudges > 1 ? 'warn' : 'info', title, detail, pr: e.prs[0], goal: e.goal };
    }
    case 'captain-replies':
      return {
        ...base,
        tag: 'Captain',
        tone: 'info',
        title: e.replies.length ? `${plural(e.replies.length, 'reply', 'replies')} to ${e.agent}` : `Nothing said to ${e.agent}`,
        detail: e.goal ?? '',
      };
    case 'captain-decision':
      return {
        ...base,
        tag: 'Captain',
        tone: 'info',
        title: `Decided: ${e.item.what} → ${e.answer}`,
        detail: [e.agent, e.goal, e.via === 'api' ? 'via the API' : ''].filter(Boolean).join(' · '),
        goal: e.goal,
      };
    case 'cos-verdict':
      return {
        ...base,
        tag: 'CoS',
        tone: e.route === 3 ? 'warn' : 'info',
        title: `CoS: ${COS_ROUTE[e.route]} — ${e.why}`,
        detail: [e.agent, e.goal].filter(Boolean).join(' · '),
        ...(e.message && { quotes: [`To the ${cosAddressee(e.route)}: “${e.message}”`] }),
        goal: e.goal,
      };
    case 'session-frictions':
      return {
        ...base,
        tag: 'Frictions',
        tone: e.frictions.length ? 'warn' : 'info',
        title: e.missing ? 'Session not on this machine: not read' : e.frictions.length ? `${plural(e.frictions.length, 'friction')} found in a session` : 'Nothing got in the way of a session',
        detail: [...new Set(e.frictions.map((f) => f.kind))].join(', '),
        quotes: quotes(e.frictions),
      };
  }
}

/** The events in the window, the newest first, of the groups shown and from the project picked (if one is). */
export function ledgerLog(events: LedgerEvent[], show: ReadonlySet<ReviewGroup>, projectId?: string): LedgerRow[] {
  return events
    .filter((e) => show.has(groupOf(e)) && (!projectId || e.projectId === projectId))
    .map(ledgerRow)
    .sort((a, b) => b.at - a.at || b.seq - a.seq);
}

/** How many of each group there are, for the filter's counts. */
export function groupCounts(events: LedgerEvent[], projectId?: string): Record<ReviewGroup, number> {
  const counts = recordOf(REVIEW_GROUPS, () => 0);
  for (const e of events) if (!projectId || e.projectId === projectId) counts[groupOf(e)]++;
  return counts;
}

/** The log's rows by day, the newest day first. */
export function byDay<R extends { at: number }>(rows: R[], dayOf: (at: number) => string): { day: string; rows: R[] }[] {
  const days: { day: string; rows: R[] }[] = [];
  for (const row of rows) {
    const day = dayOf(row.at);
    const last = days[days.length - 1];
    if (last?.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  }
  return days;
}

export interface TraceTotals {
  prs: number;
  /** QA verdicts, and how many failed. */
  verdicts: number;
  fails: number;
  conflicts: number;
  sessions: number;
  minutes: number;
  costUsd: number;
  wastedCalls: number;
  frictions: number;
}

export interface Trace {
  subject: TraceSubject;
  /** The goal a pull request is a slice of, when the ledger knows. */
  goal?: string;
  steps: LedgerRow[];
  totals: TraceTotals;
}

/**
 * Everything the ledger says about a pull request, or every one a goal opened, oldest first: its verdicts, conflicts,
 * triage and merge, the session spans that worked on it, with the frictions found in them folded into each span's
 * step, and the totals. A span counts towards a goal by its goal, or by working on one of the goal's pull requests.
 */
export function trace(events: LedgerEvent[], subject: TraceSubject): Trace {
  if (subject.kind === 'friction') return frictionTrace(events, subject);
  const samePr = (p: { repo: string; pr: number }) => subject.kind === 'pr' && p.repo === subject.repo && p.pr === subject.pr;
  const goalPrs = new Set<string>();
  if (subject.kind === 'goal')
    for (const e of events) if ('pr' in e && 'repo' in e && e.goal === subject.title) goalPrs.add(`${e.repo}#${e.pr}`);
  const ofGoal = (p: { repo: string; pr: number }) => goalPrs.has(`${p.repo}#${p.pr}`);

  const about = (e: LedgerEvent): boolean => {
    switch (e.kind) {
      case 'session-digest':
        return subject.kind === 'pr' ? e.prs.some(samePr) : e.goal === subject.title || e.prs.some(ofGoal);
      case 'goal-closed':
        return subject.kind === 'goal' && e.goal.title === subject.title;
      case 'captain-replies':
      case 'captain-decision':
      case 'cos-verdict':
        return subject.kind === 'goal' && e.goal === subject.title;
      case 'session-frictions':
      case 'retro-decision':
        return false;
      default:
        return subject.kind === 'pr' ? samePr(e) : e.goal === subject.title || ofGoal(e);
    }
  };

  const found = new Map<string, Friction[]>();
  for (const e of events) if (e.kind === 'session-frictions') found.set(e.key, e.frictions);
  const mine = events.filter(about).sort((a, b) => a.at - b.at || a.seq - b.seq);
  const totals: TraceTotals = { prs: 0, verdicts: 0, fails: 0, conflicts: 0, sessions: 0, minutes: 0, costUsd: 0, wastedCalls: 0, frictions: 0 };
  const prs = new Set<string>();
  let goal: string | undefined;
  const steps = mine.map((e) => {
    const row = ledgerRow(e);
    if ('repo' in e && 'pr' in e) prs.add(`${e.repo}#${e.pr}`);
    if (e.kind !== 'goal-closed' && e.kind !== 'session-frictions' && e.kind !== 'retro-decision' && e.goal) goal ??= e.goal;
    if (e.kind === 'qa-verdict') {
      totals.verdicts++;
      if (e.verdict === 'fail') totals.fails++;
    }
    if (e.kind === 'conflicts' && e.resolved !== 'up-to-date') totals.conflicts++;
    if (e.kind === 'session-digest') {
      for (const p of e.prs) if (subject.kind === 'pr' ? samePr(p) : ofGoal(p)) prs.add(`${p.repo}#${p.pr}`);
      totals.sessions++;
      totals.minutes += e.facts.minutes;
      totals.costUsd += e.facts.costUsd ?? 0;
      totals.wastedCalls += e.facts.wastedCalls;
      const frictions = found.get(e.key) ?? e.frictions ?? [];
      totals.frictions += frictions.length;
      if (frictions.length) return { ...row, quotes: quotes(frictions) };
    }
    return row;
  });
  totals.prs = subject.kind === 'pr' ? 1 : prs.size;
  return { subject, goal: subject.kind === 'pr' ? goal : subject.title, steps, totals };
}

/**
 * Every session a friction came up in, oldest first, each quoting the moment (or moments) it did, and any retro
 * decision taken on it, with the sessions' totals: what the trouble cost, and which pull requests it got in the way of.
 */
function frictionTrace(events: LedgerEvent[], subject: Extract<TraceSubject, { kind: 'friction' }>): Trace {
  const found = frictionsByDigest(events);
  const totals: TraceTotals = { prs: 0, verdicts: 0, fails: 0, conflicts: 0, sessions: 0, minutes: 0, costUsd: 0, wastedCalls: 0, frictions: 0 };
  const prs = new Set<string>();
  const sessions = new Set<string>();
  const steps: LedgerRow[] = [];
  for (const e of [...events].sort((a, b) => a.at - b.at || a.seq - b.seq)) {
    if (e.kind === 'retro-decision' && e.signatures.includes(subject.key)) steps.push(ledgerRow(e));
    if (e.kind !== 'session-digest') continue;
    const hits = (found.get(e.key) ?? []).filter((f) => frictionKey(f) === subject.key);
    if (!hits.length) continue;
    steps.push({ ...ledgerRow(e), quotes: hits.map((f) => `“${f.quote}”`) });
    for (const p of e.prs) prs.add(`${p.repo}#${p.pr}`);
    if (!sessions.has(e.sessionId)) totals.sessions++;
    sessions.add(e.sessionId);
    totals.minutes += e.facts.minutes;
    totals.costUsd += e.facts.costUsd ?? 0;
    totals.wastedCalls += e.facts.wastedCalls;
    totals.frictions += hits.length;
  }
  totals.prs = prs.size;
  return { subject, steps, totals };
}
