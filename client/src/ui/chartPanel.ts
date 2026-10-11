import type { Agent, Contact, GoalArtifact, GoalNote, GoalQuestion, GoalRecord, LeadPr, Waypoint } from '../../../shared/types';
import { api } from '../net/api';
import { artifactUrl, optionUrl } from '../../../shared/artifacts';
import { openClosedGoalShown } from './screenPanel';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { fill, h } from './dom';
import { prLink } from './goals';
import { clip, type CoursePlot, everySlice, type Label, leaderEnd, plotCourse, type Pt, seeded, shieldState } from './course';

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
const named = (w: Waypoint) => w.title ?? `Slice ${w.slice}`;
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

/** The star chart itself: the course flown, its waypoints, scrubbed headings, what's next and the objective. */
function chartSvg(goal: ChartGoal, plot: CoursePlot, selected: Picked, nav: Nav): SVGElement {
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

  const waypoints = s('g', { class: 'chart-waypoints' },
    ...plot.points.map((p) => {
      const w = p.waypoint;
      const shields = SHIELD_WORDS[shieldState(w.shields)];
      const g = s('g', { class: `chart-wp ${p.state}${w.slice === selected.slice && !selected.contact ? ' picked' : ''}`, tabindex: 0, role: 'button' },
        s('title', {}, `Waypoint ${w.slice}: ${named(w)}${shields ? ` (${shields})` : ''}`),
        s('circle', { class: 'hit', cx: p.x, cy: p.y, r: 24 }),
        p.state === 'now' ? s('circle', { class: 'ping', cx: p.x, cy: p.y, r: 22 }) : null,
        s('circle', { class: 'ring', cx: p.x, cy: p.y, r: 19 }),
        shieldState(w.shields) !== 'none' ? s('circle', { class: `shield ${shieldState(w.shields)}`, cx: p.x, cy: p.y, r: 16 }) : null,
        s('circle', { class: 'core', cx: p.x, cy: p.y, r: 12 }),
        s('text', { class: 'num', x: p.x, y: p.y + 5, 'text-anchor': 'middle' }, String(w.slice)),
        p.label?.leader ? s('path', { class: 'leader', d: leaderPath(p, p.label, plot.sizes.waypoint) }) : null,
        p.label ? s('text', { class: 'name', x: p.label.x, y: p.label.y, 'text-anchor': p.label.anchor }, p.name) : null,
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
    s('circle', { class: 'chart-launch', cx: plot.launch.x, cy: plot.launch.y, r: 7 }),
    s('text', { class: 'chart-caption launch', x: plot.launch.x - 20, y: plot.launch.y + 30 }, `LAUNCH · ${stardate(goal.openedAt)}`),
    waypoints,
  );
}

const section = (label: string, tone: string, ...body: (Node | string | null)[]) => h('section', null, h('h4', { style: `--tone:${tone}` }, label), ...body);
const prOf = (prs: LeadPr[], repo: string, pr: number) => prs.find((p) => p.repo === repo && p.number === pr);

/** Which waypoint's log is beside the chart, or which contact's, or which projected course's (its place in what's next). */
interface Picked {
  slice: number;
  contact?: string;
  idea?: number;
}

/** Picking a waypoint, a contact or a projected course, to see beside the chart. */
interface Nav {
  slice: (slice: number) => void;
  contact: (id: string) => void;
  idea: (index: number) => void;
}

/** What's next as a list, each opening its own log. */
const ideaList = (ideas: string[], nav: Nav, except?: number) =>
  h('ul', { class: 'chart-threads chart-ideas' }, ...ideas.flatMap((idea, i) =>
    i === except ? [] : [h('li', null, h('button', { class: 'chart-thread', onclick: () => nav.idea(i) }, h('span', null, idea)))]));

/** A projected course's log: the lead's idea for what's next in full, where it heads on from, and the other ideas. */
function ideaView(goal: ChartGoal, ideas: string[], index: number, nav: Nav): HTMLElement {
  const objective = section('Objective', LCARS.peach, h('p', null, goal.note?.done || 'Not agreed yet'));
  const from = goal.waypoints.at(-1);
  return h('div', { class: 'chart-log' },
    objective,
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
  const objective = section('Objective', LCARS.peach, h('p', null, goal.note?.done || 'Not agreed yet'));
  const closed = c.closed;
  return h('div', { class: 'chart-log' },
    objective,
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

/** The picked waypoint's log: when, what it set out to do, any course correction, what it taught us, its pull requests. */
function logView(goal: ChartGoal, w: Waypoint | undefined, nav: Nav, tick?: (slice: number, index: number, checked: boolean) => void, openShown?: () => void): HTMLElement {
  const objective = section('Objective', LCARS.peach, h('p', null, goal.note?.done || 'Not agreed yet'));
  const threads = (label: string, list: Contact[]) =>
    list.length ? section(label, LCARS.sky, threadList(list, nav)) : null;
  const open = threads(`Open contacts · ${goal.contacts.filter((c) => !c.closed).length}`, goal.contacts.filter((c) => !c.closed));
  if (!w) return h('div', { class: 'chart-log' }, objective, open);
  const now = w.slice === goal.current && !w.landedAt;
  const when = w.landedAt
    ? `${stardate(w.startedAt)} → ${stardate(w.landedAt)} · ${span(w.landedAt - w.startedAt)}`
    : now ? `Under way since ${stardate(w.startedAt)} · ${span(Date.now() - w.startedAt)}` : `Started ${stardate(w.startedAt)} · never landed`;
  const checklist = now && goal.note?.slice.length ? goal.note.slice : [];
  const prs = goal.prs.filter((p) => p.slice === w.slice);
  const ideas = goal.note?.next ?? [];
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
    evidenceView(goal, w, openShown),
    shieldsView(w),
    spotChecksView(w, goal.prs, tick),
    threads('Noticed here', goal.contacts.filter((c) => c.slice === w.slice)),
    prs.length ? section('Pull requests', LCARS.periwinkle, h('div', { class: 'row' }, ...prs.map(prLink))) : null,
    ideas.length && w === goal.waypoints.at(-1) && !goal.closedAt ? section(`Projected · ${ideas.length}`, LCARS.periwinkle, ideaList(ideas, nav)) : null,
    open,
  );
}

/**
 * What the slice does, seen rather than read: the screenshots QA last took of each of its pull requests (each opens
 * full size), then what its lead showed and asked on the station's screen while it was under way (which open up close).
 */
function evidenceView(goal: ChartGoal, w: Waypoint, openShown?: () => void): HTMLElement | null {
  const shots = w.evidence ?? [];
  const shown = goal.artifacts.filter((a) => a.slice === w.slice);
  const asked = goal.questions.filter((q) => q.slice === w.slice);
  if (!shots.length && !shown.length && !asked.length) return null;
  const thumb = (src: string | undefined, caption: string, open: () => void) =>
    h('button', { class: 'chart-thumb', title: caption, onclick: open },
      src ? h('img', { src, alt: caption, loading: 'lazy' }) : h('span', { class: 'chart-thumb-none' }, 'No picture'),
      h('small', null, caption));
  return section('Evidence', LCARS.peach, h('div', { class: 'chart-evidence' },
    ...shots.map((e) => {
      const src = `/api/artifacts/${goal.id}/${e.file}`;
      return thumb(src, `${e.repo.split('/')[1]} #${e.pr} · ${e.caption}`, () => window.open(src, '_blank', 'noopener'));
    }),
    ...shown.map((a) => thumb(a.image ? artifactUrl(goal.id, a, 'jpg') : undefined, `Shown: ${a.title}`, () => openShown?.())),
    ...asked.map((q) => {
      const first = q.options.find((o) => o.image);
      return thumb(first ? optionUrl(goal.id, q, first.id, 'jpg') : undefined, `Asked: ${q.question}`, () => openShown?.());
    }),
  ));
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
          pr ? h('a', { href: `${pr.url}/files`, target: '_blank', rel: 'noreferrer', class: 'mono' }, where) : h('span', { class: 'mono' }, where),
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

/**
 * A goal's star chart (stellar cartography): its slices as waypoints on a course towards the objective, with the
 * picked one's log beside it. `goal` is read afresh on every render, so a live goal's chart follows its lead.
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
  const nav: Nav = {
    slice: (slice) => {
      picked.slice = slice;
      delete picked.contact;
      delete picked.idea;
      render();
    },
    contact: (id) => {
      picked.contact = id;
      delete picked.idea;
      render();
    },
    idea: (index) => {
      picked.idea = index;
      delete picked.contact;
      render();
    },
  };
  const render = () => {
    const g = goal();
    if (!g) return;
    const key = JSON.stringify(g);
    const pickKey = `${picked.slice}:${picked.contact ?? ''}:${picked.idea ?? ''}`;
    if (key === drawn && pickKey === drawnPick) return;
    const scrolled = pickKey === drawnPick ? body.querySelector('.chart-log')?.scrollTop ?? 0 : 0;
    drawn = key;
    drawnPick = pickKey;
    const plot = plotCourse({ waypoints: g.waypoints, current: g.current, next: g.note?.next ?? [], contacts: g.contacts, seed: g.id });
    const contact = g.contacts.find((c) => c.id === picked.contact);
    const ideas = g.note?.next ?? [];
    const log = contact
      ? contactView(g, contact, nav)
      : picked.idea !== undefined && ideas[picked.idea] !== undefined
        ? ideaView(g, ideas, picked.idea, nav)
        : logView(g, g.waypoints.find((w) => w.slice === picked.slice), nav, liveId ? (slice, index, checked) => void api.tickSpotCheck(liveId, slice, index, checked).catch((err: Error) => ui.error(err.message)) : undefined, () => shown(ui));
    fill(body, h('div', { class: 'chart-map' }, chartSvg(g, plot, picked, nav), readout(g)), log);
    log.scrollTop = scrolled;
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

