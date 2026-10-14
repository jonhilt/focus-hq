import type { LedgerEvent } from '../../shared/ledger';
import type { ArchivedGoal } from '../../shared/types';
import { messageFrom } from './retro';
import { blocks, resultText, transcriptLines } from './transcript';

// Where a goal's time goes (docs/flow.md), from code alone: its lead's Claude Code transcript says when the lead was
// at work and when it sat between turns, the ship tool's results say when each pull request went out, and the
// ledger's QA verdicts and merges say what the lead was waiting on meanwhile. Every moment from the goal opening to
// it closing lands in exactly one state, so the states add up to the goal's lead time. The I/O is in scripts/flow.ts.

export type FlowState = 'queued' | 'working' | 'rework' | 'background' | 'qa' | 'review' | 'captain';

/** The states in the order a report lists them, with what each means. */
export const FLOW_STATES: Record<FlowState, string> = {
  working: 'the lead at work on a turn',
  rework: 'the lead at work after QA failed, until it ships again',
  background: 'the lead between turns, waiting on its own subagents, workflows or background commands',
  qa: 'between turns, a pull request shipped and QA not yet back on it',
  review: 'between turns, QA passed and the pull request waiting to merge',
  captain: 'between turns, nothing shipped waiting on QA or a merge: waiting on the captain',
  queued: 'the goal opened, its lead not yet started',
};

/** An idle stretch at least this long is someone away (a night, a day out): its time is counted apart as well. */
export const LONG_WAIT_MS = 4 * 60 * 60 * 1000;
/** A wait on the captain shorter than this is a message sent while the lead was still at work, not a wait. */
export const SHORT_WAIT_MS = 60 * 1000;

interface PrKey {
  repo: string;
  pr: number;
}

/** What a lead's transcript says happened when: a message starting a turn, the lead at work, or a pull request shipped. */
export type Moment =
  | { at: number; kind: 'message'; from: 'captain' | 'office' | 'background' }
  | { at: number; kind: 'activity' }
  | { at: number; kind: 'ship'; prs: PrKey[] };

const SHIPPED = /([\w.-]+\/[\w.-]+)#(\d+)/g;

/** A lead's transcript as moments, in order: the messages that start turns, the lead's own lines, and each ship's pull requests. */
export function transcriptMoments(jsonl: string): Moment[] {
  const moments: Moment[] = [];
  const ships = new Set<string>();
  for (const line of transcriptLines(jsonl)) {
    const at = line.timestamp ? Date.parse(line.timestamp) : NaN;
    if (Number.isNaN(at)) continue;
    if (line.type === 'assistant') {
      moments.push({ at, kind: 'activity' });
      for (const b of blocks(line)) if (b.type === 'tool_use' && b.name === 'mcp__office__ship' && b.id) ships.add(b.id);
    } else if (line.type === 'user' && !line.isMeta) {
      for (const b of blocks(line)) {
        if (b.type === 'tool_result') {
          const prs = b.tool_use_id && ships.has(b.tool_use_id) && !b.is_error ? [...resultText(b.content).matchAll(SHIPPED)].map((m) => ({ repo: m[1], pr: Number(m[2]) })) : [];
          moments.push(prs.length ? { at, kind: 'ship', prs } : { at, kind: 'activity' });
        } else if (b.type === 'text' && b.text?.trim()) {
          const from = messageFrom(b.text);
          if (from === 'captain') moments.push({ at, kind: 'message', from: 'captain' });
          else if (from === 'office' || from === 'qa') moments.push({ at, kind: 'message', from: 'office' });
          else if (from === 'compacted') moments.push({ at, kind: 'activity' });
          else if (b.text.trimStart().startsWith('<task-notification')) moments.push({ at, kind: 'message', from: 'background' });
        }
      }
    }
  }
  return moments.sort((a, b) => a.at - b.at);
}

export interface GoalFlow {
  id: string;
  title: string;
  projectId: string;
  openedAt: number;
  closedAt: number;
  leadMs: number;
  slices: number;
  prs: number;
  /** Time in each state; they add up to `leadMs`. */
  ms: Record<FlowState, number>;
  /** Of `ms`, what was in idle stretches of `LONG_WAIT_MS` or more: nights and days away. */
  away: Record<FlowState, number>;
  /** `leadMs` less the time away. */
  activeMs: number;
  /** Each time the lead waited on the captain between turns, for `SHORT_WAIT_MS` or more, and how long. */
  captainWaits: number[];
}

const emptyStates = (): Record<FlowState, number> => ({ queued: 0, working: 0, rework: 0, background: 0, qa: 0, review: 0, captain: 0 });

const same = (a: PrKey) => (b: PrKey) => a.repo === b.repo && a.pr === b.pr;

/** A stretch of the goal: the lead at a turn, or between turns until the message that ended it (none after the last). */
interface Stretch {
  start: number;
  end: number;
  busy: boolean;
  endedBy?: 'captain' | 'office' | 'background';
}

/** The goal's time as turns and the gaps between them, clipped to when it was open. */
function stretches(moments: Moment[], openedAt: number, closedAt: number): Stretch[] {
  const out: Stretch[] = [];
  const add = (s: Stretch) => {
    const start = Math.max(s.start, openedAt);
    const end = Math.min(s.end, closedAt);
    if (end > start) out.push({ ...s, start, end });
  };
  let turn: number | undefined;
  let last = openedAt;
  for (const m of moments) {
    if (turn === undefined) {
      add({ start: openedAt, end: m.at, busy: false });
      turn = last = m.at;
      continue;
    }
    if (m.kind === 'message' && m.at > last) {
      add({ start: turn, end: last, busy: true });
      add({ start: last, end: m.at, busy: false, endedBy: m.from });
      turn = m.at;
    }
    last = Math.max(last, m.at);
  }
  if (turn === undefined) add({ start: openedAt, end: closedAt, busy: false });
  else {
    add({ start: turn, end: last, busy: true });
    add({ start: last, end: closedAt, busy: false });
  }
  return out;
}

/** Where a goal's time went, from its lead's transcript and the ledger's lines on its pull requests. */
export function goalFlow(goal: ArchivedGoal, moments: Moment[], ledger: LedgerEvent[]): GoalFlow {
  const { openedAt, closedAt } = goal;
  const ships = moments.flatMap((m) => (m.kind === 'ship' ? m.prs.map((p) => ({ ...p, at: m.at })) : []));
  const prs: PrKey[] = [];
  for (const p of [...goal.prs.map((p) => ({ repo: p.repo, pr: p.number })), ...ships]) if (!prs.some(same(p))) prs.push({ repo: p.repo, pr: p.pr });
  const verdicts = ledger.flatMap((e) => (e.kind === 'qa-verdict' && prs.some(same(e)) ? [e] : []));
  const ends = ledger.flatMap((e) => ((e.kind === 'merged' || e.kind === 'closed') && prs.some(same(e)) ? [e] : []));
  const lastShip = (p: PrKey, t: number) => Math.max(-Infinity, ...ships.filter((s) => same(p)(s) && s.at <= t).map((s) => s.at));

  /** Between turns at `t`: what the goal's open pull requests were waiting on. */
  const waitingOn = (t: number): 'qa' | 'review' | 'captain' => {
    const open = prs.filter((p) => lastShip(p, t) > -Infinity && !ends.some((e) => same(p)(e) && e.at <= t));
    if (!open.length) return 'captain';
    const latest = open.map((p) => verdicts.filter((v) => same(p)(v) && v.at <= t && v.at >= lastShip(p, t)).at(-1));
    if (latest.some((v) => !v)) return 'qa';
    return latest.every((v) => v?.verdict === 'pass') ? 'review' : 'captain';
  };
  /** At a turn at `t`: reworking when QA failed one of the goal's pull requests since the lead last shipped. */
  const reworking = (t: number) => {
    const failed = Math.max(-Infinity, ...verdicts.filter((v) => v.verdict === 'fail' && v.at <= t).map((v) => v.at));
    return failed > Math.max(-Infinity, ...ships.filter((s) => s.at <= t).map((s) => s.at));
  };

  const ms = emptyStates();
  const away = emptyStates();
  const captainWaits: number[] = [];
  const breaks = [...ships.map((s) => s.at), ...verdicts.map((v) => v.at), ...ends.map((e) => e.at)];
  const all = stretches(moments, openedAt, closedAt);
  for (const s of all) {
    const queued = !s.busy && s === all[0] && !moments.some((m) => m.at <= s.start);
    const long = !s.busy && !queued && s.end - s.start >= LONG_WAIT_MS;
    const cuts = [s.start, ...breaks.filter((t) => t > s.start && t < s.end).sort((a, b) => a - b), s.end];
    let captain = 0;
    for (let i = 0; i < cuts.length - 1; i++) {
      const [a, b] = [cuts[i], cuts[i + 1]];
      const state: FlowState = queued ? 'queued' : s.busy ? (reworking(a) ? 'rework' : 'working') : s.endedBy === 'background' ? 'background' : waitingOn(a);
      ms[state] += b - a;
      if (long) away[state] += b - a;
      if (state === 'captain') captain += b - a;
    }
    if (captain >= SHORT_WAIT_MS) captainWaits.push(captain);
  }
  const leadMs = closedAt - openedAt;
  const activeMs = leadMs - Object.values(away).reduce((n, t) => n + t, 0);
  return { id: goal.id, title: goal.title, projectId: goal.projectId, openedAt, closedAt, leadMs, activeMs, slices: goal.slices, prs: prs.length, ms, away, captainWaits };
}

/** The nearest-rank percentile (0 to 1) of some numbers; 0 for none. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/** What must not get worse while lead time comes down: the ledger on the goals' pull requests. */
export interface QualityGuards {
  merged: number;
  /** Merged with QA's badge on anything but passed: no pass on its head commit. */
  mergedWithoutPass: number;
  /** Of the pull requests QA reviewed, those it passed first time. */
  reviewed: number;
  passedFirstTime: number;
  qaFails: number;
  /** Conflicts an agent had to resolve. */
  agentConflicts: number;
}

export interface FlowReport {
  goals: GoalFlow[];
  leadP50: number;
  leadP85: number;
  /** Lead time less the time away (idle stretches of `LONG_WAIT_MS` or more). */
  activeP50: number;
  activeP85: number;
  /** Share of its active time the median goal's lead was at work (working, rework, background). */
  efficiencyP50: number;
  totals: Record<FlowState, number>;
  away: Record<FlowState, number>;
  leadTotal: number;
  activeTotal: number;
  captainWaitP50: number;
  captainWaitP85: number;
  guards: QualityGuards;
}

const atWork = (g: GoalFlow) => (g.activeMs ? (g.ms.working + g.ms.rework + g.ms.background) / g.activeMs : 0);

/** The goals' flows summed up, with the quality guards over their pull requests. */
export function flowReport(goals: GoalFlow[], allGoals: ArchivedGoal[], ledger: LedgerEvent[]): FlowReport {
  const totals = emptyStates();
  const away = emptyStates();
  for (const g of goals)
    for (const s of Object.keys(totals) as FlowState[]) {
      totals[s] += g.ms[s];
      away[s] += g.away[s];
    }
  const ids = new Set(goals.map((g) => g.id));
  const prs = allGoals.filter((g) => ids.has(g.id)).flatMap((g) => g.prs.map((p) => ({ repo: p.repo, pr: p.number })));
  const on = (e: PrKey) => prs.some(same(e));
  const merges = ledger.flatMap((e) => (e.kind === 'merged' && on(e) ? [e] : []));
  const verdicts = ledger.flatMap((e) => (e.kind === 'qa-verdict' && on(e) ? [e] : []));
  const firsts = new Map<string, boolean>();
  for (const v of verdicts) if (!firsts.has(`${v.repo}#${v.pr}`)) firsts.set(`${v.repo}#${v.pr}`, v.verdict === 'pass');
  const waits = goals.flatMap((g) => g.captainWaits);
  return {
    goals,
    leadP50: percentile(goals.map((g) => g.leadMs), 0.5),
    leadP85: percentile(goals.map((g) => g.leadMs), 0.85),
    activeP50: percentile(goals.map((g) => g.activeMs), 0.5),
    activeP85: percentile(goals.map((g) => g.activeMs), 0.85),
    efficiencyP50: percentile(goals.map(atWork), 0.5),
    totals,
    away,
    leadTotal: goals.reduce((n, g) => n + g.leadMs, 0),
    activeTotal: goals.reduce((n, g) => n + g.activeMs, 0),
    captainWaitP50: percentile(waits, 0.5),
    captainWaitP85: percentile(waits, 0.85),
    guards: {
      merged: merges.length,
      mergedWithoutPass: merges.filter((m) => m.qa !== 'passed').length,
      reviewed: firsts.size,
      passedFirstTime: [...firsts.values()].filter(Boolean).length,
      qaFails: verdicts.filter((v) => v.verdict === 'fail').length,
      agentConflicts: ledger.filter((e) => e.kind === 'conflicts' && e.resolved === 'agent' && on(e)).length,
    },
  };
}

/** A span of time in a few characters: `45m`, `5.7h`, `2.1d`. */
export function span(ms: number): string {
  const m = ms / 60_000;
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 48 * 60) return `${(m / 60).toFixed(1)}h`;
  return `${(m / 1440).toFixed(1)}d`;
}

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '–');

/** The state that took the most of some times, of those given. */
const most = (ms: Record<FlowState, number>, of: FlowState[]) => of.reduce((a, b) => (ms[b] > ms[a] ? b : a));

const WAITS: FlowState[] = ['qa', 'review', 'captain', 'queued'];

/** The report as the terminal prints it. */
export function flowLines(r: FlowReport, slowest = 5): string[] {
  const states = (Object.keys(FLOW_STATES) as FlowState[]).filter((s) => s !== 'queued' || r.totals[s] > 0);
  const around = Object.fromEntries(states.map((s) => [s, r.totals[s] - r.away[s]])) as Record<FlowState, number>;
  const biggest = most(around, WAITS);
  const g = r.guards;
  const all = Object.keys(FLOW_STATES) as FlowState[];
  const row = (s: FlowState) => `  ${s.padEnd(10)} ${span(r.totals[s]).padStart(7)} ${pct(r.totals[s], r.leadTotal).padStart(4)}   ${span(around[s]).padStart(7)} ${pct(around[s], r.activeTotal).padStart(4)}  ${FLOW_STATES[s]}`;
  return [
    `${r.goals.length} goals · lead time p50 ${span(r.leadP50)} · p85 ${span(r.leadP85)}`,
    `  leaving out idle stretches of ${span(LONG_WAIT_MS)} or more (nights, days away): p50 ${span(r.activeP50)} · p85 ${span(r.activeP85)} · the median goal's lead at work ${pct(r.efficiencyP50, 1)} of it`,
    '',
    `Where the time went:   all time       while around`,
    ...states.map(row),
    `  away       ${span(r.leadTotal - r.activeTotal).padStart(7)} ${pct(r.leadTotal - r.activeTotal, r.leadTotal).padStart(4)}            idle stretches of ${span(LONG_WAIT_MS)} or more, counted in the states above`,
    `  each wait on the captain of ${span(SHORT_WAIT_MS)} or more: p50 ${span(r.captainWaitP50)} · p85 ${span(r.captainWaitP85)}`,
    '',
    `Biggest wait while around: ${biggest}, ${pct(around[biggest], r.activeTotal)} of the active time.`,
    '',
    'Quality guards (the goals’ pull requests):',
    `  merged ${g.merged} · ${g.mergedWithoutPass} without a current QA pass (${pct(g.mergedWithoutPass, g.merged)})`,
    `  QA passed ${g.passedFirstTime} of ${g.reviewed} first time (${pct(g.passedFirstTime, g.reviewed)}) · ${g.qaFails} failed rounds · ${g.agentConflicts} conflicts an agent resolved`,
    '',
    `Slowest ${Math.min(slowest, r.goals.length)} (lead time, active time, where most of the active time went):`,
    ...[...r.goals]
      .sort((a, b) => b.leadMs - a.leadMs)
      .slice(0, slowest)
      .map((f) => {
        const near = Object.fromEntries(all.map((s) => [s, f.ms[s] - f.away[s]])) as Record<FlowState, number>;
        const top = most(near, all);
        return `  ${span(f.leadMs).padStart(6)} ${span(f.activeMs).padStart(6)}  ${top.padEnd(10)} ${pct(near[top], f.activeMs).padStart(4)}  ${f.title}`;
      }),
  ];
}
