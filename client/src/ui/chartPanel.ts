import type { Agent, ClaudeTask, Contact, GoalArtifact, GoalNote, GoalQuestion, GoalRecord, Helper, LeadPr, Probe, Waypoint, Workflow } from '../../../shared/types';
import { api } from '../net/api';
import { artifactUrl, optionUrl } from '../../../shared/artifacts';
import { spotCheckUrl } from '../../../shared/qa';
import { openClosedGoalShown } from './screenPanel';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { fill, h } from './dom';
import { prLink } from './goals';
import { type Box, CHART, clip, type CoursePlot, everySlice, type Label, labelBox, leaderEnd, plotCourse, type ProbeFlight, probeFlights, probesOut, type Pt, seeded, shieldState, TRANSMIT_MS, waypointName } from './course';
import { orbit, type PlacedNode, sliceWork, type WorkKind, type WorkNode } from './constellation';
import { sliceProgress, sliceSteps } from '../world/goalRoom';

/** What a goal's chart is drawn from, whether it's under way or closed. */
interface ChartGoal {
  id: string;
  title: string;
  note?: GoalNote;
  waypoints: Waypoint[];
  /** The slice under way, while the goal's open. */
  current?: number;
  /** Every pull request it shipped, each with its slice. */
  prs: LeadPr[];
  contacts: Contact[];
  /** What its lead showed and asked on the station's screen, each with the slice it was shown in. */
  artifacts: GoalArtifact[];
  questions: GoalQuestion[];
  /** Claude's task list and the workflows its lead has running: the slice under way's, live. */
  tasks?: ClaudeTask[];
  workflows?: Workflow[];
  openedAt: number;
  closedAt?: number;
}

/** When the voyage launched: its first waypoint, since a reopened goal's lead starts afresh. */
const launched = (since: number, waypoints: Waypoint[] | undefined) => Math.min(since, waypoints?.[0]?.startedAt ?? since);

const live = (agent: Agent): ChartGoal | undefined => {
  const work = agent.lead;
  if (!work) return undefined;
  return {
    id: agent.id, title: work.title, note: work.note, current: work.slice, openedAt: launched(agent.startedAt, work.waypoints),
    waypoints: everySlice(work.waypoints, work.slice, agent.startedAt),
    prs: [...(work.landed ?? []), ...work.prs.map((p) => ({ ...p, slice: p.slice ?? work.slice }))],
    contacts: work.contacts ?? [],
    artifacts: work.artifacts ?? [],
    questions: work.questions ?? [],
    tasks: agent.tasks,
    workflows: agent.workflows,
  };
};

const closed = (goal: GoalRecord): ChartGoal => ({
  id: goal.id, title: goal.title, note: goal.note, prs: goal.prs, contacts: goal.contacts ?? [], artifacts: goal.artifacts ?? [], questions: goal.questions ?? [], openedAt: launched(goal.openedAt, goal.waypoints), closedAt: goal.closedAt,
  // a slice that started as the goal closed, and never shipped or taught us anything, isn't part of the voyage
  waypoints: everySlice(goal.waypoints, goal.slices, goal.openedAt).filter((w) => w.slice <= goal.slices || w.title || w.learned?.length),
});

const pad = (n: number) => String(n).padStart(2, '0');
/** A date as a stardate of sorts: SD 26.10.09. */
const stardate = (ms: number) => {
  const d = new Date(ms);
  return `SD ${pad(d.getFullYear() % 100)}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};
const span = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const hrs = Math.round(m / 60);
  return hrs < 24 ? `${hrs} h` : `${Math.floor(hrs / 24)} d${hrs % 24 ? ` ${hrs % 24} h` : ''}`;
};
const named = (w: Waypoint) => waypointName(w).name;
/** The DOM UI's LCARS green (`--lcars-green`), which the 3D palette doesn't have. */
const GREEN = '#99cc66';
const SHIELD_WORDS = { none: '', held: 'shields held', absorbed: 'hit absorbed', down: 'shields down' } as const;

/** How a contact stands, in a few words. */
const standing = (c: Contact) =>
  !c.closed ? `open since waypoint ${c.slice}` : c.closed.as === 'pursued' ? `pursued in waypoint ${c.closed.slice}` : `dropped${c.closed.why ? `: ${c.closed.why}` : ''}`;

const SVG = 'http://www.w3.org/2000/svg';
function s(tag: string, attrs: Record<string, string | number> = {}, ...children: (Node | string | null | false)[]): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.append(c);
  return el;
}

/** A faint line from a mark out to its label, starting clear of the mark. */
const leaderPath = (p: Pt, l: Label, size: number) => {
  const end = leaderEnd(p, l, size);
  const d = Math.hypot(end.x - p.x, end.y - p.y) || 1;
  return `M${p.x + ((end.x - p.x) * 16) / d} ${p.y + ((end.y - p.y) * 16) / d} L${end.x} ${end.y}`;
};

/** Each kind of work's colour on the chart and in its drawer, and what it's called there. */
const KIND: Record<WorkKind, { tone: string; name: string }> = {
  task: { tone: LCARS.peach, name: 'Task' },
  workflow: { tone: LCARS.lilac, name: 'Workflow' },
  probe: { tone: LCARS.sky, name: 'Probe' },
  commits: { tone: LCARS.peach, name: 'Commits' },
  shown: { tone: LCARS.orange, name: 'Shown' },
  asked: { tone: LCARS.orange, name: 'Asked' },
  shot: { tone: GREEN, name: 'QA screenshot' },
  pr: { tone: LCARS.periwinkle, name: 'Pull request' },
};

/** A node's colour: its kind's, unless it failed (red) or was never heard from again (grey). */
const toneOf = (n: WorkNode) => (n.state === 'failed' ? LCARS.red : n.state === 'lost' ? '#6b6488' : KIND[n.kind].tone);

/** Everything a slice did, as nodes: its tasks, and the slice under way's workflows too. */
const workOf = (goal: ChartGoal, w: Waypoint, flying: ReadonlySet<string>): WorkNode[] => {
  const now = w.slice === goal.current && !goal.closedAt;
  return sliceWork({
    waypoint: w, artifacts: goal.artifacts, questions: goal.questions, prs: goal.prs, flying,
    ...(now && { workflows: goal.workflows }),
  });
};

/** The probes on the chart still flying (out, or transmitting home), which join their waypoint's constellation once home. */
const flyingNow = (goal: ChartGoal, out: ReadonlySet<string>, now: number) =>
  new Set([...out, ...goal.waypoints.flatMap((w) => (w.probes ?? []).filter((p) => p.endedAt && now - p.endedAt < TRANSMIT_MS).map((p) => p.id))]);

/**
 * Each waypoint's constellation: its work laid round it clear of the course and its name, close in and quiet, but the
 * picked waypoint's spread out and named in `size`, clear of the other names on the chart.
 */
function constellations(goal: ChartGoal, plot: CoursePlot, focus: number, flying: ReadonlySet<string>, px: number, nameSize: number): Map<number, PlacedNode[]> {
  const toward = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
  const names: Box[] = [
    ...plot.points.flatMap((p) => (p.label ? [labelBox(p.label, p.name, nameSize)] : [])),
    ...plot.contacts.flatMap((c) => [{ x0: c.x - 9, y0: c.y - 9, x1: c.x + 9, y1: c.y + 9 }, ...(c.label ? [labelBox(c.label, c.text, nameSize)] : [])]),
    ...plot.projected.flatMap((p) => (p.label ? [labelBox(p.label, p.text, nameSize)] : [])),
  ];
  return new Map(plot.points.map((p, i) => {
    const before = plot.points[i - 1] ?? plot.launch;
    const after = plot.points[i + 1] ?? (plot.projected.length ? plot.objective : undefined);
    const name = p.label && labelBox(p.label, p.name, nameSize);
    const taken = [
      toward(p, before),
      ...(after ? [toward(p, after)] : []),
      ...(name ? [toward(p, { x: (name.x0 + name.x1) / 2, y: (name.y0 + name.y1) / 2 })] : []),
    ];
    const marks = plot.points.map((q): Box => ({ x0: q.x - 14, y0: q.y - 14, x1: q.x + 14, y1: q.y + 14 }));
    return [p.waypoint.slice, orbit(p, workOf(goal, p.waypoint, flying), taken, p.waypoint.slice === focus, px, [...names, ...marks])];
  }));
}

/** A node's mark: its kind's shape, `r` across, centred on it. */
function nodeShape(n: PlacedNode, r: number): SVGElement {
  const at = `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`;
  switch (n.kind) {
    case 'task':
      return s('rect', { class: 'mark', x: -r, y: -r, width: r * 2, height: r * 2, rx: r * 0.5, transform: at });
    case 'workflow':
      return s('path', { class: 'mark', d: Array.from({ length: 6 }, (_, k) => `${k ? 'L' : 'M'}${(Math.cos((k * Math.PI) / 3) * r * 1.2).toFixed(1)} ${(Math.sin((k * Math.PI) / 3) * r * 1.2).toFixed(1)}`).join(' ') + 'Z', transform: at });
    case 'probe':
      return s('path', { class: 'mark', d: `M${-r} ${-r} L${r * 1.4} 0 L${-r} ${r} Z`, transform: at });
    case 'shown':
    case 'asked':
    case 'shot':
      return s('path', { class: 'mark', d: `M0 ${-r * 1.3} L${r * 1.3} 0 L0 ${r * 1.3} L${-r * 1.3} 0 Z`, transform: at });
    default:
      return s('circle', { class: 'mark', cx: n.x, cy: n.y, r });
  }
}

/** A waypoint's constellation: a faint link out to each node, its mark, and (round the waypoint in focus) its name. */
function constellationSvg(p: Pt, slice: number, nodes: PlacedNode[], focus: boolean, picked: string | undefined, nav: Nav): SVGElement {
  return s('g', { class: `chart-constellation${focus ? ' focus' : ''}` }, ...nodes.map((n) => {
    const d = Math.hypot(n.x - p.x, n.y - p.y) || 1;
    const from = { x: p.x + ((n.x - p.x) * 22) / d, y: p.y + ((n.y - p.y) * 22) / d };
    const g = s('g', { class: `chart-node ${n.kind} ${n.state}${focus && n.key === picked ? ' picked' : ''}`, style: `--tone:${toneOf(n)}`, role: 'button', tabindex: focus ? 0 : -1 },
      s('title', {}, `${KIND[n.kind].name}: ${n.text}`),
      s('path', { class: 'link', d: `M${from.x.toFixed(1)} ${from.y.toFixed(1)} L${n.x.toFixed(1)} ${n.y.toFixed(1)}` }),
      s('circle', { class: 'hit', cx: n.x, cy: n.y, r: focus ? 12 : 6 }),
      nodeShape(n, focus ? 5 : 2.6),
      n.label && n.name ? s('text', { x: n.label.x, y: n.label.y, 'text-anchor': n.label.anchor }, n.name) : null,
    );
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      nav.node(slice, n.key);
    });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nav.node(slice, n.key);
    });
    return g;
  }));
}

/** The star chart itself: the course flown, its waypoints, scrubbed headings, what's next and the objective. */
function chartSvg(goal: ChartGoal, plot: CoursePlot, selected: Picked, nav: Nav, sky: Map<number, PlacedNode[]>): SVGElement {
  const { width, height } = plot;
  const rand = seeded(`${goal.id}:stars`);
  const stars = s('g', { class: 'chart-stars' });
  for (let i = 0; i < 240; i++) stars.append(s('circle', { cx: (rand() * width).toFixed(1), cy: (rand() * height).toFixed(1), r: rand() < 0.9 ? 0.8 : 1.6, fill: rand() < 0.5 ? '#f1eaff' : LCARS.sky, opacity: (0.3 + rand() * 0.7).toFixed(2) }));
  // space we've been through is clear; the rest is fog
  const holes = s('g');
  for (const p of [plot.launch, ...plot.points, ...plot.scrubbed.map((x) => x.to)]) holes.append(s('circle', { cx: p.x, cy: p.y, r: 120, fill: 'url(#chart-seen)' }));
  const { objective: o } = plot;
  const done = goal.note?.done;

  const last = plot.points.at(-1) ?? plot.launch;
  // what's next: each opens its own log, the idea in full
  const projected = s('g', { class: 'chart-projected' },
    ...plot.projected.map((p, i) => {
      const g = s('g', { class: `chart-idea${i === selected.idea ? ' picked' : ''}`, tabindex: 0, role: 'button' },
        s('title', {}, `Projected: ${goal.note?.next[i] ?? p.text}`),
        s('path', { d: `M${last.x} ${last.y} L${p.to.x} ${p.to.y}` }),
        s('circle', { class: 'hit', cx: p.to.x, cy: p.to.y, r: 14 }),
        s('circle', { class: 'mark', cx: p.to.x, cy: p.to.y, r: 6 }),
        p.label ? s('text', { x: p.label.x, y: p.label.y, 'text-anchor': p.label.anchor }, p.text) : null,
      );
      g.addEventListener('click', () => nav.idea(i));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nav.idea(i);
      });
      return g;
    }));

  const scrubbed = s('g', { class: 'chart-scrubbed' },
    ...plot.scrubbed.flatMap((x) => [
      s('path', { d: `M${x.from.x} ${x.from.y} L${x.to.x} ${x.to.y}` }),
      s('path', { class: 'cross', d: `M${x.to.x - 7} ${x.to.y - 7} l14 14 M${x.to.x + 7} ${x.to.y - 7} l-14 14` }, s('title', {}, `Scrubbed: ${x.text}`)),
      x.label ? s('text', { x: x.label.x, y: x.label.y, 'text-anchor': x.label.anchor }, s('tspan', { class: 'was' }, 'SCRUBBED '), x.text) : null,
    ]));

  // loose threads: a pursued one points to the waypoint it went into
  const contacts = s('g', { class: 'chart-contacts' },
    ...plot.contacts.map((c) => {
      const g = s('g', { class: `chart-contact ${c.state}${c.contact.id === selected.contact ? ' picked' : ''}`, role: 'button' },
        s('title', {}, `${c.contact.id}: ${c.contact.text} (${standing(c.contact)})`),
        c.pursuedAt ? s('path', { class: 'trail', d: `M${c.x} ${c.y} L${c.pursuedAt.x} ${c.pursuedAt.y}` }) : null,
        s('path', { class: 'blip', d: `M${c.x} ${c.y - 8} l8 8 l-8 8 l-8 -8 Z` }),
        c.label ? s('text', { x: c.label.x, y: c.label.y, 'text-anchor': c.label.anchor }, c.text) : null,
      );
      g.addEventListener('click', () => nav.contact(c.contact.id));
      return g;
    }));

  // the slice under way fills an arc round its waypoint as its tasks get done
  const pct = sliceProgress(sliceSteps({ slice: goal.current ?? 0, waypoints: goal.waypoints }));
  const progress = pct === null ? undefined : pct / 100;
  const ARC = 2 * Math.PI * 20;
  const waypoints = s('g', { class: 'chart-waypoints' },
    ...plot.points.map((p) => {
      const w = p.waypoint;
      const filled = p.state === 'now' ? progress : undefined;
      const shields = SHIELD_WORDS[shieldState(w.shields)];
      const g = s('g', { class: `chart-wp ${p.state}${w.slice === selected.slice && !selected.contact ? ' picked' : ''}`, tabindex: 0, role: 'button' },
        s('title', {}, `Waypoint ${w.slice}: ${named(w)}${shields ? ` (${shields})` : ''}`),
        s('circle', { class: 'hit', cx: p.x, cy: p.y, r: 24 }),
        p.state === 'now' ? s('circle', { class: 'ping', cx: p.x, cy: p.y, r: 22 }) : null,
        filled !== undefined ? s('circle', { class: 'track', cx: p.x, cy: p.y, r: 20 }) : null,
        filled !== undefined ? s('circle', { class: 'progress', cx: p.x, cy: p.y, r: 20, 'stroke-dasharray': `${(filled * ARC).toFixed(1)} ${ARC.toFixed(1)}`, transform: `rotate(-90 ${p.x} ${p.y})` }) : null,
        s('circle', { class: 'ring', cx: p.x, cy: p.y, r: 19 }),
        shieldState(w.shields) !== 'none' ? s('circle', { class: `shield ${shieldState(w.shields)}`, cx: p.x, cy: p.y, r: 16 }) : null,
        s('circle', { class: 'core', cx: p.x, cy: p.y, r: 12 }),
        s('text', { class: 'num', x: p.x, y: p.y + 5, 'text-anchor': 'middle' }, String(w.slice)),
        p.label?.leader ? s('path', { class: 'leader', d: leaderPath(p, p.label, plot.sizes.waypoint) }) : null,
        p.label ? s('text', { class: `name ${p.named}`, x: p.label.x, y: p.label.y, 'text-anchor': p.label.anchor }, p.name) : null,
      );
      g.addEventListener('click', () => nav.slice(w.slice));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nav.slice(w.slice);
      });
      return g;
    }));

  return s('svg', { class: 'chart-svg', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMidYMid meet' },
    s('defs', {},
      s('radialGradient', { id: 'chart-neb' },
        s('stop', { offset: 0, 'stop-color': LCARS.peach, 'stop-opacity': 0.95 }),
        s('stop', { offset: 0.35, 'stop-color': LCARS.lilac, 'stop-opacity': 0.55 }),
        s('stop', { offset: 0.75, 'stop-color': LCARS.periwinkle, 'stop-opacity': 0.18 }),
        s('stop', { offset: 1, 'stop-color': LCARS.periwinkle, 'stop-opacity': 0 })),
      s('radialGradient', { id: 'chart-seen' },
        s('stop', { offset: 0, 'stop-color': '#000' }), s('stop', { offset: 0.6, 'stop-color': '#000' }), s('stop', { offset: 1, 'stop-color': '#fff' })),
      s('mask', { id: 'chart-fog' }, s('rect', { width, height, fill: '#fff' }), holes),
      s('pattern', { id: 'chart-grid', width: 60, height: 60, patternUnits: 'userSpaceOnUse' }, s('path', { d: 'M60 0H0V60', fill: 'none', stroke: '#1d1a2e' }))),
    s('rect', { width, height, fill: 'url(#chart-grid)' }),
    stars,
    s('rect', { width, height, fill: '#05040a', opacity: 0.8, mask: 'url(#chart-fog)' }),
    s('circle', { cx: o.x, cy: o.y, r: o.r * 1.15, fill: 'url(#chart-neb)' }),
    s('circle', { class: 'chart-objective', cx: o.x, cy: o.y, r: o.r * 0.68 }),
    s('text', { class: 'chart-caption', x: o.x, y: o.y - o.r - 8, 'text-anchor': 'middle' }, 'OBJECTIVE'),
    s('foreignObject', { x: o.x - o.r * 0.9, y: o.y - o.r * 0.62, width: o.r * 1.8, height: o.r * 1.24 },
      h('div', { class: 'chart-done' }, done ? clip(done, 56) : 'Not agreed yet')),
    projected,
    scrubbed,
    contacts,
    s('path', { class: 'chart-course', d: plot.path }),
    ...plot.points.map((p) => constellationSvg(p, p.waypoint.slice, sky.get(p.waypoint.slice) ?? [], p.waypoint.slice === selected.slice, selected.node, nav)),
    s('circle', { class: 'chart-launch', cx: plot.launch.x, cy: plot.launch.y, r: 7 }),
    s('text', { class: 'chart-caption launch', x: plot.launch.x - 20, y: plot.launch.y + 30 }, `LAUNCH · ${stardate(goal.openedAt)}`),
    waypoints,
    s('g', { class: 'chart-probes' }),
  );
}

const section = (label: string, tone: string, ...body: (Node | string | null)[]) => h('section', null, h('h4', { style: `--tone:${tone}` }, label), ...body);
const prOf = (prs: LeadPr[], repo: string, pr: number) => prs.find((p) => p.repo === repo && p.number === pr);

/**
 * The probes in flight, drawn afresh each frame while there are any: one that's out trails back to its waypoint with
 * what it was sent to find and what it's doing now; one that has reported sends pulses home down its trail (green when
 * it completed, red when it failed) and fades out as the transmission ends. Clicking one opens its helper while it's out.
 */
function drawProbes(layer: Element, flights: ProbeFlight[], helpers: Helper[], open: (f: ProbeFlight) => void): void {
  layer.replaceChildren(...flights.map((f) => {
    const helper = helpers.find((x) => x.id === f.probe.id);
    const fade = f.phase === 'out' ? 1 : 1 - f.sent * f.sent;
    const tone = f.phase === 'out' ? 'out' : f.probe.ok ? 'sent' : 'lost';
    const pulses = f.phase === 'transmitting'
      ? [0, 0.33, 0.66].map((k) => {
        const along = (f.sent * 3 + k) % 1;
        return s('circle', { class: 'pulse', cx: f.x + (f.from.x - f.x) * along, cy: f.y + (f.from.y - f.y) * along, r: 3.5, opacity: (1 - along * 0.6).toFixed(2) });
      })
      : [];
    const said = f.phase === 'out' ? helper?.activity ?? (f.probe.type === 'script' ? 'Running…' : 'Exploring') : `${f.probe.ok ? 'Transmitting' : 'Lost'}: ${f.probe.summary ?? (f.probe.ok ? 'done' : 'it hit a problem')}`;
    const deg = (f.angle * 180) / Math.PI;
    const g = s('g', { class: `chart-probe ${tone}`, opacity: fade.toFixed(2), role: 'button' },
      s('title', {}, `Probe: ${f.probe.description}${f.probe.type ? ` (${f.probe.type})` : ''}`),
      s('path', { class: 'trail', d: `M${f.from.x} ${f.from.y} L${f.x} ${f.y}` }),
      ...pulses,
      s('circle', { class: 'glow', cx: f.x, cy: f.y, r: 14 }),
      s('path', { class: 'ship', d: 'M-5 -5 L8 0 L-5 5 Z', transform: `translate(${f.x} ${f.y}) rotate(${deg.toFixed(1)})` }),
      s('text', { class: 'what', x: f.label.x, y: f.label.y, 'text-anchor': f.label.anchor }, `PROBE · ${clip(f.probe.description, 40)}`),
      s('text', { class: 'doing', x: f.label.x, y: f.label.y + 16, 'text-anchor': f.label.anchor }, clip(said, 48)),
    );
    g.addEventListener('click', () => open(f));
    return g;
  }));
}

/** How long a probe was out: a script's seconds, a helper's minutes. */
const flight = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : span(ms));

/** How a probe went, in a few words: out now, what it transmitted, or that contact was lost. */
const probeStanding = (p: Probe, out: boolean) =>
  !p.endedAt ? (out ? `Out now, for ${flight(Date.now() - p.launchedAt)}` : 'Lost contact before it reported')
    : `${p.ok ? 'Transmitted' : 'Lost'} after ${flight(p.endedAt - p.launchedAt)}`;

/** Which waypoint's log is beside the chart, or which contact's, or which projected course's (its place in what's next). */
interface Picked {
  slice: number;
  contact?: string;
  idea?: number;
  /** One of the waypoint's constellation of work (`WorkNode.key`). */
  node?: string;
}

/** Picking a waypoint, a contact or a projected course, to see beside the chart. */
interface Nav {
  slice: (slice: number) => void;
  contact: (id: string) => void;
  idea: (index: number) => void;
  node: (slice: number, key: string) => void;
}

/** What's next as a list, each opening its own log. */
const ideaList = (ideas: string[], nav: Nav, except?: number) =>
  h('ul', { class: 'chart-threads chart-ideas' }, ...ideas.flatMap((idea, i) =>
    i === except ? [] : [h('li', null, h('button', { class: 'chart-thread', onclick: () => nav.idea(i) }, h('span', null, idea)))]));

/** A projected course's log: the lead's idea for what's next in full, where it heads on from, and the other ideas. */
function ideaView(goal: ChartGoal, ideas: string[], index: number, nav: Nav): HTMLElement {
  const from = goal.waypoints.at(-1);
  return h('div', { class: 'chart-log' },
    h('div', { class: 'chart-log-head' },
      h('h3', null, `Projected course ${index + 1} of ${ideas.length}`),
      h('small', null, 'An idea for what’s next, not yet set')),
    section('Heading for', LCARS.periwinkle, h('p', null, ideas[index])),
    from ? section('On from', LCARS.orange, waypointLink(goal, from.slice, nav)) : null,
    ideas.length > 1 ? section('Other courses', LCARS.periwinkle, ideaList(ideas, nav, index)) : null,
    h('p', { class: 'muted' }, 'The lead rewrites these as the goal moves on: one becomes a waypoint once a slice ships it.'),
  );
}

/** Loose threads as a list, each opening its own log. */
const threadList = (list: Contact[], nav: Nav) =>
  h('ul', { class: 'chart-threads' }, ...list.map((c) =>
    h('li', { class: c.closed?.as ?? 'open' }, h('button', { class: 'chart-thread', onclick: () => nav.contact(c.id) }, h('span', null, c.text), h('small', null, standing(c))))));

/** A waypoint as a link to its log. */
const waypointLink = (goal: ChartGoal, slice: number, nav: Nav) => {
  const w = goal.waypoints.find((x) => x.slice === slice);
  return w ? h('button', { class: 'chart-jump', onclick: () => nav.slice(slice) }, `Waypoint ${slice} · ${named(w)}`) : h('span', null, `Waypoint ${slice}`);
};

/** A contact's log: the thread in full, where it was noticed, and what became of it. */
function contactView(goal: ChartGoal, c: Contact, nav: Nav): HTMLElement {
  const closed = c.closed;
  return h('div', { class: 'chart-log' },
    h('div', { class: 'chart-log-head' },
      h('h3', null, `Contact ${c.id} · ${closed ? closed.as : 'open'}`),
      h('small', null, `Noticed ${stardate(c.at)}${closed ? ` · ${closed.as} ${stardate(closed.at)}` : ` · open ${span(Date.now() - c.at)}`}`)),
    section('Loose thread', LCARS.sky, h('p', null, c.text)),
    section('Noticed in', LCARS.orange, waypointLink(goal, c.slice, nav)),
    closed?.as === 'pursued'
      ? section('Pursued in', GREEN, waypointLink(goal, closed.slice, nav), closed.why ? h('p', null, closed.why) : null)
      : closed
        ? section('Dropped', LCARS.red, h('p', null, closed.why ?? 'No reason given'), h('small', null, 'In ', waypointLink(goal, closed.slice, nav)))
        : section('Still open', LCARS.sky, h('p', null, 'The lead hears it with the note at every new slice, until they pursue it or drop it.')),
  );
}

/** What the drawer's views need from the chart beyond the goal: what's live, and what the captain can do from there. */
interface Ctx {
  nav: Nav;
  out: ReadonlySet<string>;
  /** The lead whose goal it is, while it's under way. */
  liveId?: string;
  ui: Ui;
  tick?: (slice: number, index: number, checked: boolean) => void;
  openShown: () => void;
}

/** A slice's work as a list, each opening its own view, ticked off as it's done. */
const workList = (slice: number, nodes: WorkNode[], nav: Nav) =>
  h('ul', { class: 'chart-work' }, ...nodes.map((n) =>
    h('li', { class: n.state, style: `--tone:${toneOf(n)}` },
      h('button', { class: 'chart-thread', onclick: () => nav.node(slice, n.key) }, h('small', null, KIND[n.kind].name), h('span', null, n.text)))));

/** The drawer's heading: what it is, its name, and a line on how it stands. */
const head = (kind: string, tone: string, title: Node | string, sub?: string) =>
  h('div', { class: 'chart-log-head', style: `--tone:${tone}` }, h('small', { class: 'chart-kind' }, kind), h('h3', null, title), sub ? h('small', null, sub) : null);

/** The picked waypoint's log: when, what it set out to do, any course correction, what it taught us, its guardrails and its work. */
function logView(goal: ChartGoal, w: Waypoint | undefined, nodes: WorkNode[], ctx: Ctx): HTMLElement {
  const { nav } = ctx;
  if (!w) return h('div', { class: 'chart-log' }, h('p', { class: 'muted' }, 'Nothing on the chart yet.'));
  const now = w.slice === goal.current && !w.landedAt;
  const when = w.landedAt
    ? `${stardate(w.startedAt)} → ${stardate(w.landedAt)} · ${span(w.landedAt - w.startedAt)}`
    : now ? `Under way since ${stardate(w.startedAt)} · ${span(Date.now() - w.startedAt)}` : `Started ${stardate(w.startedAt)} · never landed`;
  const noticed = goal.contacts.filter((c) => c.slice === w.slice);
  const ideas = goal.note?.next ?? [];
  return h('div', { class: 'chart-log' },
    head(`Waypoint ${w.slice}`, LCARS.orange, named(w), when),
    w.summary || !w.title
      ? section('Intent', LCARS.orange, w.summary ? h('p', null, w.summary)
        : w.heading ? h('p', null, h('em', null, w.heading), h('small', { class: 'chart-aside' }, 'Its heading, until it ships under its own title'))
        : h('p', { class: 'muted' }, !now ? 'Nothing shipped' : waypointName(w).named === 'work' ? 'Nothing shipped yet: named after what the lead’s at' : 'Nothing shipped yet'))
      : null,
    w.turnedFrom ? section('Course correction', LCARS.red, h('p', null, 'Was heading for: ', h('em', null, w.turnedFrom))) : null,
    w.learned?.length ? section('Learned', LCARS.lilac, h('ul', { class: 'goal-list' }, ...w.learned.map((l) => h('li', null, l)))) : null,
    shieldsView(w),
    spotChecksView(w, goal.prs, ctx.tick),
    nodes.length ? section(`Work · ${nodes.length}`, LCARS.peach, workList(w.slice, nodes, nav)) : null,
    noticed.length ? section('Noticed here', LCARS.sky, threadList(noticed, nav)) : null,
    ideas.length && w === goal.waypoints.at(-1) && !goal.closedAt ? section(`Projected · ${ideas.length}`, LCARS.periwinkle, ideaList(ideas, nav)) : null,
  );
}

/** A picture to open: a screenshot full size, or a visual or question up close on the station's screen. */
const thumb = (src: string | undefined, caption: string, open: () => void) =>
  h('button', { class: 'chart-thumb', title: caption, onclick: open },
    src ? h('img', { src, alt: caption, loading: 'lazy' }) : h('span', { class: 'chart-thumb-none' }, 'No picture'),
    h('small', null, caption));

/** One piece of a slice's work on its own: what it is, how it stands, and where to go for more. */
function nodeView(goal: ChartGoal, w: Waypoint, node: WorkNode, nodes: WorkNode[], ctx: Ctx): HTMLElement {
  const { nav } = ctx;
  const id = node.key.slice(node.key.indexOf(':') + 1);
  const kind = KIND[node.kind];
  const back = h('button', { class: 'chart-jump', onclick: () => nav.slice(w.slice) }, `← Waypoint ${w.slice} · ${named(w)}`);
  const at = nodes.indexOf(node);
  const steps = h('small', { class: 'chart-aside' }, `${at + 1} of ${nodes.length} · ↑ ↓ to step through`);
  const view = (sub: string | undefined, ...body: (Node | string | null)[]) =>
    h('div', { class: 'chart-log' }, back, head(`${kind.name} · waypoint ${w.slice}`, kind.tone, node.text, sub), ...body, steps);
  switch (node.kind) {
    case 'task': {
      const t = w.tasks?.find((x) => x.id === id);
      // what it says while doing it is only on the lead's live list
      const doing = t?.status === 'in_progress' ? goal.tasks?.find((x) => x.id === id)?.activeForm : undefined;
      return view({ pending: 'To do', in_progress: 'Doing it now', completed: 'Done' }[t?.status ?? 'pending'],
        doing ? h('p', null, h('em', null, `${doing}…`)) : null,
        h('p', { class: 'muted' }, 'On the task list the lead keeps for itself in Claude Code.'));
    }
    case 'workflow': {
      const f = goal.workflows?.find((x) => x.id === id);
      if (!f) return view(undefined);
      const total = f.roll.length;
      const done = f.roll.filter((r) => r.status === 'done').length;
      return view(`${f.status === 'running' ? 'Running' : f.status === 'done' ? 'Finished' : 'Failed'} · ${done} of ${total} agents done · ${span(Date.now() - f.startedAt)}`,
        f.description ? h('p', null, f.description) : null,
        f.phases.length ? section('Phases', LCARS.lilac, h('ul', { class: 'goal-list' }, ...f.phases.map((ph) =>
          h('li', null, ph.title, h('small', { class: 'chart-aside' }, (['done', 'working', 'queued', 'failed'] as const).filter((k) => ph[k]).map((k) => `${ph[k]} ${k}`).join(' · ')))))) : null,
        ctx.liveId ? h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => ctx.liveId && ctx.ui.openWorkflowScript(ctx.liveId, f.id) }, 'Script and results')) : null);
    }
    case 'probe': {
      const p = w.probes?.find((x) => x.id === id);
      if (!p) return view(undefined);
      const helper = ctx.liveId && p.type !== 'script' ? state.agents.get(ctx.liveId)?.helpers?.find((x) => x.id === p.id) : undefined;
      return view(`${p.type === 'script' ? 'Script' : p.type ?? 'Helper'} · ${probeStanding(p, ctx.out.has(p.id))}`,
        p.summary ? section('Transmitted', p.ok ? GREEN : LCARS.red, h('p', null, p.summary)) : null,
        helper && ctx.liveId ? h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => ctx.liveId && ctx.ui.openHelper(ctx.liveId, p.id) }, 'Transcript')) : null);
    }
    case 'commits':
      return view(undefined, w.lastCommit ? section('Last commit', LCARS.peach, h('p', null, h('em', null, w.lastCommit))) : null);
    case 'shown': {
      const a = goal.artifacts.find((x) => x.id === id);
      return view(a ? `Shown ${stardate(a.at)}` : undefined, h('div', { class: 'chart-evidence one' }, thumb(a?.image ? artifactUrl(goal.id, a, 'jpg') : undefined, 'Open it up close', ctx.openShown)));
    }
    case 'asked': {
      const q = goal.questions.find((x) => x.id === id);
      if (!q) return view(undefined);
      const pick = q.options.find((o) => o.id === q.answer?.option);
      const first = pick?.image ? pick : q.options.find((o) => o.image);
      return view(q.answer ? `Answered ${stardate(q.answer.at)}` : 'Waiting for your answer',
        section('Answer', q.answer ? GREEN : LCARS.gold, h('p', null, pick ? pick.label : q.answer?.note ?? 'Not yet')),
        h('div', { class: 'chart-evidence one' }, thumb(first ? optionUrl(goal.id, q, first.id, 'jpg') : undefined, 'Open it up close', ctx.openShown)));
    }
    case 'shot': {
      const e = w.evidence?.[Number(id)];
      if (!e) return view(undefined);
      const src = `/api/artifacts/${goal.id}/${e.file}`;
      return view(`${e.repo.split('/')[1]} #${e.pr} · taken by QA`, h('div', { class: 'chart-evidence one' }, thumb(src, 'Open full size', () => window.open(src, '_blank', 'noopener'))));
    }
    case 'pr': {
      const pr = goal.prs.find((p) => `${p.repo}#${p.number}` === id);
      const shield = w.shields?.filter((sh) => `${sh.repo}#${sh.pr}` === id) ?? [];
      const spots = (w.spotChecks ?? []).filter((c) => `${c.repo}#${c.pr}` === id);
      return view(pr?.outcome ? pr.outcome[0].toUpperCase() + pr.outcome.slice(1) : 'Open',
        pr ? h('div', { class: 'row' }, prLink(pr)) : null,
        shieldsView({ ...w, shields: shield }),
        spots.length ? h('p', { class: 'muted' }, `${spots.filter((c) => c.checked).length} of ${spots.length} spot-checks looked at: they’re on the waypoint’s log.`) : null);
    }
  }
}

/** Each of the slice's pull requests' guardrails, as QA last reported on it. */
function shieldsView(w: Waypoint): HTMLElement | null {
  if (!w.shields?.length) return null;
  const state = shieldState(w.shields);
  const tone = { none: GREEN, held: GREEN, absorbed: LCARS.gold, down: LCARS.red }[state];
  return section(`Shields · ${SHIELD_WORDS[state]}`, tone, h('ul', { class: 'chart-shields' }, ...w.shields.map((sh) => {
    const total = sh.checks.pass + sh.checks.fail + sh.checks.skip;
    const name = `${sh.repo.split('/')[1]} #${sh.pr}`;
    return h('li', { class: sh.verdict === 'fail' ? 'down' : sh.failedRounds ? 'absorbed' : 'held' },
      h('b', null, name),
      h('span', { class: `chip check ${sh.verdict}` }, `QA ${sh.verdict}`),
      h('span', null, `${sh.checks.pass}/${total} checks`),
      sh.ci && sh.ci !== 'none' ? h('span', { class: `chip check ${sh.ci === 'passing' ? 'pass' : sh.ci === 'failing' ? 'fail' : 'skip'}` }, `CI ${sh.ci}`) : null,
      sh.verdict === 'pass' && sh.failedRounds
        ? h('small', null, `Hit absorbed: QA failed it ${sh.failedRounds === 1 ? 'once' : `${sh.failedRounds} times`} before it was fixed`)
        : sh.failing?.length ? h('small', null, `Failing: ${sh.failing.join(', ')}`) : null,
    );
  })));
}

/** The places QA picked for a human look: each links to the pull request's files, and ticks off once you've looked. */
function spotChecksView(w: Waypoint, prs: LeadPr[], tick?: (slice: number, index: number, checked: boolean) => void): HTMLElement | null {
  const spots = w.spotChecks ?? [];
  if (!spots.length) return null;
  const looked = spots.filter((c) => c.checked).length;
  return section(`Spot-checks · ${looked} of ${spots.length} looked at`, LCARS.gold, h('ul', { class: 'chart-spots' }, ...spots.map((c, i) => {
    const box = h('input', { type: 'checkbox', checked: !!c.checked, disabled: !tick, title: tick ? 'Ticked once you’ve looked' : undefined });
    box.onchange = () => tick?.(w.slice, i, box.checked);
    const pr = prOf(prs, c.repo, c.pr);
    const where = `${c.file}${c.line ? `:${c.line}` : ''}`;
    return h('li', { class: c.checked ? 'looked' : '' },
      h('label', null, box,
        h('span', null,
          pr ? h('a', { href: spotCheckUrl(pr.url, c), target: '_blank', rel: 'noreferrer', class: 'mono', title: 'Open it in the pull request’s changed files' }, where) : h('span', { class: 'mono' }, where),
          h('small', null, `${c.repo.split('/')[1]} #${c.pr} · ${c.why}`))));
  })));
}

/** Along the bottom: how far the voyage has come. */
function readout(goal: ChartGoal): HTMLElement {
  const n = goal.waypoints.length;
  const turns = goal.waypoints.filter((w) => w.turnedFrom).length;
  const next = goal.note?.next.length ?? 0;
  const open = goal.contacts.filter((c) => !c.closed).length;
  const hits = goal.waypoints.filter((w) => shieldState(w.shields) === 'absorbed').length;
  const toLook = goal.waypoints.flatMap((w) => w.spotChecks ?? []).filter((c) => !c.checked).length;
  const parts = [
    `${n} waypoint${n === 1 ? '' : 's'}`,
    `${span((goal.closedAt ?? Date.now()) - goal.openedAt)}${goal.closedAt ? '' : ' under way'}`,
    ...(turns ? [`${turns} course correction${turns === 1 ? '' : 's'}`] : []),
    ...(open ? [`${open} contact${open === 1 ? '' : 's'} open`] : []),
    ...(hits ? [`${hits} hit${hits === 1 ? '' : 's'} absorbed`] : []),
    ...(toLook ? [`${toLook} spot-check${toLook === 1 ? '' : 's'} to look at`] : []),
    goal.closedAt ? 'closed' : `${next} projected`,
  ];
  return h('div', { class: 'chart-readout' }, parts.join(' · '));
}

/** How far the chart zooms in on the waypoint in focus. */
const ZOOM = 1.7;
/** The course's names, in screen pixels once the chart's bigger than it's laid out for (they shrink with it when it's smaller). */
const NAME_PX = 17;

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}
const WHOLE: View = { x: 0, y: 0, w: CHART.width, h: CHART.height };

/** The part of the chart in view zoomed in on `p`: `ZOOM` times closer, kept on the chart. */
const zoomOn = (p: Pt): View => {
  const w = CHART.width / ZOOM;
  const h = CHART.height / ZOOM;
  return { x: Math.max(0, Math.min(CHART.width - w, p.x - w / 2)), y: Math.max(0, Math.min(CHART.height - h, p.y - h / 2)), w, h };
};

/**
 * A goal's star chart (stellar cartography): its slices as waypoints on a course towards the objective, each with its
 * work round it as a constellation, and a drawer for the picked waypoint, or one piece of its work. `goal` is read
 * afresh on every render, so a live goal's chart follows its lead.
 */
function openChart(ui: Ui, goal: () => ChartGoal | undefined, shown: (ui: Ui) => void, liveId?: string): void {
  const first = goal();
  if (!first) return;
  const body = h('div', { class: 'chart' });
  const picked: Picked = { slice: first.current ?? first.waypoints.at(-1)?.slice ?? 1 };
  // what was last drawn: the lead's agent changes far more often than their goal does, and redrawing the same chart
  // would only flicker its pictures; a change to the same waypoint keeps the log scrolled where it was
  let drawn = '';
  let drawnPick = '';
  // the helpers still out, whose probes are in flight
  const helpers = () => (liveId ? state.agents.get(liveId)?.helpers ?? [] : []);
  const out = () => probesOut(liveId ? state.agents.get(liveId) : undefined);
  // zoomed in on the picked waypoint, or the whole voyage; the view eases from where it was to where it's going
  let zoomed = false;
  let view: View = WHOLE;
  let target: View = WHOLE;
  let easing = 0;
  // how many screen pixels a unit of the chart takes with the whole voyage in view
  const fit = () => {
    const svg = body.querySelector('.chart-svg');
    const r = svg?.getBoundingClientRect();
    return r?.width ? Math.min(r.width / CHART.width, r.height / CHART.height) : Math.max(0.6, (window.innerWidth - 420) / CHART.width);
  };
  const showView = () => {
    const svg = body.querySelector<SVGSVGElement>('.chart-svg');
    if (!svg) return;
    svg.setAttribute('viewBox', `${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`);
    // the words stay the same size on the screen however far in it's zoomed
    svg.style.setProperty('--z', String(fit() * (CHART.width / view.w)));
  };
  const ease = () => {
    cancelAnimationFrame(easing);
    const from = view;
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 350);
      const e = 1 - (1 - k) ** 3;
      view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
      showView();
      easing = k < 1 ? requestAnimationFrame(step) : 0;
    };
    easing = requestAnimationFrame(step);
  };
  const resized = new ResizeObserver(showView);
  ui.panels.own(() => {
    cancelAnimationFrame(easing);
    resized.disconnect();
  });
  // probes move every frame while there are any, without redrawing the rest of the chart; one coming home joins its
  // waypoint's constellation, which takes a redraw
  let plotted: { goal: ChartGoal; plot: CoursePlot } | undefined;
  let frame = 0;
  let drawnFlying = '';
  const fly = () => {
    frame = 0;
    const layer = body.querySelector('.chart-probes');
    if (!plotted || !layer) return;
    const now = Date.now();
    const flights = probeFlights(plotted.plot, plotted.goal.waypoints, out(), now);
    drawProbes(layer, flights, helpers(), (f) => (f.phase === 'out' && f.probe.type !== 'script' && liveId ? ui.openHelper(liveId, f.probe.id) : nav.slice(f.slice)));
    if (flights.length) frame = requestAnimationFrame(fly);
    if ([...flyingNow(plotted.goal, out(), now)].join() !== drawnFlying) render();
  };
  ui.panels.own(() => cancelAnimationFrame(frame));
  const nav: Nav = {
    slice: (slice) => {
      picked.slice = slice;
      delete picked.contact;
      delete picked.idea;
      delete picked.node;
      zoomed = true;
      render();
    },
    contact: (id) => {
      picked.contact = id;
      delete picked.idea;
      delete picked.node;
      render();
    },
    idea: (index) => {
      picked.idea = index;
      delete picked.contact;
      delete picked.node;
      render();
    },
    node: (slice, key) => {
      picked.slice = slice;
      picked.node = key;
      delete picked.contact;
      delete picked.idea;
      zoomed = true;
      render();
    },
  };
  // a step back out to the whole voyage, over the chart's top corner
  const whole = h('button', { class: 'btn small chart-whole', onclick: () => {
    zoomed = false;
    render();
  } }, 'Whole voyage');
  // the picked waypoint's work, for stepping through with ↑ and ↓
  let work: WorkNode[] = [];
  const render = () => {
    const g = goal();
    if (!g) return;
    const flying = flyingNow(g, out(), Date.now());
    const key = `${JSON.stringify(g)}|${[...flying].join()}`;
    const pickKey = `${picked.slice}:${picked.contact ?? ''}:${picked.idea ?? ''}:${picked.node ?? ''}:${zoomed}`;
    if (key === drawn && pickKey === drawnPick) return;
    const scrolled = pickKey === drawnPick ? body.querySelector('.chart-log')?.scrollTop ?? 0 : 0;
    drawn = key;
    drawnPick = pickKey;
    drawnFlying = [...flying].join();
    // a closed goal's ideas for next went nowhere: its chart ends at its last waypoint
    const ideas = g.closedAt ? [] : g.note?.next ?? [];
    const plot = plotCourse({ waypoints: g.waypoints, current: g.current, next: ideas, contacts: g.contacts, seed: g.id });
    const at = plot.points.find((p) => p.waypoint.slice === picked.slice);
    target = zoomed && at ? zoomOn(at) : WHOLE;
    // the words' size in the chart's units, as they'll be drawn once the view has eased to where it's going
    const z = fit() * (CHART.width / target.w);
    const sky = constellations(g, plot, picked.slice, flying, 1 / z, NAME_PX / Math.max(1, z));
    work = workOf(g, g.waypoints.find((w) => w.slice === picked.slice) ?? { slice: 0, startedAt: 0 }, flying);
    const w = g.waypoints.find((x) => x.slice === picked.slice);
    const node = work.find((n) => n.key === picked.node);
    const ctx: Ctx = {
      nav, out: out(), liveId, ui, openShown: () => shown(ui),
      ...(liveId && { tick: (slice: number, index: number, checked: boolean) => void api.tickSpotCheck(liveId, slice, index, checked).catch((err: Error) => ui.error(err.message)) }),
    };
    const contact = g.contacts.find((c) => c.id === picked.contact);
    const log = contact
      ? contactView(g, contact, nav)
      : picked.idea !== undefined && ideas[picked.idea] !== undefined
        ? ideaView(g, ideas, picked.idea, nav)
        : node && w ? nodeView(g, w, node, work, ctx) : logView(g, w, work, ctx);
    whole.hidden = !zoomed;
    fill(body, h('div', { class: 'chart-map' }, chartSvg(g, plot, picked, nav, sky), whole, readout(g)), log);
    const svg = body.querySelector('.chart-svg');
    if (svg) resized.observe(svg);
    showView();
    if (target !== view) ease();
    log.scrollTop = scrolled;
    plotted = { goal: g, plot };
    if (!frame) fly();
  };
  render();
  ui.panels.open({ title: h('h2', null, `Stellar cartography `, h('span', { class: 'muted' }, first.title)), body, accent: LCARS.gold, wide: true, full: true });
  // the panel's laid out now: size the chart's words for it
  requestAnimationFrame(() => {
    drawn = '';
    render();
  });
  if (liveId) {
    ui.panels.own(state.on('agent', (agent) => {
      if (agent.id === liveId) render();
    }));
  }
  // ← and → step from waypoint to waypoint, ↑ and ↓ through the picked one's work
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!work.length) return;
      e.preventDefault();
      const i = work.findIndex((n) => n.key === picked.node);
      const next = e.key === 'ArrowDown' ? (i + 1) % work.length : i <= 0 ? work.length - 1 : i - 1;
      nav.node(picked.slice, work[next].key);
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const slices = goal()?.waypoints.map((w) => w.slice) ?? [];
    const at = slices.indexOf(picked.slice) + (e.key === 'ArrowLeft' ? -1 : 1);
    if (at < 0 || at >= slices.length) return;
    nav.slice(slices[at]);
  };
  window.addEventListener('keydown', keys);
  ui.panels.own(() => window.removeEventListener('keydown', keys));
}

/** The chart of a goal under way, which follows its lead as they ship, note and land slices. */
export function openGoalChart(ui: Ui, leadId: string): void {
  openChart(ui, () => {
    const agent = state.agents.get(leadId);
    return agent && live(agent);
  }, (u) => u.openScreen(leadId), leadId);
}

/** A closed goal's chart, as it stood when it closed. */
export function openClosedGoalChart(ui: Ui, goal: GoalRecord): void {
  const chart = closed(goal);
  openChart(ui, () => chart, (u) => openClosedGoalShown(u, goal));
}

