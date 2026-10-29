import { describe, expect, it } from 'vitest';
import type { Contact, Waypoint } from '../../../shared/types';
import { type Box, CHART, chartSize, cheapest, clearOf, clip, type CoursePlot, distanceTo, everySlice, hitCounter, hitsAmong, labelBox, misread, overlaps, plotCourse, probeFlights, probesOut, seeded, shieldState, smoothPath, STEP, TRANSMIT_MS } from './course';

const wp = (slice: number, more: Partial<Waypoint> = {}): Waypoint => ({ slice, startedAt: slice * 10, landedAt: slice * 10 + 5, title: `Slice ${slice}`, ...more });
const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= CHART.width && p.y >= 0 && p.y <= CHART.height;
/** Where every label the plot shows lies. */
const labelsOf = (plot: CoursePlot): Box[] => [
  ...plot.points.flatMap((p) => (p.label ? [labelBox(p.label, p.lines, plot.sizes.waypoint)] : [])),
  ...plot.scrubbed.flatMap((x) => (x.label ? [labelBox(x.label, `SCRUBBED ${x.text}`, plot.sizes.scrubbed)] : [])),
  ...plot.projected.flatMap((p) => (p.label ? [labelBox(p.label, p.text, plot.sizes.idea)] : [])),
  ...plot.contacts.flatMap((c) => (c.label ? [labelBox(c.label, c.text, plot.sizes.contact)] : [])),
];
/** Every mark on the plot, and the objective, as boxes a label mustn't cover. */
const marksOf = (plot: CoursePlot): Box[] => {
  const sq = (p: { x: number; y: number }, r: number) => ({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });
  const o = plot.objective;
  return [...plot.points.map((p) => sq(p, 12)), ...plot.contacts.map((c) => sq(c, 7)), ...plot.projected.map((p) => sq(p.to, 5)), sq(plot.launch, 6), { x0: o.x - o.r * 0.68, y0: o.y - o.r * 0.68, x1: o.x + o.r * 0.68, y1: o.y + o.r * 0.68 }];
};

describe('the course', () => {
  it('heads from the launch point towards the objective without reaching it', () => {
    const plot = plotCourse({ waypoints: [wp(1), wp(2), wp(3), { slice: 4, startedAt: 40 }], current: 4, next: [], seed: 'lead_p_1' });
    const along = (p: { x: number; y: number }) => (p.x - plot.launch.x) * (plot.objective.x - plot.launch.x) + (p.y - plot.launch.y) * (plot.objective.y - plot.launch.y);
    expect(plot.points.map((p) => along(p))).toEqual([...plot.points.map((p) => along(p))].sort((a, b) => a - b));
    expect(plot.points.every(inside)).toBe(true);
    const last = plot.points.at(-1)!;
    expect(Math.hypot(plot.objective.x - last.x, plot.objective.y - last.y)).toBeGreaterThan(plot.objective.r);
    expect(plot.points.map((p) => p.state)).toEqual(['landed', 'landed', 'landed', 'now']);
    expect(plot.path.startsWith(`M${plot.launch.x} ${plot.launch.y}`)).toBe(true);
  });

  it('names the slice under way by its heading until it ships, and says so when it has none', () => {
    const plot = (now: Waypoint) => plotCourse({ waypoints: [wp(1), now], current: 2, next: [], seed: 's' }).points[1];
    expect(plot({ slice: 2, startedAt: 20 })).toMatchObject({ name: 'Slice 2 · under way', named: 'unset' });
    // what the lead's at names it before it's shipped or headed: the task under way, else the last commit
    expect(plot({ slice: 2, startedAt: 20, lastCommit: 'Count commits' })).toMatchObject({ name: 'Count commits', named: 'work' });
    const tasks = [{ id: '1', subject: 'Probe the SDK', status: 'completed' as const }, { id: '2', subject: 'Draw the arc', status: 'in_progress' as const }];
    expect(plot({ slice: 2, startedAt: 20, lastCommit: 'Count commits', tasks })).toMatchObject({ name: 'Draw the arc', named: 'work' });
    expect(plot({ slice: 2, startedAt: 20, heading: 'Live progress' })).toMatchObject({ name: 'Live progress', named: 'heading' });
    expect(plot({ slice: 2, startedAt: 20, heading: 'Live progress', title: 'Shipped title' })).toMatchObject({ name: 'Shipped title', named: 'shipped' });
    // a slice of a closed goal that never named itself is just its number
    expect(plotCourse({ waypoints: [wp(1), { slice: 2, startedAt: 20 }], next: [], seed: 's' }).points[1].name).toBe('Slice 2');
  });

  it('keeps a long voyage on the chart', () => {
    const plot = plotCourse({ waypoints: Array.from({ length: 30 }, (_, i) => wp(i + 1)), next: ['a', 'b', 'c'], seed: 'x' });
    expect(plot.points.every(inside)).toBe(true);
    expect(plot.projected.every((p) => inside(p.to))).toBe(true);
  });

  it('draws the same course for the same goal every time', () => {
    const voyage = { waypoints: [wp(1), wp(2)], next: ['Header'], seed: 'lead_p_7' };
    expect(plotCourse(voyage)).toEqual(plotCourse(voyage));
  });

  it('drifts off course on a slice that turned out wrong, and swings back towards the objective after it', () => {
    const plot = plotCourse({ waypoints: [wp(1), wp(2, { turnedFrom: 'Web push on every phone' }), wp(3), wp(4)], next: [], seed: 's' });
    expect(plot.scrubbed).toHaveLength(1);
    const [turn] = plot.scrubbed;
    expect(turn.from).toEqual({ x: plot.points[1].x, y: plot.points[1].y });
    expect(turn.text).toBe('Web push on every phone');
    // the scrubbed heading leads further from the objective than the course taken after the turn
    const angle = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const a = Math.atan2(to.y - from.y, to.x - from.x) - Math.atan2(plot.objective.y - from.y, plot.objective.x - from.x);
      return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    };
    expect(angle(turn.from, turn.to)).toBeGreaterThan(angle(turn.from, plot.points[2]));
    // and the turn's label stays out of the scrubbed heading's way, on the other side
    expect(plot.points[1].label?.anchor).not.toBe(turn.label?.anchor);
  });

  it('fans the lead’s next ideas out ahead of the last waypoint', () => {
    const plot = plotCourse({ waypoints: [wp(1)], current: 1, next: ['Show it in the header', 'Tidy the store', 'Offline'], seed: 's' });
    expect(plot.projected.map((p) => p.text)).toEqual(['Show it in the header', 'Tidy the store', 'Offline']);
    expect(plotCourse({ waypoints: [], next: ['First step'], seed: 's' }).projected).toHaveLength(1);
  });

  it('labels each waypoint on the side it drifted to, or alternately while the course runs straight', () => {
    const plot = plotCourse({ waypoints: Array.from({ length: 6 }, (_, i) => wp(i + 1)), next: [], seed: 'labels' });
    for (const p of plot.points) {
      const label = p.label!;
      const off = (p.x - plot.launch.x) * (plot.launch.y - plot.objective.y) - (p.y - plot.launch.y) * (plot.launch.x - plot.objective.x);
      const labelOff = (label.x - p.x) * (plot.launch.y - plot.objective.y) - (label.y - 5 - p.y) * (plot.launch.x - plot.objective.x);
      // a waypoint well off the line (30 px) has its label out on the same side
      if (Math.abs(off) / Math.hypot(plot.objective.x - plot.launch.x, plot.objective.y - plot.launch.y) > 30) expect(Math.sign(labelOff)).toBe(Math.sign(off));
    }
  });

  it('never lets a label cover another, a mark or the objective, or run off the chart, however the voyage went', () => {
    const words = 'Header badge store tidy offline push phones merge review chart waypoint shields evidence contacts briefing room'.split(' ');
    for (let v = 0; v < 120; v++) {
      const rand = seeded(`voyage ${v}`);
      const pick = () => words[Math.floor(rand() * words.length)];
      const title = () => Array.from({ length: 2 + Math.floor(rand() * 6) }, pick).join(' ');
      const n = 1 + (v % 12);
      const waypoints = Array.from({ length: n }, (_, i) => wp(i + 1, { title: title(), ...(rand() < 0.15 && { turnedFrom: title() }) }));
      const contacts = Array.from({ length: Math.floor(rand() * 9) }, (_, i) => ({ id: `c${i + 1}`, text: title(), slice: 1 + Math.floor(rand() * n), at: 0 }));
      const next = Array.from({ length: Math.floor(rand() * 4) }, title);
      for (const scale of [1, 1.5]) {
        const plot = plotCourse({ waypoints, current: n, next, contacts, seed: `lead_${v}` }, scale);
        const labels = labelsOf(plot);
        const marks = marksOf(plot);
        // gathered and checked once a voyage: an expect (and its message) per pair is most of this test's time
        const offChart = labels.filter((a) => !(inside({ x: a.x0, y: a.y0 }) && inside({ x: a.x1, y: a.y1 })));
        const clashes = labels.flatMap((a, i) => [...labels.slice(i + 1), ...marks].filter((b) => overlaps(a, b)).map((b) => [a, b]));
        expect(offChart, `voyage ${v} at ${scale}: labels run off the chart`).toEqual([]);
        expect(clashes, `voyage ${v} at ${scale}: labels cover something`).toEqual([]);
        // whatever else goes without, the waypoint under way is always named
        expect(plot.points.at(-1)!.label).toBeDefined();
      }
    }
  });

  it('names every waypoint and idea, clear of every line, on a voyage like this one', () => {
    const titles = ['Star chart and waypoints', 'Contacts: loose threads kept on a goal\'s star chart', 'Shields and spot-checks on a goal\'s star chart', 'Round briefing room with three screens across its front', 'Draw the goal\'s course on the briefing room\'s star chart', 'Evidence per waypoint on a goal\'s star chart'];
    const waypoints = [...titles.map((title, i) => wp(i + 1, { title })), { slice: 7, startedAt: 70 }];
    const next = ['Fix the demo\'s re-test after a QA fix (contact c1)', 'Steady the flaky reopen test in manager.test.ts'];
    for (const scale of [1, 1.5]) {
      const plot = plotCourse({ waypoints, current: 7, next, seed: 'lead_proj_bd529cc4d2_f35fa4' }, scale);
      expect(plot.points.every((p) => p.label) && plot.projected.every((p) => p.label)).toBe(true);
      const last = plot.points.at(-1)!;
      const dots = [...plot.projected.map((p) => [last, p.to] as const), ...[plot.launch, ...plot.points].slice(1).map((p, i) => [[plot.launch, ...plot.points][i], p] as const)]
        .flatMap(([a, b]) => Array.from({ length: 21 }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / 20, y: a.y + ((b.y - a.y) * k) / 20 })));
      for (const box of labelsOf(plot)) expect(dots.some((d) => d.x > box.x0 && d.x < box.x1 && d.y > box.y0 && d.y < box.y1), `${scale}: ${JSON.stringify(box)}`).toBe(false);
    }
  });

  it('counts the boxes a box runs into the same from its columns as one by one, however wide they are or wherever they lie', () => {
    const rand = seeded('boxes');
    const box = (w: number, h: number): Box => {
      const x0 = rand() * 900 - 100;
      const y0 = rand() * 600 - 100;
      return { x0, y0, x1: x0 + w, y1: y0 + h };
    };
    // little squares like the lines', with a few long ones among them, which reach into columns left of their own
    const boxes = Array.from({ length: 300 }, (_, i) => (i % 25 ? box(6, 6) : box(rand() * 200, rand() * 40)));
    const hits = hitCounter(boxes);
    const spots = Array.from({ length: 2000 }, () => box(rand() * 160, rand() * 30));
    const mismatches = spots.filter((b) => hits(b) !== hitsAmong(boxes, b));
    expect(mismatches).toEqual([]);
    expect(spots.some((b) => hitsAmong(boxes, b) > 1)).toBe(true);
  });

  it('picks the same try as weighing every one, first among equals, while weighing fewer', () => {
    const rand = seeded('tries');
    // how often each part of a try's cost was weighed, against how many tries there were
    const weighed = { first: 0, then: 0, listed: 0 };
    for (let round = 0; round < 500; round++) {
      // whole costs, so ties are common; floors that climb down the list, sometimes by nothing
      let floor = 0;
      const tries = Array.from({ length: 1 + Math.floor(rand() * 40) }, () => ({ floor: (floor += rand() < 0.5 ? 0 : Math.floor(rand() * 3)), first: Math.floor(rand() * 4), then: Math.floor(rand() * 4) }));
      const all = tries.map((t) => t.first + t.then + t.floor);
      const want = all.indexOf(Math.min(...all));
      const got = cheapest(tries, (t) => t.floor, (t) => (weighed.first++, t.first), (t) => (weighed.then++, t.then));
      expect(got && { at: tries.indexOf(got.at), cost: got.cost }, `round ${round}`).toEqual({ at: want, cost: all[want] });
      weighed.listed += tries.length;
    }
    // it stops before the end of the list, and skips the second part of most of the tries it does weigh
    expect(weighed.first).toBeLessThan(weighed.listed / 2);
    expect(weighed.then).toBeLessThan(weighed.first * 0.8);
  });

  it('shrinks waypoints to their numbers once a voyage runs out of room, never naming one by another', () => {
    const plot = plotCourse({ waypoints: Array.from({ length: 30 }, (_, i) => wp(i + 1, { title: `A long slice title, number ${i + 1}` })), next: [], seed: 'long' });
    const named = plot.points.filter((p) => p.label);
    expect(plot.points.at(-1)!.label).toBeDefined();
    expect(named.length).toBeLessThan(30);
    // the newest go first, but a name that would sit nearer another waypoint than its own is left off however new it is
    for (const p of named) expect(misread(labelBox(p.label!, p.lines, plot.sizes.waypoint), p, plot.points.filter((q) => q !== p))).toBe(false);
    // on the chart panel, which grows to fit, every one of them is named
    expect(plotCourse({ waypoints: Array.from({ length: 30 }, (_, i) => wp(i + 1, { title: `A long slice title, number ${i + 1}` })), next: [], seed: 'long' }, 1, true).points.every((p) => p.label)).toBe(true);
  });

  it('keeps labels clear of the objective', () => {
    const objective = { x: 700, y: 120, r: 80 };
    expect(clearOf(objective, { x: 300, y: 400 }, 100, 900)).toEqual({ x: 312, y: 405, anchor: 'start' });
    expect(clearOf(objective, { x: 560, y: 130 }, 100, 900)).toEqual({ x: 548, y: 135, anchor: 'end' });
    expect(clearOf(objective, { x: 880, y: 300 }, 100, 900).anchor).toBe('end');
  });
});

describe('contacts on the chart', () => {
  const contact = (id: string, slice: number, closed?: Contact['closed']) => ({ id, text: `Thread ${id}`, slice, at: 0, ...(closed && { closed }) });

  it('puts each by the waypoint that noticed it, clear of the chart’s edges and of each other', () => {
    const contacts = [contact('c1', 1), contact('c2', 2), contact('c3', 2), contact('c4', 2), contact('c5', 3)];
    const plot = plotCourse({ waypoints: [wp(1), wp(2), wp(3)], next: ['Header'], contacts, seed: 'lead_p_1' });
    expect(plot.contacts).toHaveLength(5);
    expect(plot.contacts.every(inside)).toBe(true);
    for (const c of plot.contacts) {
      const by = plot.points.find((p) => p.waypoint.slice === c.contact.slice)!;
      expect(Math.hypot(c.x - by.x, c.y - by.y)).toBeLessThan(200);
    }
    const spots = plot.contacts.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`);
    expect(new Set(spots).size).toBe(spots.length);
  });

  it('marks how each stands, and links a pursued one to the waypoint it went into', () => {
    const plot = plotCourse({
      waypoints: [wp(1), wp(2), wp(3)],
      next: [],
      contacts: [contact('c1', 1, { as: 'pursued', slice: 3, at: 1 }), contact('c2', 1, { as: 'dropped', why: 'Not needed', slice: 2, at: 1 }), contact('c3', 2)],
      seed: 's',
    });
    expect(plot.contacts.map((c) => c.state)).toEqual(['pursued', 'dropped', 'open']);
    expect(plot.contacts[0].pursuedAt).toEqual({ x: plot.points[2].x, y: plot.points[2].y });
    expect(plot.contacts[1].pursuedAt).toBeUndefined();
  });

  it('sends a spun-off one on out, away from the waypoint that noticed it, towards a goal of its own', () => {
    const plot = plotCourse({ waypoints: [wp(1), wp(2)], next: [], contacts: [contact('c1', 1, { as: 'spun off', goal: 'lead-x', title: 'Auth', slice: 2, at: 1 })], seed: 's' });
    const [c] = plot.contacts;
    expect(c.state).toBe('spun off');
    expect(c.pursuedAt).toBeUndefined();
    const by = plot.points[0];
    const out = c.departsTo ?? { x: c.x, y: c.y };
    // further from its waypoint than the blip, on the same line
    expect(Math.hypot(out.x - by.x, out.y - by.y)).toBeCloseTo(Math.hypot(c.x - by.x, c.y - by.y) + 48, 5);
  });

  it('puts one noticed in a slice that isn’t on the chart by the last waypoint', () => {
    const plot = plotCourse({ waypoints: [wp(1)], next: [], contacts: [contact('c1', 9)], seed: 's' });
    expect(Math.hypot(plot.contacts[0].x - plot.points[0].x, plot.contacts[0].y - plot.points[0].y)).toBeLessThan(200);
  });
});

describe('chart helpers', () => {
  it('fills a gap for every slice without a waypoint', () => {
    expect(everySlice(undefined, 2, 7)).toEqual([{ slice: 1, startedAt: 7 }, { slice: 2, startedAt: 7 }]);
    expect(everySlice([wp(2)], 3, 7).map((w) => w.slice)).toEqual([1, 2, 3]);
    expect(everySlice([wp(1), wp(2)], 2, 7)).toEqual([wp(1), wp(2)]);
  });

  it('clips at a word', () => {
    expect(clip('Show it in the header', 100)).toBe('Show it in the header');
    expect(clip('Show it in the header', 12)).toBe('Show it in…');
    // never mid-word, unless the first word alone won't fit
    expect(clip('Crew voices run on the GPU', 9)).toBe('Crew…');
    expect(clip('Extraordinarily long', 9)).toBe('Extraord…');
  });

  it('repeats its random numbers for a seed', () => {
    const a = seeded('goal');
    const b = seeded('goal');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seeded('other')()).not.toBe(seeded('goal')());
  });

  it('smooths a path through every point', () => {
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe('M0 0 C1.7 0 8.3 0 10 0');
    expect(smoothPath([])).toBe('');
  });
});

describe('shields', () => {
  const shield = (verdict: 'pass' | 'fail', failedRounds = 0, ci?: 'passing' | 'failing') => ({ repo: 'acme/web', pr: 9, verdict, checks: { pass: 1, fail: 0, skip: 0 }, failedRounds, ...(ci && { ci }), at: 0 });
  it('holds when everything passed first time, absorbs a hit once a fail is fixed, and is down while anything fails', () => {
    expect(shieldState(undefined)).toBe('none');
    expect(shieldState([shield('pass'), shield('pass', 0, 'passing')])).toBe('held');
    expect(shieldState([shield('pass', 1), shield('pass')])).toBe('absorbed');
    expect(shieldState([shield('pass', 1), shield('fail', 1)])).toBe('down');
    expect(shieldState([shield('pass', 0, 'failing')])).toBe('down');
  });
});

describe('probes on the chart', () => {
  const probe = (id: string, launchedAt: number, more = {}) => ({ id, description: `Probe ${id}`, launchedAt, ...more });
  const waypoints = [wp(1), { slice: 2, startedAt: 20, probes: [probe('a', 1000), probe('b', 1000, { endedAt: 61_000, ok: true }), probe('c', 1000)] }];
  const plot = plotCourse({ waypoints, current: 2, next: [], seed: 's' });
  const from = plot.points[1];

  it('flies one that’s out away from its waypoint, further the longer it’s been out, and stays on the chart', () => {
    const [early] = probeFlights(plot, waypoints, new Set(['a']), 2000);
    const [late] = probeFlights(plot, waypoints, new Set(['a']), 600_000);
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - from.x, p.y - from.y);
    expect(early.phase).toBe('out');
    expect(early.from).toEqual({ x: from.x, y: from.y });
    expect(dist(late)).toBeGreaterThan(dist(early));
    expect(inside(late)).toBe(true);
    // the same probe flies the same way every time the chart's drawn
    expect(probeFlights(plot, waypoints, new Set(['a']), 2000)[0]).toEqual(early);
  });

  it('transmits one that has reported for a while, from where it got to, then it’s gone', () => {
    const at = (now: number) => probeFlights(plot, waypoints, new Set(), now).filter((f) => f.probe.id === 'b');
    const [sending] = at(61_000 + TRANSMIT_MS / 2);
    expect(sending.phase).toBe('transmitting');
    expect(sending.sent).toBeCloseTo(0.5);
    expect(at(61_000 + TRANSMIT_MS * 2)).toEqual([]);
    // it doesn't drift on while it transmits
    expect(at(62_000)[0].x).toBe(sending.x);
  });

  it('parts company with another launched from the same waypoint', () => {
    const [a, c] = probeFlights(plot, waypoints, new Set(['a', 'c']), 30_000);
    expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThan(60);
    // and their labels don't run into each other
    expect(Math.abs(a.label.y - c.label.y)).toBeGreaterThan(plot.sizes.contact * 2);
  });

  it('counts a lead’s working helpers as out, and its unfinished scripts while it’s at work', () => {
    const helpers = [{ id: 'h1', description: '', status: 'working' as const, activity: '', startedAt: 0 }, { id: 'h2', description: '', status: 'done' as const, activity: '', startedAt: 0 }];
    const lead = { slice: 1, prs: [], repos: [], title: '', waypoints: [{ slice: 1, startedAt: 0, probes: [probe('s1', 0, { type: 'script' }), probe('s2', 0, { type: 'script', endedAt: 5 }), probe('h1', 0)] }] };
    expect([...probesOut({ status: 'working', helpers, lead })].sort()).toEqual(['h1', 's1']);
    expect([...probesOut({ status: 'done', helpers, lead })]).toEqual(['h1']);
    expect([...probesOut(undefined)]).toEqual([]);
  });

  it('draws none that never reported once its helper has gone', () => {
    expect(probeFlights(plot, waypoints, new Set(['a']), 200_000).map((f) => f.probe.id)).toEqual(['a']);
  });
});

describe('a chart that grows', () => {
  const steps = (plot: CoursePlot) => plot.points.slice(1).map((p, i) => Math.hypot(p.x - plot.points[i].x, p.y - plot.points[i].y));

  it('stays the chart’s size for a short voyage, and on the wall however long it is', () => {
    expect(chartSize(4, true)).toEqual({ width: CHART.width, height: CHART.height });
    expect(chartSize(30, false)).toEqual({ width: CHART.width, height: CHART.height });
  });

  it('grows, the same shape, to keep a long voyage’s waypoints apart rather than squeezing them', () => {
    const waypoints = Array.from({ length: 30 }, (_, i) => wp(i + 1));
    const size = chartSize(30, true);
    expect(size.width).toBeGreaterThan(CHART.width * 2);
    expect(size.width / size.height).toBeCloseTo(CHART.width / CHART.height);
    const grown = plotCourse({ waypoints, next: [], seed: 'long' }, 1, true);
    expect({ width: grown.width, height: grown.height }).toEqual(size);
    // along the course, a waypoint's at least most of a step on from the last, however it drifts
    const along = (plot: CoursePlot) => {
      const d = { x: plot.objective.x - plot.launch.x, y: plot.objective.y - plot.launch.y };
      const len = Math.hypot(d.x, d.y);
      return plot.points.map((p) => ((p.x - plot.launch.x) * d.x + (p.y - plot.launch.y) * d.y) / len);
    };
    const gaps = along(grown).slice(1).map((a, i) => a - along(grown)[i]);
    expect(Math.min(...gaps)).toBeGreaterThan(STEP * 0.95);
    expect(Math.min(...steps(grown))).toBeGreaterThan(Math.min(...steps(plotCourse({ waypoints, next: [], seed: 'long' }))) * 2);
    // and every one of them is named
    expect(grown.points.every((p) => p.label)).toBe(true);
  });
});

describe('whose name is whose', () => {
  it('measures how far a point is from a box', () => {
    const b = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(distanceTo(b, { x: 5, y: 5 })).toBe(0);
    expect(distanceTo(b, { x: 13, y: 14 })).toBe(5);
  });

  it('puts every waypoint’s name nearer its own waypoint than any other, however the voyage went', () => {
    const words = 'Header badge store tidy offline push phones merge review chart waypoint shields evidence contacts briefing room'.split(' ');
    const misnamed: string[] = [];
    for (let v = 0; v < 60; v++) {
      const rand = seeded(`owners ${v}`);
      const title = () => Array.from({ length: 2 + Math.floor(rand() * 6) }, () => words[Math.floor(rand() * words.length)]).join(' ');
      const n = 2 + (v % 10);
      const waypoints = Array.from({ length: n }, (_, i) => wp(i + 1, { title: title() }));
      for (const [scale, grow] of [[1, false], [1.5, false], [0.5, true]] as const) {
        const plot = plotCourse({ waypoints, current: n, next: [], seed: `lead_${v}` }, scale, grow);
        for (const p of plot.points) {
          if (p.label && misread(labelBox(p.label, p.lines, plot.sizes.waypoint), p, plot.points.filter((q) => q !== p))) misnamed.push(`voyage ${v} at ${scale}: waypoint ${p.waypoint.slice}`);
        }
      }
    }
    expect(misnamed).toEqual([]);
  });
});

describe('marks zoomed out', () => {
  it('keeps every label clear of marks drawn bigger, so they stay big enough to see', () => {
    const waypoints = Array.from({ length: 14 }, (_, i) => wp(i + 1, { title: `Slice ${i + 1} of a voyage that runs on` }));
    const contacts = [{ id: 'c1', text: 'A loose thread', slice: 3, at: 0 }, { id: 'c2', text: 'Another one', slice: 9, at: 0 }];
    for (const zoom of [0.8, 0.5, 0.35]) {
      const plot = plotCourse({ waypoints, current: 14, next: ['What next'], contacts, seed: 'zoomed out' }, 1 / zoom, true, 1 / zoom);
      expect(plot.marks).toBeCloseTo(1 / zoom);
      const sq = (p: { x: number; y: number }, r: number) => ({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });
      const marks = [...plot.points.map((p) => sq(p, 12 * plot.marks)), ...plot.contacts.map((c) => sq(c, 7 * plot.marks)), ...plot.projected.map((p) => sq(p.to, 5 * plot.marks)), sq(plot.launch, 6 * plot.marks)];
      const clashes = labelsOf(plot).flatMap((l) => marks.filter((m) => overlaps(l, m)));
      expect(clashes, `at ${zoom}`).toEqual([]);
    }
  });
});
