import { clip, messageFrom } from './retro';
import { type Block, blocks, resultText, transcriptLines } from './transcript';

// A Claude Code session as a story the studio's computer can stage (docs/studio.md): what was asked, what Claude said
// and did, and each subagent and workflow it started, stitched in from their own transcripts (a session's subagents/
// folder, and subagents/workflows/<run>/ for a workflow's agents), with when they ran, how many at once, and what came
// back. From code alone, like the ledger's session digests: no model reads it here. The whole session comes as an
// overview within a budget; a window (from, to) zooms in on a stretch of it in more detail.

/** What Claude Code notes beside each subagent's transcript (its .meta.json). */
export interface SubagentMeta {
  agentType?: string;
  description?: string;
  /** The call in its parent's transcript that started it (a subagent's, not a workflow agent's). */
  toolUseId?: string;
  workflowPhase?: string;
  model?: string;
  spawnDepth?: number;
}

/** A subagent's (or a workflow agent's) transcript, with its notes, and the workflow run it was in, if any. */
export interface AgentLog {
  meta: SubagentMeta;
  jsonl: string;
  /** The workflow run's folder name (wf_…), for a workflow's agent. */
  workflow?: string;
  /** What it returned to its workflow's script, from the run's journal. */
  result?: string;
}

export interface SessionLogs {
  id: string;
  main: string;
  agents: AgentLog[];
}

/** A stretch to zoom in on: times as the overview shows them ("2026-10-09 14:35"), or ISO. */
export interface TimelineWindow {
  from?: string;
  to?: string;
}

/** About 8k tokens for the whole session, about 10k for a stretch of it. */
const OVERVIEW_BUDGET = 32_000;
const ZOOM_BUDGET = 40_000;

/** One agent's run, from its own transcript. */
interface Run {
  meta: SubagentMeta;
  workflow?: string;
  start?: number;
  end?: number;
  calls: Map<string, number>;
  brief: string;
  /** What it handed back: its handback's message, the answer its parent got, or failing those its last words. */
  answer: string;
  /** Whether it ended by handing back (or its parent got its answer), rather than stopping mid-way. */
  answered: boolean;
}

type Event =
  | { at: number; kind: 'ask' | 'said' | 'note'; text: string; from?: string }
  | { at: number; kind: 'tools'; calls: Map<string, number>; lines: string[] }
  | { at: number; kind: 'agents'; runs: Run[] }
  | { at: number; kind: 'workflow'; name: string; runs: Run[] };

const time = (iso?: string) => (iso ? Date.parse(iso) : NaN);
const pad = (n: number) => String(n).padStart(2, '0');
/** A time as the timeline shows it: local, to the minute. */
export const clock = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const day = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const minutes = (a?: number, b?: number) => (a !== undefined && b !== undefined ? Math.max(0, Math.round((b - a) / 60_000)) : 0);
const counted = (calls: Map<string, number>) => [...calls].sort((a, b) => b[1] - a[1]).map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ');
const total = (calls: Map<string, number>) => [...calls.values()].reduce((a, b) => a + b, 0);

/** What a call did, in a line: a Bash command, or the tool and its input. */
function callLine(b: Block): string {
  const input = (b.input ?? {}) as Record<string, unknown>;
  return typeof input.command === 'string' ? `Bash: ${input.command}` : `${b.name}: ${JSON.stringify(input)}`;
}

/** An agent's run from its transcript: when, what it did, what it was asked and what it said last. */
function agentRun(log: AgentLog): Run {
  const run: Run = { meta: log.meta, workflow: log.workflow, calls: new Map(), brief: '', answer: log.result ?? '', answered: log.result !== undefined };
  for (const line of transcriptLines(log.jsonl)) {
    const at = time(line.timestamp);
    if (!Number.isNaN(at)) {
      run.start ??= at;
      run.end = at;
    }
    for (const b of blocks(line)) {
      if (line.type === 'user' && !run.brief && b.type === 'text' && b.text?.trim()) run.brief = b.text;
      if (line.type !== 'assistant') continue;
      if (b.type === 'tool_use' && b.name === 'SubagentHandback') {
        const message = (b.input as { message?: unknown } | undefined)?.message;
        if (typeof message === 'string') Object.assign(run, { answer: message, answered: true });
      } else if (b.type === 'tool_use' && b.name) run.calls.set(b.name, (run.calls.get(b.name) ?? 0) + 1);
      if (b.type === 'text' && b.text?.trim() && !run.answered) run.answer = b.text;
    }
  }
  return run;
}

/** The most of `runs` running at once. */
export function mostAtOnce(runs: readonly { start?: number; end?: number }[]): number {
  const edges = runs.flatMap((r) => (r.start !== undefined && r.end !== undefined ? [[r.start, 1], [r.end, -1]] : [])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let most = 0;
  for (const [, step] of edges) most = Math.max(most, (now += step));
  return most;
}

/** A workflow script's name (its meta's), if it has one. */
const workflowName = (script: unknown) => (typeof script === 'string' ? /name:\s*['"`]([^'"`]+)['"`]/.exec(script)?.[1] : undefined) ?? 'a workflow';

/** The session's events in order, its subagents and workflows in where they started. */
function events(logs: SessionLogs): { events: Event[]; first?: number; last?: number } {
  const runs = logs.agents.map(agentRun);
  const bySpawn = new Map(runs.flatMap((r) => (r.meta.toolUseId && !r.workflow ? [[r.meta.toolUseId, r] as const] : [])));
  const byWorkflow = new Map<string, Run[]>();
  for (const r of runs) if (r.workflow) byWorkflow.set(r.workflow, [...(byWorkflow.get(r.workflow) ?? []), r]);
  const placed = new Set<Run>();
  const out: Event[] = [];
  const workflows = new Map<string, { at: number; name: string }>();
  let tools: Extract<Event, { kind: 'tools' }> | null = null;
  // Claude Code writes each of a message's parallel calls on a line of its own: subagents started by one message are one fan-out
  let spawning: { message?: string; event: Extract<Event, { kind: 'agents' }> } | null = null;
  let first: number | undefined;
  let last: number | undefined;

  for (const line of transcriptLines(logs.main)) {
    const at = time(line.timestamp);
    if (Number.isNaN(at)) continue;
    first ??= at;
    last = at;
    if (line.type === 'assistant') {
      const spawned: Run[] = [];
      for (const b of blocks(line)) {
        if (b.type === 'text' && b.text?.trim()) {
          out.push({ at, kind: 'said', text: b.text });
          tools = null;
          spawning = null;
        } else if (b.type === 'tool_use' && b.id) {
          const run = bySpawn.get(b.id);
          if (run) {
            spawned.push(run);
            placed.add(run);
          } else if (b.name === 'Workflow') {
            workflows.set(b.id, { at, name: workflowName((b.input as Record<string, unknown> | undefined)?.script) });
          } else {
            if (!tools) out.push((tools = { at, kind: 'tools', calls: new Map(), lines: [] }));
            const name = b.name ?? 'a tool';
            tools.calls.set(name, (tools.calls.get(name) ?? 0) + 1);
            tools.lines.push(callLine(b));
          }
        }
      }
      if (spawned.length) {
        if (spawning && line.message?.id && spawning.message === line.message.id) spawning.event.runs.push(...spawned);
        else {
          const event: Extract<Event, { kind: 'agents' }> = { at, kind: 'agents', runs: spawned };
          out.push(event);
          spawning = { message: line.message?.id, event };
        }
        tools = null;
      }
    } else if (line.type === 'user' && !line.isMeta) {
      for (const b of blocks(line)) {
        // a subagent run in the foreground answers in its call's result
        const ran = b.type === 'tool_result' && b.tool_use_id ? bySpawn.get(b.tool_use_id) : undefined;
        const said = ran ? resultText(b.content) : '';
        if (ran && !ran.answered && said.trim() && !/^(Async agent launched|\[Tool call interrupted)/.test(said)) Object.assign(ran, { answer: said, answered: true });
        const started = b.type === 'tool_result' && b.tool_use_id ? workflows.get(b.tool_use_id) : undefined;
        if (started && b.tool_use_id) {
          // the Workflow tool says where its run's transcripts are
          const run = /subagents\/workflows\/(wf_[\w-]+)/.exec(resultText(b.content))?.[1];
          workflows.delete(b.tool_use_id);
          const agents = (run && byWorkflow.get(run)) || [];
          agents.forEach((r) => placed.add(r));
          out.push({ at: started.at, kind: 'workflow', name: started.name, runs: agents });
          tools = null;
        }
        // what's left once Claude Code's reminders are taken out
        const text = b.type === 'text' ? b.text ?? '' : '';
        if (!clip(text, 1)) continue;
        const from = messageFrom(text);
        if (!from) continue;
        out.push({ at, kind: from === 'captain' ? 'ask' : 'note', text, from });
        tools = null;
        spawning = null;
      }
    }
  }
  // agents nothing in the main transcript started (a subagent's own, or a workflow whose launch wasn't found): where they began
  const loose = runs.filter((r) => !placed.has(r) && r.start !== undefined);
  const looseRuns = new Map<string, Run[]>();
  for (const r of loose) looseRuns.set(r.workflow ?? `agent:${r.start}`, [...(looseRuns.get(r.workflow ?? `agent:${r.start}`) ?? []), r]);
  for (const [key, group] of looseRuns) {
    const at = Math.min(...group.flatMap((r) => r.start ?? []));
    out.push(key.startsWith('wf_') ? { at, kind: 'workflow', name: key, runs: group } : { at, kind: 'agents', runs: group });
  }
  out.sort((a, b) => a.at - b.at);
  return { events: out, first, last };
}

/** An agent's line: its kind, what it was for, when it ran, what it did and, closer up, what it was asked and said back. */
function runLine(r: Run, zoom: boolean): string {
  const what = r.meta.description ? `“${r.meta.description}”` : 'an agent';
  const kind = [r.meta.agentType && r.meta.agentType !== 'workflow-subagent' ? r.meta.agentType : '', r.meta.model ?? '', r.meta.spawnDepth && r.meta.spawnDepth > 1 ? `nested ${r.meta.spawnDepth} deep` : ''].filter(Boolean).join(', ');
  const ran = r.start !== undefined ? ` ran ${clock(r.start)}–${clock(r.end ?? r.start)} (${minutes(r.start, r.end)}m, ${total(r.calls)} calls${zoom && r.calls.size ? `: ${counted(r.calls)}` : ''})` : '';
  const brief = zoom && r.brief ? `\n      asked: ${clip(r.brief, 500)}` : '';
  const answer = r.answered ? `\n      came back: ${clip(r.answer, zoom ? 800 : 200)}` : `\n      stopped without handing back${r.answer ? `; its last words: ${clip(r.answer, zoom ? 400 : 120)}` : ''}`;
  return `  - ${what}${kind ? ` (${kind})` : ''}${ran}${brief}${answer}`;
}

/** A workflow's run: its phases in order with how many agents and on which models, when, and how many at once. */
function workflowLines(e: Extract<Event, { kind: 'workflow' }>, zoom: boolean): string[] {
  const phases = new Map<string, Run[]>();
  for (const r of [...e.runs].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))) phases.set(r.meta.workflowPhase ?? 'outside a phase', [...(phases.get(r.meta.workflowPhase ?? 'outside a phase') ?? []), r]);
  const starts = e.runs.flatMap((r) => (r.start !== undefined ? [r.start] : []));
  const ends = e.runs.flatMap((r) => (r.end !== undefined ? [r.end] : []));
  const span = starts.length ? `, ran ${clock(Math.min(...starts))}–${clock(Math.max(...ends))}, at most ${mostAtOnce(e.runs)} at once` : '';
  const head = `WORKFLOW “${e.name}”: ${e.runs.length} agents${span}`;
  const phaseLines = [...phases].map(([name, rs]) => {
    const models = [...new Set(rs.map((r) => r.meta.model).filter(Boolean))].join('/');
    const s = rs.flatMap((r) => (r.start !== undefined ? [r.start] : []));
    const t = rs.flatMap((r) => (r.end !== undefined ? [r.end] : []));
    const when = s.length ? ` ${clock(Math.min(...s))}–${clock(Math.max(...t))}, at most ${mostAtOnce(rs)} at once` : '';
    const labels = rs.map((r) => r.meta.description).filter(Boolean) as string[];
    return `  phase ${name}: ${rs.length} agent${rs.length === 1 ? '' : 's'}${models ? ` (${models})` : ''}${when}${zoom ? '' : labels.length ? `: ${clip(labels.join(', '), 240)}` : ''}${zoom ? `\n${rs.map((r) => `  ${runLine(r, true)}`).join('\n')}` : ''}`;
  });
  return [head, ...phaseLines];
}

/** A line for the timeline, and whether it can go when the timeline runs long (Claude's words and tool runs can). */
type Out = { text: string; spare: 0 | 1 | 2 };

function render(e: Event, zoom: boolean): Out {
  const at = `[${clock(e.at)}]`;
  switch (e.kind) {
    case 'ask':
      return { text: `${at} USER: ${clip(e.text, zoom ? 2000 : 400)}`, spare: 0 };
    case 'note':
      return { text: `${at} ${e.from?.toUpperCase()}: ${clip(e.text, e.from === 'compacted' ? 80 : zoom ? 600 : 160)}`, spare: 1 };
    case 'said':
      return { text: `${at} CLAUDE: ${clip(e.text, zoom ? 800 : 220)}`, spare: 1 };
    case 'tools':
      return { text: zoom ? `${at} tools:\n${e.lines.map((l) => `  - ${clip(l, 220)}`).join('\n')}` : `${at} tools: ${counted(e.calls)}`, spare: 2 };
    case 'agents':
      return { text: `${at} ${e.runs.length > 1 ? `FAN-OUT: ${e.runs.length} subagents started together, at most ${mostAtOnce(e.runs)} running at once` : 'SUBAGENT'}:\n${e.runs.map((r) => runLine(r, zoom)).join('\n')}`, spare: 0 };
    case 'workflow':
      return { text: `${at} ${workflowLines(e, zoom).join('\n')}`, spare: 0 };
  }
}

/** A time the computer gives (as the overview shows them, or ISO), as a moment; NaN if it isn't one. */
export function windowTime(text: string | undefined): number {
  if (!text?.trim()) return NaN;
  const t = text.trim().replace(' ', 'T');
  return Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t) ? `${t}:00` : t);
}

/**
 * The session as a timeline: the whole of it within a budget (Claude's tool runs, then its words, go first when it runs
 * long, never what was asked or the agents), or, given a window, that stretch in more detail: each call, each agent's
 * brief, tools and answer.
 */
export function sessionTimeline(logs: SessionLogs, window: TimelineWindow = {}): string {
  const { events: all, first, last } = events(logs);
  if (first === undefined || last === undefined) return `Session ${logs.id} has nothing in it to show.`;
  const from = windowTime(window.from);
  const to = windowTime(window.to);
  const zoom = !Number.isNaN(from) || !Number.isNaN(to);
  const shown = all.filter((e) => (Number.isNaN(from) || e.at >= from) && (Number.isNaN(to) || e.at <= to + 59_999));
  const agents = logs.agents.length;
  const workflows = all.filter((e) => e.kind === 'workflow').length;
  const asks = all.filter((e) => e.kind === 'ask').length;
  const head = [
    `Session ${logs.id}: ${day(first)} ${clock(first)} → ${day(last)} ${clock(last)} (${minutes(first, last)} minutes), ${asks} messages from the user, ${agents} agents${workflows ? ` (${workflows} workflow run${workflows === 1 ? '' : 's'})` : ''}.`,
    zoom ? `Zoomed in on ${window.from ?? 'the start'} to ${window.to ?? 'the end'}: ${shown.length} of ${all.length} events.` : `The whole session; give from and to (as times here, with their date) to zoom in on a stretch.`,
  ];
  const lines: Out[] = [];
  let today = '';
  for (const e of shown) {
    if (day(e.at) !== today) {
      today = day(e.at);
      lines.push({ text: `— ${today} —`, spare: 0 });
    }
    lines.push(render(e, zoom));
  }
  const budget = zoom ? ZOOM_BUDGET : OVERVIEW_BUDGET;
  let size = lines.reduce((n, l) => n + l.text.length + 1, 0);
  let dropped = 0;
  for (const level of [2, 1] as const) {
    for (let i = 0; size > budget && i < lines.length; i++) {
      if (lines[i].spare !== level) continue;
      size -= lines[i].text.length + 1;
      lines.splice(i--, 1);
      dropped++;
    }
  }
  const note = dropped ? [`(${dropped} lines of Claude's tool runs and words left out to fit: zoom in for them.)`] : [];
  return clip([...head, ...note, '', ...lines.map((l) => l.text)].join('\n'), budget + 2_000);
}
