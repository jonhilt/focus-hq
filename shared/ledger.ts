import { type DecisionStatus, lineProblem } from './decisions';
import type { Lane } from './mergeLaneRules';
import type { QaBadgeState } from './qa';
import { isRecord } from './records';
import type { AgentTask, ArchivedGoal, Effort, GoalRecord, TriageAction } from './types';

// The ship's log of how work went: what QA said, who merged what and whether QA had passed it, conflicts, triage,
// closed goals, and a digest of each agent session as it ends. Ops appends to it as things happen and never
// rewrites it (data/ledger.jsonl), so it outlives the reviews, agents and transcripts it's about. Each line carries the
// format's version and a sequence number, so a gap or a line cut short shows on load (`checkLedger`). The chief
// engineer reads it, and `reportCard` sums it up for their screen.

/** The version of the line format: 1 was the first ledger's (no `v`, no `seq`). */
export const LEDGER_VERSION = 2;

/** Who merged or closed a pull request: Ops (auto-merge), the captain (the board), the operations officer, or someone on GitHub. */
export type Closer = 'office' | 'captain' | 'officer' | 'github';

interface PrRef {
  repo: string;
  pr: number;
  /** The goal the PR is a slice of, by title. */
  goal?: string;
}

/**
 * What a crew member worked to, so a result can be set against the prompt that gave it: its crew file's digest
 * (.focus/crew/, `crewFiles.ts`), the model and effort it ran on (none: the session's default), and Focus's commit.
 */
export interface CrewStamp {
  digest: string;
  model?: string;
  effort?: Effort;
  commit?: string;
}

export type LedgerEntry =
  | (PrRef & { kind: 'qa-verdict'; verdict: 'pass' | 'fail'; sha?: string; reviewer: string; checks: { pass: number; fail: number; skip: number }; failedRounds: number; /** Lines before QA's stamp have none. */ crew?: CrewStamp })
  /**
   * A scorer's grade of one of QA's reports (.focus/scorers/): the label it gave, the score that's worth and whether
   * it passes, why, what QA worked to (its verdict's stamp) and the scorer (its file's name and digest) and model.
   */
  | (PrRef & { kind: 'qa-score'; sha: string; label: string; score: number; passed: boolean; why: string; crew?: CrewStamp; scorer: string; model: string; costUsd?: number })
  /** `qa` is the PR's QA badge as it merged: anything but `passed` merged without QA passing its head commit. */
  | (PrRef & {
    kind: 'merged'; by: Closer; qa: QaBadgeState; failedRounds: number; triages: number; /** Issues it closed, when Ops knew. */ closes?: number[];
    /** A goal's lead's: who (their agent id), and the lane it was in as it merged (docs/merging.md#lanes-how-a-goals-leads-slice-merges). */
    lead?: string; lane?: Lane;
  })
  | (PrRef & { kind: 'closed'; by: Closer; qa: QaBadgeState; failedRounds: number; triages: number })
  /**
   * The PR conflicted with its base: Ops merged the base in cleanly, settled the conflicts by the repo's rules
   * (`auto`: union or generated files), or an agent had to resolve them. `files` are the paths that conflicted (missing
   * on lines from before they were logged); `broke` the check that failed on a merge git made by itself.
   */
  | (PrRef & { kind: 'conflicts'; resolved: 'office' | 'auto' | 'agent' | 'up-to-date'; files?: string[]; broke?: string })
  | (PrRef & { kind: 'checks-sent-back'; checks: string[] })
  /**
   * Ops' merge check before a merge (docs/merging.md): the PR's head merged onto its base, checked. `failed` is
   * the command that failed, the files that conflicted, or why it couldn't run; `overridden` is the captain merging
   * past it on purpose. `base` and `head` are the commits it checked.
   */
  | (PrRef & { kind: 'merge-check'; outcome: 'passed' | 'failed' | 'conflicts' | 'broken' | 'overridden' | 'unchecked'; by: Closer; base?: string; head?: string; failed?: string })
  | (PrRef & { kind: 'triage'; officer: string; action: TriageAction; note: string })
  /** A plugin (`by`, its id) raised a goal's lead's pull request from the lane they shipped it in (docs/merging.md#lanes-how-a-goals-leads-slice-merges). */
  /** A PR a goal's lead opened themselves, which Ops claimed as the goal's from the branches their checkout has been on (server/agents/manager/goalPrs.ts). */
  | (PrRef & { kind: 'pr'; lead: string; agent: string; branch: string; draft: boolean })
  /** A goal's lead's pull request seen ready for review the first time (opened ready, or a draft marked ready): when it went out, for flow and the log. */
  | (PrRef & { kind: 'pr-ready'; lead: string; agent: string; branch: string })
  | (PrRef & { kind: 'lane-raised'; from: Lane; to: Lane; by: string; why: string })
  | { kind: 'goal-closed'; goal: GoalRecord }
  /**
   * A digested span's frictions as the retro's reader found them (`key` is the digest's), quoted from its trimmed
   * text. Written once per span: a span with an entry isn't read again. `missing` says its transcript wasn't there.
   */
  | { kind: 'session-frictions'; key: string; sessionId: string; frictions: Friction[]; reader: string; missing?: boolean }
  /** The captain accepted (and filed) or rejected a retro's draft, resting on these friction signatures. */
  | { kind: 'retro-decision'; title: string; signatures: string[]; accepted: boolean; issue?: { repo: string; number: number } }
  /**
   * What the captain said to a lead in a digested span (`key` is the digest's), each with what the lead had just said:
   * the record a chief of staff learns from, and is checked against. Written once per lead's span, none included.
   */
  | { kind: 'captain-replies'; key: string; sessionId: string; agent: string; goal?: string; replies: CaptainReply[]; backfilled?: boolean }
  /**
   * Which lane a plugin that reads goal leads' ships (the chief of staff) would have a ship in, the lead's pick (`from`)
   * or higher (`to`), and why, as it read its recap: one line per ship, its pull requests at the commits it read.
   * `failed` says it couldn't read it, and put it in Ask. `version` is its prompt's.
   */
  | { kind: 'cos-lane'; agent: string; goal?: string; prs: { repo: string; pr: number; sha?: string }[]; from: Lane; to: Lane; why: string; model: string; version: string; costUsd?: number; failed?: string }
  /**
   * Where a plugin that judges goal leads' turns would send a lead's turn as it ended (`turnUuid` is its transcript's
   * last line), to check against `captain-replies`: a journal format the core reads (the ledger's review) but never
   * writes. `message` is what it would say (to the lead on routes 1 and 4); `version` is its prompt's.
   */
  | {
      kind: 'cos-verdict'; sessionId: string; agent: string; goal?: string; turnUuid: string; route: VerdictRoute; why: string; message?: string; model: string; version: string; costUsd?: number;
      /** Which of the judge's checks decided it, in the plugin's own words (`irreversible`, `overreach`…): left out by older verdicts. */
      check?: string;
      /** Who picked the route when it wasn't the judge's model: Jev, with what it rested on (`jevRouter.ts`); the model only wrote the words. */
      router?: { by: 'jev'; model: string; version: string; interrupt: number; choice?: string; confidence?: number; costUsd: number };
      /** Why Jev was asked and couldn't route, so the judge's model routed as well. */
      routerFailed?: string;
    }
  /**
   * The captain answered something waiting on them (in a plugin's inbox, or an agent's panel, as that plugin records
   * it): `item` is what it was (its inbox id, kind and line), `answer` what they decided in a few words, `via` where
   * (`DecidedVia`). `agent` is who it was for.
   */
  | { kind: 'captain-decision'; agent: string; goal?: string; item: { id: string; kind: string; what: string }; answer: string; via: DecidedVia }
  /**
   * The captain decided where a loose thread a closed goal left open ends (a plugin that keeps a project's threads
   * records it): which goal (`goalId`, titled `goal`) and which of its threads (`contact`: a contact's id, or an idea
   * for next's key, saying `text`), and `as` what. `note` goes with it: who takes it on (next), until when (parked),
   * why (dropped) or what resolved it (resolved). `open` takes a decision back, to be decided again. `spunOff` is the
   * goal of its own it was taken on as (next), started from it: its lead's id, if it took a team station (not if it
   * waits in line for one), and title. `proposed`: the captain accepted it as a model proposed it (`thread-proposals`).
   */
  | { kind: 'thread-decided'; goalId: string; goal: string; contact: string; text: string; as: ThreadDecidedAs; note?: string; spunOff?: { goal?: string; title: string }; proposed?: true }
  /**
   * Where a model proposed a project's loose threads end, asked by the captain, for them to accept or not (the same
   * plugin records it): each thread (`goalId`, `contact`) and its end (`as`) with why (`note`), on `model`, at
   * `costUsd`. `asked` is how many threads it was asked about; `failed` says why no proposals came back.
   */
  | { kind: 'thread-proposals'; asked: number; proposals: ThreadProposal[]; model: string; costUsd?: number; failed?: string }
  /**
   * Something a plugin (`by`, its id) raised to the captain directly, not through anyone's routing: a lead not answering
   * a scheduled run, say. `agent` is who it's about, `text` what the captain was told.
   */
  | { kind: 'alert'; by: string; agent: string; goal?: string; text: string }
  /**
   * Something a goal (`goalId`, titled `goal`) is after, and the constraints on it, as whoever wrote it (`by`: a lead,
   * the captain, or a plugin by its id) put it; with no goal, one of the project's own, of which it may have several,
   * each by its `id` (a slug). The latest line for a goal, or for a project's `id`, is that intent
   * (`shared/decisions.ts`): one format for both, so there's one place to read either from. `why` says why it changed;
   * `retired` that it's no longer one; `serves`, on a goal's, the ids of the project's intents it serves.
   */
  | { kind: 'intent'; goalId?: string; goal?: string; id?: string; by: string; what: string; constraints: string[]; why?: string; serves?: string[]; retired?: true }
  /** A decision as it stands after this line: see `DecisionRecord`. */
  | ({ kind: 'decision' } & DecisionRecord)
  /** A span of an agent's session, digested when it ends (or a lead's slice lands): see `SessionFacts`. */
  | SessionDigest;


/**
 * Where it was decided: by the captain in Focus (`office`), through the API (`api`: a bot speaking for them), or by a
 * plugin acting on its own where the captain let it (the plugin's id).
 */
export type DecidedVia = string;

/**
 * A decision on a goal (`goalId`, titled `goal`), whole as it stands: each change to it is a new `decision` line with
 * the same `id` and every field again, never an edit, so the latest line is the record and the ones before are its
 * history. `owner` is the lead whose goal it's on, who acts on it; `by` who wrote this line (the lead's name, the
 * captain, or a plugin by its id). A lead may `propose` an option while it's open; `chosen` is set once decided, with
 * the `rationale` for it and the options `rejected` and why. `supersedes` is the decision this one replaces.
 */
export interface DecisionRecord {
  id: string;
  status: DecisionStatus;
  goalId: string;
  goal: string;
  owner: string;
  by: string;
  question: string;
  options: string[];
  proposed?: string;
  chosen?: string;
  rationale?: string;
  rejected?: { option: string; why: string }[];
  supersedes?: string;
}

/** Where a loose thread ends, as the captain decides it, or `open`: the decision taken back. */
export type ThreadDecidedAs = 'next' | 'parked' | 'dropped' | 'resolved' | 'open';

/** Where a model proposed one loose thread ends, and why. */
export interface ThreadProposal {
  goalId: string;
  contact: string;
  as: Exclude<ThreadDecidedAs, 'open'>;
  note: string;
}

/** Where a decision came from, said after it: nothing for the captain in Focus, and a plugin by its id in words. */
export const viaNote = (via: DecidedVia): string => (via === 'office' ? '' : via === 'api' ? 'via the API' : `sent by the ${via.replace(/-/g, ' ')}`);

/** Where a `cos-verdict` line says a lead's turn goes: 1 carry on, 2 a card for the captain, 3 interrupt the captain, 4 back to the lead. */
export type VerdictRoute = 1 | 2 | 3 | 4;

/** Who a verdict's message is for: the lead on routes 1 (carry on) and 4 (back to the lead), the captain on 2 (a card) and 3 (interrupt). */
export const verdictAddressee = (route: VerdictRoute): 'lead' | 'captain' => (route === 1 || route === 4 ? 'lead' : 'captain');

/** The captain's message to a lead, in full, and the end of what the lead had said since the last message to it. */
export interface CaptainReply {
  at?: string;
  lead: string;
  captain: string;
}

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
  /** What the span cost, from the agent's running total; missing when Ops doesn't know. */
  costUsd?: number;
  captainMessages: number;
  nudges: number;
  officeMessages: number;
  compactions: number;
  /** The ledger's QA fails and conflicts on the span's pull requests, so far. */
  qaFails: number;
  conflicts: number;
}

/**
 * The kinds of friction a session can hit: fixed, so the same trouble groups the same way across sessions. Only the
 * captain (or a slice) adds one; a growing pile of `other` says it's time to.
 */
export const FRICTION_KINDS = {
  'demo-env': 'the demo ship or dev server not starting, dying, or fighting over a port',
  'guard-block': 'a guard, hook or permission check refusing a command',
  shell: 'a shell command going wrong by itself: globs, quoting, a missing command, the wrong directory',
  'tool-refused': 'an Ops or Claude Code tool refusing its input (too long, wrong shape)',
  conflicts: 'merge conflicts, or a branch behind its base',
  'qa-rerun': 'QA re-testing, or re-running, without new work to test',
  'captain-correction': 'the captain correcting the agent, or asking for something it missed',
  'captain-nudge': 'the captain having to say carry on: the agent stopped when it needn’t have',
  'missing-dependency': 'a missing install, package, model file or build step',
  'flaky-check': 'a test, check or tool that failed and then passed with nothing changed',
  other: 'anything else that cost time',
} as const;
export type FrictionKind = keyof typeof FRICTION_KINDS;

/** A moment of friction, quoted word for word from the session. */
export interface Friction {
  kind: FrictionKind;
  /** A few words naming it, the same each time it comes up (`zsh glob no matches`): how `frictionGroups` groups them. */
  signature: string;
  quote: string;
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
  /** What Haiku found in the span, when digests were read that way (before the retro's reader); code checked the quotes. */
  frictions?: Friction[];
  rework?: { what: string; quote: string }[];
  /** A lesson someone in the session put into words, quoted; never one written for them. */
  lesson?: string;
  /** What the extraction cost, and why there's none when it failed (the facts are kept either way). */
  extractCostUsd?: number;
  extractError?: string;
  /** Digested after the fact from a transcript on disk, not as the session ended. */
  backfilled?: boolean;
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
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      check.problems.push(`line ${i + 1} isn’t readable`);
      continue;
    }
    if (!isRecord(raw) || typeof raw.at !== 'number' || typeof raw.kind !== 'string') {
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
    check.nextSeq = Math.max(check.nextSeq, raw.seq + 1);
    // a record kept for what it says (a decision) is left out whole when it's broken, its number still taken
    const broken = lineProblem(raw);
    if (broken) check.problems.push(`line ${i + 1} (${raw.kind}) ${broken}`);
    else check.events.push(event as LedgerEvent);
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
  /** Agent spend Ops knows of, all told. */
  costUsd: number;
  /** Each retro fix the captain accepted, and whether its frictions stopped coming up once it landed (whenever it was accepted). */
  fixes: FixEffect[];
  /** The open frictions (no retro decision yet) of the last OPEN_FRICTION_DAYS, the most widespread first: the top few. */
  frictions: { key: string; sessions: number }[];
  /** Damage found in the ledger when Focus opened it: it needs a look. */
  warnings?: string[];
  /** Not damage, but worth knowing: another running Focus holds the ledger, so this one's lines aren't kept. */
  notes?: string[];
}

const DAY = 24 * 60 * 60 * 1000;

/** The window the report card's open frictions cover. */
export const OPEN_FRICTION_DAYS = 14;

/**
 * Every goal the ledger saw close, newest first, in `projectId`'s room or any: the archive of what leads showed, which
 * outlives the room's log. A goal reopened and closed again is listed once, as it last closed.
 */
export function closedGoals(events: LedgerEvent[], projectId?: string): ArchivedGoal[] {
  const goals = new Map<string, ArchivedGoal>();
  for (const e of events) if (e.kind === 'goal-closed' && (!projectId || e.projectId === projectId)) goals.set(e.goal.id, { ...e.goal, projectId: e.projectId });
  return [...goals.values()].sort((a, b) => b.closedAt - a.closedAt);
}

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
    fixes: fixEffects(events, now),
    frictions: frictionGroups(events, now, OPEN_FRICTION_DAYS).slice(0, 5).map((g) => ({ key: g.key, sessions: g.sessions })),
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
      ...(card.fixes.length ? [fixesLine(card.fixes)] : []),
    ],
  };
}

/** A friction's group: its kind and signature, as `<kind>: <signature>`. */
export const frictionKey = (f: Pick<Friction, 'kind' | 'signature'>) => `${f.kind}: ${f.signature}`;

/** A friction's key back into its kind and signature; a key with no kind is all signature. */
export function frictionName(key: string): { kind: string; signature: string } {
  const at = key.indexOf(': ');
  return at < 0 ? { kind: '', signature: key } : { kind: key.slice(0, at), signature: key.slice(at + 2) };
}

export interface FrictionGroup {
  key: string;
  kind: FrictionKind;
  signature: string;
  /** Digested spans it came up in: the same session's spans count once. */
  sessions: number;
  /** Up to six moments, from different sessions, newest first. */
  moments: { agent: string; at: number; quote: string }[];
}

type Digest = Extract<LedgerEvent, { kind: 'session-digest' }>;

/**
 * Each digested span's frictions, by the digest's key: what the retro's reader found (`session-frictions`), or what
 * Haiku found when digests were read that way. A span missing from the map hasn't been read yet.
 */
export function frictionsByDigest(events: LedgerEvent[]): Map<string, Friction[]> {
  const found = new Map<string, Friction[]>();
  for (const e of events) {
    if (e.kind === 'session-digest' && e.frictions) found.set(e.key, e.frictions);
    else if (e.kind === 'session-frictions') found.set(e.key, e.frictions);
  }
  return found;
}

/** The digests in the window that no one has read for frictions yet, oldest first: what reading for frictions reads next. */
export function unreadDigests(events: LedgerEvent[], now: number, days: number): Digest[] {
  const found = frictionsByDigest(events);
  return events.filter((e): e is Digest => e.kind === 'session-digest' && e.at > now - days * DAY && !found.has(e.key));
}

/** Every friction signature in the ledger, so a reader gives the same trouble the same words. */
export function knownSignatures(events: LedgerEvent[]): string[] {
  return [...new Set([...frictionsByDigest(events).values()].flat().map(frictionKey))].sort();
}

/**
 * The frictions in the window's session digests, grouped by kind and signature, most widespread first. A group counts
 * sessions, not mentions; groups the captain has already decided on (`retro-decision`) are left out.
 */
export function frictionGroups(events: LedgerEvent[], now: number, days: number): FrictionGroup[] {
  const since = now - days * DAY;
  const decided = new Set(events.flatMap((e) => (e.kind === 'retro-decision' ? e.signatures : [])));
  const found = frictionsByDigest(events);
  const groups = new Map<string, FrictionGroup & { seen: Set<string> }>();
  for (const e of events) {
    if (e.kind !== 'session-digest' || e.at <= since) continue;
    for (const f of found.get(e.key) ?? []) {
      const key = frictionKey(f);
      if (decided.has(key)) continue;
      const g = groups.get(key) ?? { key, kind: f.kind, signature: f.signature, sessions: 0, moments: [], seen: new Set<string>() };
      if (!g.seen.has(e.sessionId)) {
        g.seen.add(e.sessionId);
        g.sessions++;
        g.moments.push({ agent: e.agent, at: e.at, quote: f.quote });
      }
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .map(({ seen: _s, ...g }) => ({ ...g, moments: g.moments.sort((a, b) => b.at - a.at).slice(0, 6) }))
    .sort((a, b) => b.sessions - a.sessions || a.key.localeCompare(b.key));
}

/**
 * How an accepted fix is doing: its issue's PR hasn't merged yet; it has, but too few sessions have been digested
 * since to tell; its frictions haven't come up since; they come up in a smaller share of sessions than before; or as
 * often as ever.
 */
export type FixStatus = 'waiting' | 'too-early' | 'stopped' | 'fewer' | 'recurring';

export interface FixEffect {
  title: string;
  signatures: string[];
  decidedAt: number;
  issue?: { repo: string; number: number };
  /** The merge that closed its issue. */
  landed?: { repo: string; pr: number; at: number };
  /** Sessions with any of its frictions, out of the sessions digested: in the window before the decision, and since it landed. */
  before: { hits: number; sessions: number };
  after: { hits: number; sessions: number };
  status: FixStatus;
}

/** Sessions digested since a fix landed before the report card will say whether it worked. */
export const FIX_SESSIONS = 5;

/**
 * Each accepted retro fix with an issue, matched to the merge that closed it (a `merged` line whose `closes` has the
 * issue), and its frictions counted by session: in the `days` before the captain accepted it, and since it landed.
 * A session counts once however often a friction came up in it.
 */
export function fixEffects(events: LedgerEvent[], now: number, days = 14): FixEffect[] {
  const found = frictionsByDigest(events);
  // only spans that have been read count: one not read yet can't say either way
  const digests = events.filter((e): e is Digest => e.kind === 'session-digest' && found.has(e.key));
  const count = (signatures: string[], from: number, to: number) => {
    const sessions = new Set<string>();
    const hits = new Set<string>();
    for (const d of digests) {
      if (d.at <= from || d.at > to) continue;
      sessions.add(d.sessionId);
      if (found.get(d.key)?.some((f) => signatures.includes(frictionKey(f)))) hits.add(d.sessionId);
    }
    return { hits: hits.size, sessions: sessions.size };
  };
  return events.flatMap((e): FixEffect[] => {
    if (e.kind !== 'retro-decision' || !e.accepted) return [];
    const issue = e.issue;
    const merge = issue && events.find((m) => m.kind === 'merged' && m.at >= e.at && m.repo === issue.repo && m.closes?.includes(issue.number));
    const landed = merge && merge.kind === 'merged' ? { repo: merge.repo, pr: merge.pr, at: merge.at } : undefined;
    const before = count(e.signatures, e.at - days * DAY, e.at);
    const after = landed ? count(e.signatures, landed.at, now) : { hits: 0, sessions: 0 };
    const rate = (c: { hits: number; sessions: number }) => (c.sessions ? c.hits / c.sessions : 0);
    const status: FixStatus = !landed ? 'waiting' : after.sessions < FIX_SESSIONS ? 'too-early' : after.hits === 0 ? 'stopped' : rate(after) < rate(before) ? 'fewer' : 'recurring';
    return [{ title: e.title, signatures: e.signatures, decidedAt: e.at, issue, landed, before, after, status }];
  });
}

/** The report card's line on retro fixes: how many were accepted, landed, and stopped their frictions. */
export function fixesLine(fixes: FixEffect[]): string {
  const landed = fixes.filter((f) => f.status !== 'waiting').length;
  const stopped = fixes.filter((f) => f.status === 'stopped').length;
  const recurring = fixes.filter((f) => f.status === 'recurring').length;
  return `Retro fixes: ${fixes.length} accepted · ${landed} landed · ${stopped} stopped it${recurring ? ` · ${recurring} still recurring` : ''}`;
}
