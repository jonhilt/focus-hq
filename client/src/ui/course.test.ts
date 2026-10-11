import { describe, expect, it } from 'vitest';
import type { Contact, Waypoint } from '../../../shared/types';
import { type Box, CHART, clearOf, clip, type CoursePlot, everySlice, labelBox, overlaps, plotCourse, seeded, shieldState, smoothPath } from './course';

const wp = (slice: number, more: Partial<Waypoint> = {}): Waypoint => ({ slice, startedAt: slice * 10, landedAt: slice * 10 + 5, title: `Slice ${slice}`, ...more });
const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= CHART.width && p.y >= 0 && p.y <= CHART.height;
/** Where every label the plot shows lies. */
const labelsOf = (plot: CoursePlot): Box[] => [
  ...plot.points.flatMap((p) => (p.label ? [labelBox(p.label, p.name, plot.sizes.waypoint)] : [])),
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
        for (const [i, a] of labels.entries()) {
          expect(inside({ x: a.x0, y: a.y0 }) && inside({ x: a.x1, y: a.y1 }), `voyage ${v} at ${scale}: a label runs off the chart`).toBe(true);
          for (const b of [...labels.slice(i + 1), ...marksOf(plot)]) expect(overlaps(a, b), `voyage ${v} at ${scale}: ${JSON.stringify([a, b])}`).toBe(false);
        }
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

  it('shrinks the oldest waypoints to their numbers once a voyage runs out of room', () => {
    const plot = plotCourse({ waypoints: Array.from({ length: 30 }, (_, i) => wp(i + 1, { title: `A long slice title, number ${i + 1}` })), next: [], seed: 'long' });
    const named = plot.points.map((p) => !!p.label);
    expect(named.at(-1)).toBe(true);
    expect(named.filter(Boolean).length).toBeLessThan(30);
    expect(named.slice(-5).filter(Boolean).length).toBeGreaterThanOrEqual(named.slice(0, 5).filter(Boolean).length);
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
