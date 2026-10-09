import type { Agent, GoalNote, GoalRecord, LeadPr, Waypoint } from '../../../shared/types';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { fill, h } from './dom';
import { prLink } from './goals';
import { clip, type CoursePlot, everySlice, plotCourse, seeded } from './course';

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
  };
};

const closed = (goal: GoalRecord): ChartGoal => ({
  id: goal.id, title: goal.title, note: goal.note, prs: goal.prs, openedAt: launched(goal.openedAt, goal.waypoints), closedAt: goal.closedAt,
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
const named = (w: Waypoint) => w.title ?? `Slice ${w.slice}`;

const SVG = 'http://www.w3.org/2000/svg';
function s(tag: string, attrs: Record<string, string | number> = {}, ...children: (Node | string | null | false)[]): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.append(c);
  return el;
}

/** The star chart itself: the course flown, its waypoints, scrubbed headings, what's next and the objective. */
function chartSvg(goal: ChartGoal, plot: CoursePlot, selected: number, pick: (slice: number) => void): SVGElement {
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
  const projected = s('g', { class: 'chart-projected' },
    ...plot.projected.flatMap((p) => [
      s('path', { d: `M${last.x} ${last.y} L${p.to.x} ${p.to.y}` }),
      s('circle', { cx: p.to.x, cy: p.to.y, r: 6 }),
      s('text', { x: p.label.x, y: p.label.y, 'text-anchor': p.label.anchor }, p.text),
    ]));

  const scrubbed = s('g', { class: 'chart-scrubbed' },
    ...plot.scrubbed.flatMap((x) => [
      s('path', { d: `M${x.from.x} ${x.from.y} L${x.to.x} ${x.to.y}` }),
      s('path', { class: 'cross', d: `M${x.to.x - 7} ${x.to.y - 7} l14 14 M${x.to.x + 7} ${x.to.y - 7} l-14 14` }),
      s('text', { x: x.label.x, y: x.label.y, 'text-anchor': x.label.anchor }, s('tspan', { class: 'was' }, 'SCRUBBED '), x.text),
    ]));

  const waypoints = s('g', { class: 'chart-waypoints' },
    ...plot.points.map((p) => {
      const w = p.waypoint;
      const g = s('g', { class: `chart-wp ${p.state}${w.slice === selected ? ' picked' : ''}`, tabindex: 0, role: 'button' },
        s('title', {}, `Waypoint ${w.slice}: ${named(w)}`),
        s('circle', { class: 'hit', cx: p.x, cy: p.y, r: 24 }),
        p.state === 'now' ? s('circle', { class: 'ping', cx: p.x, cy: p.y, r: 22 }) : null,
        s('circle', { class: 'ring', cx: p.x, cy: p.y, r: 19 }),
        s('circle', { class: 'core', cx: p.x, cy: p.y, r: 12 }),
        s('text', { class: 'num', x: p.x, y: p.y + 5, 'text-anchor': 'middle' }, String(w.slice)),
        s('text', { class: 'name', x: p.label.x, y: p.label.y, 'text-anchor': p.label.anchor }, p.name),
      );
      g.addEventListener('click', () => pick(w.slice));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') pick(w.slice);
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
    s('path', { class: 'chart-course', d: plot.path }),
    s('circle', { class: 'chart-launch', cx: plot.launch.x, cy: plot.launch.y, r: 7 }),
    s('text', { class: 'chart-caption launch', x: plot.launch.x - 20, y: plot.launch.y + 30 }, `LAUNCH · ${stardate(goal.openedAt)}`),
    waypoints,
  );
}

/** The picked waypoint's log: when, what it set out to do, any course correction, what it taught us, its pull requests. */
function logView(goal: ChartGoal, w: Waypoint | undefined): HTMLElement {
  const section = (label: string, tone: string, ...body: (Node | string | null)[]) => h('section', null, h('h4', { style: `--tone:${tone}` }, label), ...body);
  const objective = section('Objective', LCARS.peach, h('p', null, goal.note?.done || 'Not agreed yet'));
  if (!w) return h('div', { class: 'chart-log' }, objective);
  const now = w.slice === goal.current && !w.landedAt;
  const when = w.landedAt
    ? `${stardate(w.startedAt)} → ${stardate(w.landedAt)} · ${span(w.landedAt - w.startedAt)}`
    : now ? `Under way since ${stardate(w.startedAt)} · ${span(Date.now() - w.startedAt)}` : `Started ${stardate(w.startedAt)} · never landed`;
  const checklist = now && goal.note?.slice.length ? goal.note.slice : [];
  const prs = goal.prs.filter((p) => p.slice === w.slice);
  return h('div', { class: 'chart-log' },
    objective,
    h('div', { class: 'chart-log-head' },
      h('h3', null, `Waypoint ${w.slice} · ${named(w)}`),
      h('small', null, when)),
    checklist.length
      ? section(`This slice · ${checklist.filter((i) => i.done).length}/${checklist.length}`, LCARS.sky,
        h('ul', { class: 'goal-list checklist' }, ...checklist.map((i) => h('li', { class: i.done ? 'ticked' : '' }, i.text))))
      : null,
    w.summary || !w.title ? section('Intent', LCARS.orange, h('p', null, w.summary ?? 'Nothing shipped yet')) : null,
    w.turnedFrom ? section('Course correction', LCARS.red, h('p', null, 'Was heading for: ', h('em', null, w.turnedFrom))) : null,
    w.learned?.length ? section('Learned', LCARS.lilac, h('ul', { class: 'goal-list' }, ...w.learned.map((l) => h('li', null, l)))) : null,
    prs.length ? section('Pull requests', LCARS.periwinkle, h('div', { class: 'row' }, ...prs.map(prLink))) : null,
  );
}

/** Along the bottom: how far the voyage has come. */
function readout(goal: ChartGoal): HTMLElement {
  const n = goal.waypoints.length;
  const turns = goal.waypoints.filter((w) => w.turnedFrom).length;
  const next = goal.note?.next.length ?? 0;
  const parts = [
    `${n} waypoint${n === 1 ? '' : 's'}`,
    `${span((goal.closedAt ?? Date.now()) - goal.openedAt)}${goal.closedAt ? '' : ' under way'}`,
    `${turns} course correction${turns === 1 ? '' : 's'}`,
    goal.closedAt ? 'closed' : `${next} projected course${next === 1 ? '' : 's'}`,
  ];
  return h('div', { class: 'chart-readout' }, parts.join(' · '));
}

/**
 * A goal's star chart (stellar cartography): its slices as waypoints on a course towards the objective, with the
 * picked one's log beside it. `goal` is read afresh on every render, so a live goal's chart follows its lead.
 */
function openChart(ui: Ui, goal: () => ChartGoal | undefined, liveId?: string): void {
  const first = goal();
  if (!first) return;
  const body = h('div', { class: 'chart' });
  let picked = first.current ?? first.waypoints.at(-1)?.slice ?? 1;
  const render = () => {
    const g = goal();
    if (!g) return;
    const plot = plotCourse({ waypoints: g.waypoints, current: g.current, next: g.note?.next ?? [], seed: g.id });
    const pick = (slice: number) => {
      picked = slice;
      render();
    };
    fill(body,
      h('div', { class: 'chart-map' }, chartSvg(g, plot, picked, pick), readout(g)),
      logView(g, g.waypoints.find((w) => w.slice === picked)),
    );
  };
  render();
  ui.panels.open({ title: h('h2', null, `Stellar cartography `, h('span', { class: 'muted' }, first.title)), body, accent: LCARS.gold, wide: true });
  if (liveId) {
    ui.panels.own(state.on('agent', (agent) => {
      if (agent.id === liveId) render();
    }));
  }
  // ← and → step from waypoint to waypoint
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const slices = goal()?.waypoints.map((w) => w.slice) ?? [];
    const at = slices.indexOf(picked) + (e.key === 'ArrowLeft' ? -1 : 1);
    if (at < 0 || at >= slices.length) return;
    picked = slices[at];
    render();
  };
  window.addEventListener('keydown', keys);
  ui.panels.own(() => window.removeEventListener('keydown', keys));
}

/** The chart of a goal under way, which follows its lead as they ship, note and land slices. */
export function openGoalChart(ui: Ui, leadId: string): void {
  openChart(ui, () => {
    const agent = state.agents.get(leadId);
    return agent && live(agent);
  }, leadId);
}

/** A closed goal's chart, as it stood when it closed. */
export function openClosedGoalChart(ui: Ui, goal: GoalRecord): void {
  const chart = closed(goal);
  openChart(ui, () => chart);
}

