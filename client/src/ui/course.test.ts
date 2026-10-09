import { describe, expect, it } from 'vitest';
import type { Contact, Waypoint } from '../../../shared/types';
import { CHART, clearOf, clip, everySlice, plotCourse, seeded, smoothPath } from './course';

const wp = (slice: number, more: Partial<Waypoint> = {}): Waypoint => ({ slice, startedAt: slice * 10, landedAt: slice * 10 + 5, title: `Slice ${slice}`, ...more });
const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= CHART.width && p.y >= 0 && p.y <= CHART.height;

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
    expect(plot.points[1].label.anchor).not.toBe(turn.label.anchor);
  });

  it('fans the lead’s next ideas out ahead of the last waypoint', () => {
    const plot = plotCourse({ waypoints: [wp(1)], current: 1, next: ['Show it in the header', 'Tidy the store', 'Offline'], seed: 's' });
    expect(plot.projected.map((p) => p.text)).toEqual(['Show it in the header', 'Tidy the store', 'Offline']);
    expect(plotCourse({ waypoints: [], next: ['First step'], seed: 's' }).projected).toHaveLength(1);
  });

  it('labels each waypoint on the side it drifted to, or alternately while the course runs straight', () => {
    const plot = plotCourse({ waypoints: Array.from({ length: 6 }, (_, i) => wp(i + 1)), next: [], seed: 'labels' });
    for (const p of plot.points) {
      const off = (p.x - plot.launch.x) * (plot.launch.y - plot.objective.y) - (p.y - plot.launch.y) * (plot.launch.x - plot.objective.x);
      const labelOff = (p.label.x - p.x) * (plot.launch.y - plot.objective.y) - (p.label.y - 5 - p.y) * (plot.launch.x - plot.objective.x);
      // a waypoint well off the line (30 px) has its label out on the same side
      if (Math.abs(off) / Math.hypot(plot.objective.x - plot.launch.x, plot.objective.y - plot.launch.y) > 30) expect(Math.sign(labelOff)).toBe(Math.sign(off));
    }
  });

  it('moves a label that would land on another to the other side of its waypoint', () => {
    const plot = plotCourse({ waypoints: [wp(1), wp(2, { title: 'Web push', turnedFrom: 'Push on every phone' }), wp(3, { title: 'PR list + merge' }), wp(4), wp(5)], next: [], seed: 'lead_fake_tricorder' });
    const boxes = plot.points.map((p) => {
      const w = p.name.length * 17 * 0.47;
      const x0 = p.label.anchor === 'start' ? p.label.x : p.label.x - w;
      return { x0, x1: x0 + w, y0: p.label.y - 17, y1: p.label.y + 3 };
    });
    for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
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
