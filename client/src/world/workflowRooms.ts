// What a team station's transporter rooms show of its lead's workflows: which workflow is in which room, who stands on
// which pad, the phases' colours, and what the tactical display, the pattern buffer, the console's script, the flow
// hologram and the briefing room's feeds say. Pure: no Three.js, so it's testable outside the browser (transporterOps.ts and transporterFeeds.ts draw it).
import type { Workflow, WorkflowAgent, WorkflowPhase } from '../../../shared/types';

/** A transporter room's platform: three tiers of six pads, tier 0 at the front, slot 0 at the door's end. */
export const PAD_TIERS = 3;
export const PADS_PER_TIER = 6;
export const PAD_COUNT = PAD_TIERS * PADS_PER_TIER;

/** How long an agent that's finished stays on its pad, cheering or slumped, before beaming out (ms). */
export const PAD_LINGER_MS = 2000;

/**
 * Which workflow runs in which of a station's transporter rooms: each keeps the room it took while the lead has it
 * (finished ones too, while they linger), and a newcomer takes the first free one, the longest waiting first. Those
 * left over wait for a room.
 */
export function assignRooms(held: (string | undefined)[], workflows: Pick<Workflow, 'id' | 'startedAt'>[]): { rooms: (string | undefined)[]; waiting: string[] } {
  const ids = new Set(workflows.map((w) => w.id));
  const rooms = held.map((id) => (id && ids.has(id) ? id : undefined));
  const waiting: string[] = [];
  for (const w of [...workflows].sort((a, b) => a.startedAt - b.startedAt)) {
    if (rooms.includes(w.id)) continue;
    const free = rooms.indexOf(undefined);
    if (free < 0) waiting.push(w.id);
    else rooms[free] = w.id;
  }
  return { rooms, waiting };
}

/** An agent's key on the platform: its workflow and its place in it, unique however many workflows run. */
export function agentKey(workflowId: string, index: number): string {
  return `${workflowId}:${index}`;
}

/** Whoever stands on a pad: an agent of the room's workflow, and when the room first saw them finish. */
export interface PadOccupant {
  key: string;
  phase: number;
  status: 'working' | 'done' | 'failed';
  finishedAt?: number;
}

/** What the platform needs to know of an agent. */
export type PadAgent = Pick<PadOccupant, 'key' | 'phase'> & { status: WorkflowAgent['status'] };

/** Where pad `i` is on the platform, in pads: across (slot) and back (tier). */
function padAt(i: number): { tier: number; slot: number } {
  return { tier: Math.floor(i / PADS_PER_TIER), slot: i % PADS_PER_TIER };
}

function apart(a: number, b: number): number {
  const p = padAt(a);
  const q = padAt(b);
  return Math.hypot(p.tier - q.tier, p.slot - q.slot);
}

/** The order an empty platform fills in: the front tier from the middle out, then the tiers behind it. */
const FILL = Array.from({ length: PAD_TIERS }, (_, tier) => [2, 3, 1, 4, 0, 5].map((slot) => tier * PADS_PER_TIER + slot)).flat();
const fillRank = (i: number) => FILL.indexOf(i);

/**
 * Who stands on which pad now, from who stood where (`pads`), the workflow's agents and the time: everyone keeps their
 * pad; an agent that's started takes a free one, beside the others of its phase if any are up there (or as far from
 * the other phases as it can, so each phase stands together); one that's finished stays PAD_LINGER_MS in its done or
 * failed pose, then goes, and goes sooner if a newcomer needs its pad. `closed` pads are taken still (someone beaming
 * out of them). Nobody's on a pad who isn't among `agents`, and an agent that started and finished between two looks
 * never gets one.
 */
export function standOnPads(pads: (PadOccupant | undefined)[], agents: PadAgent[], now: number, closed: boolean[] = [], linger = PAD_LINGER_MS): (PadOccupant | undefined)[] {
  const byKey = new Map(agents.map((a) => [a.key, a]));
  const next = pads.map((o): PadOccupant | undefined => {
    const agent = o && byKey.get(o.key);
    if (!agent || agent.status === 'queued') return undefined;
    if (agent.status === 'working') return { key: agent.key, phase: agent.phase, status: 'working' };
    const finishedAt = o.finishedAt ?? now;
    return now - finishedAt >= linger ? undefined : { key: agent.key, phase: agent.phase, status: agent.status, finishedAt };
  });
  const standing = new Set(next.flatMap((o) => (o ? [o.key] : [])));
  const shut = [...closed];
  for (const agent of agents) {
    if (agent.status !== 'working' || standing.has(agent.key)) continue;
    const free = next.flatMap((o, i) => (!o && !shut[i] ? [i] : []));
    if (!free.length) {
      // the finished make way for those at work: the one finished longest goes now, and its pad's free once it's gone
      const going = next
        .flatMap((o, i) => (o?.finishedAt !== undefined ? [{ i, at: o.finishedAt }] : []))
        .sort((a, b) => a.at - b.at)[0];
      // (the newcomer waits for a later look: the pad's closed while they beam out)
      if (going) {
        next[going.i] = undefined;
        shut[going.i] = true;
      }
      continue;
    }
    const mates = next.flatMap((o, i) => (o?.phase === agent.phase ? [i] : []));
    const others = next.flatMap((o, i) => (o && o.phase !== agent.phase ? [i] : []));
    const score = (i: number) =>
      mates.length ? Math.min(...mates.map((m) => apart(i, m))) : others.length ? -Math.min(...others.map((m) => apart(i, m))) : 0;
    const pad = free.sort((a, b) => score(a) - score(b) || fillRank(a) - fillRank(b))[0];
    next[pad] = { key: agent.key, phase: agent.phase, status: 'working' };
    standing.add(agent.key);
  }
  return next;
}

/** The ship's LCARS colours a phase can be in (starship.ts: LCARS). */
export type LcarsColour = 'sky' | 'orange' | 'gold' | 'periwinkle' | 'peach' | 'lilac';
/** A phase's colour by its place in the workflow; never green or red, which say done and failed. */
const PHASE_COLOURS: LcarsColour[] = ['sky', 'orange', 'gold', 'periwinkle', 'peach'];

/** A phase's colour: in order through the palette, from the first named phase (any agent before it shares it), and lilac for a child workflow's. */
export function phaseColour(phase: Pick<WorkflowPhase, 'index' | 'child'>): LcarsColour {
  if (phase.child) return 'lilac';
  return PHASE_COLOURS[(Math.max(1, phase.index) - 1) % PHASE_COLOURS.length];
}

/** How long a workflow has been going: m:ss, or h:mm:ss. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export interface Counts {
  queued: number;
  working: number;
  done: number;
  failed: number;
}

export interface PhaseRow extends Counts {
  index: number;
  title: string;
  /** What the script's meta says it's for, if it says. */
  detail?: string;
  child: boolean;
  colour: LcarsColour;
  total: number;
}

export interface TacticalSummary {
  name: string;
  status: Workflow['status'];
  elapsed: string;
  rows: PhaseRow[];
  totals: Counts & { total: number };
}

const sum = (rows: Counts[]): Counts & { total: number } => {
  const t = { queued: 0, working: 0, done: 0, failed: 0 };
  for (const r of rows) for (const k of ['queued', 'working', 'done', 'failed'] as const) t[k] += r[k];
  return { ...t, total: t.queued + t.working + t.done + t.failed };
};

/**
 * A workflow's phases with the ones its script's meta plans but it hasn't reached yet, in the plan's order (numbered
 * by their place in it, as Claude Code numbers them, unless that's taken), each with its detail from the plan.
 */
export function plannedPhases(wf: Pick<Workflow, 'phases' | 'plan'>): WorkflowPhase[] {
  const plan = wf.plan ?? [];
  const detail = (title: string) => plan.find((p) => p.title === title)?.detail;
  const phases = wf.phases.map((p) => {
    const d = p.detail ?? detail(p.title);
    return d ? { ...p, detail: d } : p;
  });
  const taken = new Set(phases.map((p) => p.index));
  let next = Math.max(0, plan.length, ...taken) + 1;
  for (const [i, p] of plan.entries()) {
    if (phases.some((x) => x.title === p.title)) continue;
    const index = taken.has(i + 1) ? next++ : i + 1;
    taken.add(index);
    phases.push({ index, title: p.title, ...(p.detail && { detail: p.detail }), queued: 0, working: 0, done: 0, failed: 0 });
  }
  return phases.sort((a, b) => a.index - b.index);
}

/**
 * What the tactical display shows of a workflow: its name, how it stands and how long it's been going (until
 * `endedAt`, once it's over), and a row per phase with its colour and how many of its agents stand where, then the
 * totals. Phases nobody has reached yet still get their row, the ones its script plans too.
 */
export function tacticalSummary(wf: Pick<Workflow, 'name' | 'status' | 'phases' | 'startedAt' | 'plan'>, now: number, endedAt?: number): TacticalSummary {
  const rows = plannedPhases(wf).map((p): PhaseRow => ({
    index: p.index,
    title: p.title,
    ...(p.detail && { detail: p.detail }),
    child: !!p.child,
    colour: phaseColour(p),
    queued: p.queued,
    working: p.working,
    done: p.done,
    failed: p.failed,
    total: p.queued + p.working + p.done + p.failed,
  }));
  return { name: wf.name, status: wf.status, elapsed: elapsed((endedAt ?? now) - wf.startedAt), rows, totals: sum(rows) };
}

/** A string literal in a line of script: its quote and its text. */
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/;

/**
 * The lines of a workflow's script that are running now, each with the phase it's running in: where it named a phase
 * that has agents at work (`phase('Review')`), and where it labels an agent at work, by the label as written or the
 * start of one built from a template (`label: \`review:${d.key}\``). A guess from the script's words, since Claude Code
 * doesn't say which line it's on.
 */
export function runningLines(source: string, wf: Pick<Workflow, 'phases' | 'agents'>): Map<number, number> {
  const lit = new Map<number, number>();
  const working = wf.agents.filter((a) => a.status === 'working');
  if (!working.length) return lit;
  const busy = new Map(wf.phases.filter((p) => p.working > 0).map((p) => [p.title, p.index]));
  source.split('\n').forEach((line, i) => {
    const named = new RegExp(`\\bphase\\(\\s*${LITERAL.source}`).exec(line);
    const phase = named ? busy.get(named[2]) : undefined;
    if (phase !== undefined) return void lit.set(i, phase);
    const label = new RegExp(`\\blabel\\s*:\\s*${LITERAL.source}`).exec(line);
    if (!label) return;
    const template = label[1] === '`' && label[2].includes('${');
    const prefix = template ? label[2].slice(0, label[2].indexOf('${')) : label[2];
    const agent = working.find((a) => (template ? !!prefix && a.label.startsWith(prefix) : a.label === prefix));
    if (agent) lit.set(i, agent.phase);
  });
  return lit;
}

/**
 * Which `rows` of a script's `total` lines a screen shows: from the top, or so the first running line sits a third of
 * the way down, as far as the script goes. The first line's index.
 */
export function scriptWindow(total: number, lit: Iterable<number>, rows: number): number {
  const first = Math.min(Infinity, ...lit);
  if (!Number.isFinite(first)) return 0;
  return Math.max(0, Math.min(first - Math.floor(rows / 3), total - rows));
}

/** A count of tokens, short: 412, 41.2K, 4.1M. */
export function shortCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** What a workflow has used, in a few words: tokens and tool calls. Empty before it's counted any. */
export function usageLine(usage: Workflow['usage']): string {
  return usage ? `${shortCount(usage.tokens)} tokens · ${usage.toolUses} tool calls` : '';
}

/**
 * A phase's bar, split into its done, failed, working and queued agents, as fractions of `of` (the biggest phase, so
 * the bars compare), in that order from the left.
 */
export function barSegments(row: Counts, of: number): { kind: keyof Counts; from: number; to: number }[] {
  const out: { kind: keyof Counts; from: number; to: number }[] = [];
  let at = 0;
  for (const kind of ['done', 'failed', 'working', 'queued'] as const) {
    if (!row[kind] || of <= 0) continue;
    const to = at + row[kind] / of;
    out.push({ kind, from: at, to });
    at = to;
  }
  return out;
}

/** How a workflow stands, in a few words: what's running, queued, done and failed (whatever there's any of). */
export function countsLine(c: Counts): string {
  const parts = [
    c.working && `${c.working} running`,
    c.queued && `${c.queued} queued`,
    c.done && `${c.done} done`,
    c.failed && `${c.failed} failed`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nobody aboard yet';
}

/** A feed's caption in the briefing room: which room, and the workflow there and how it stands, or that it's idle. */
export function feedCaption(room: number, wf: Pick<Workflow, 'name' | 'status' | 'phases'> | undefined): { title: string; line: string } {
  const title = `Transporter room ${room + 1}`;
  if (!wf) return { title, line: 'Standing by' };
  const counts = countsLine(sum(wf.phases));
  const status = wf.status === 'running' ? counts : `${wf.status === 'done' ? 'Complete' : 'Failed'} · ${counts}`;
  return { title, line: `${wf.name} · ${status}` };
}

/** Over the feeds: how many of the lead's workflows are waiting for a room, if any. */
export function waitingLine(n: number): string {
  return n ? `${n} more waiting for a transporter room` : '';
}

/** The pattern buffer's readout. */
export function bufferLine(queued: number): string {
  return queued ? `Pattern buffer · ${queued} held` : 'Pattern buffer · clear';
}

/**
 * How bright the pattern buffer glows (0 to 1) holding `queued` patterns at `t` seconds: a dim idle glow when it's
 * empty, brighter and pulsing faster the more it holds, full by two dozen.
 */
export function bufferGlow(queued: number, t: number): number {
  if (!queued) return 0.15;
  const load = Math.min(1, queued / 24);
  const base = 0.45 + 0.4 * load;
  return Math.min(1, base + 0.15 * Math.sin(t * (2 + 4 * load)));
}

/** A node on the flow hologram: one of the script's phases, or where it returns to the lead. */
export interface FlowNode {
  /** The phase's index, or -1 for the return. */
  index: number;
  title: string;
  detail?: string;
  /** Its colour: the phase's, or the return's (gold). */
  colour: LcarsColour;
  /** Across the hologram, 0 to 1. */
  x: number;
  /** Agents at work in it, and how many have come back (done or failed) and failed. */
  working: number;
  back: number;
  failed: number;
  /** Not reached yet, with agents at work or queued, or over. The return is done once the workflow is, failed if it failed. */
  state: 'waiting' | 'active' | 'done' | 'failed';
}

/**
 * The flow hologram's nodes: each phase the workflow has reached or its script plans, in order, and the return after
 * them, spaced evenly across it.
 */
export function flowNodes(wf: Pick<Workflow, 'phases' | 'plan' | 'status'>): FlowNode[] {
  const phases = plannedPhases(wf);
  const n = phases.length + 1;
  const nodes = phases.map((p, i): FlowNode => ({
    index: p.index,
    title: p.title,
    ...(p.detail && { detail: p.detail }),
    colour: phaseColour(p),
    x: (i + 0.5) / n,
    working: p.working,
    back: p.done + p.failed,
    failed: p.failed,
    state: p.working + p.queued > 0 ? 'active' : p.done + p.failed > 0 ? 'done' : 'waiting',
  }));
  const ret: FlowNode = {
    index: -1, title: 'Return', colour: 'gold', x: (n - 0.5) / n, working: 0, back: 0, failed: 0,
    state: wf.status === 'done' ? 'done' : wf.status === 'failed' ? 'failed' : 'waiting',
  };
  return [...nodes, ret];
}

/**
 * How brightly a pad glows under its agent at `t` seconds, 0 to 1: breathing while they work (each pad out of step
 * with its neighbours, by `slot`), steady once they've finished, as their green or red shows before they beam out.
 */
export function padGlow(status: PadOccupant['status'], t: number, slot: number): number {
  return status === 'working' ? 0.75 + 0.25 * Math.sin(t * 3 + slot * 1.7) : 1;
}

/** The pads whose agent was at work at the last look and has finished since, still standing there: their results rise to the hologram. */
export function finishedOnPads(before: (PadOccupant | undefined)[], after: (PadOccupant | undefined)[]): number[] {
  const out: number[] = [];
  after.forEach((now, i) => {
    const was = before[i];
    if (now && was && now.key === was.key && was.status === 'working' && now.status !== 'working') out.push(i);
  });
  return out;
}
