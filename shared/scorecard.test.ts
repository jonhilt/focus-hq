import { describe, expect, it } from 'vitest';
import { changeWords, compared, deltaText, direction, duration, glance, measuredAt } from './scorecard';
import type { Metric, Scorecard } from './types';

const m = (value: number, better: Metric['better'], format: Metric['format'] = 'count', key = 'k'): Metric => ({ section: 'fence', key, label: key, value, better, format });

describe('direction', () => {
  it('reads a drop as a climb when lower is better, and a rise as one when higher is', () => {
    expect(direction(m(3, 'lower'), 5)).toBe('better');
    expect(direction(m(7, 'lower'), 5)).toBe('worse');
    expect(direction(m(7, 'higher'), 5)).toBe('better');
    expect(direction(m(5, 'lower'), 5)).toBe('same');
  });

  it('lets time wobble up to 10% before calling it a change', () => {
    expect(direction(m(10.9, 'lower', 'seconds'), 10)).toBe('same');
    expect(direction(m(11.5, 'lower', 'seconds'), 10)).toBe('worse');
  });

  it('never calls a number with no better side a climb or a slip', () => {
    expect(direction(m(9, 'none'), 5)).toBe('same');
  });
});

describe('deltaText', () => {
  it('marks the change and says by how much', () => {
    expect(deltaText(m(200, 'lower'), 222)).toBe('▲ −22');
    expect(deltaText(m(0, 'higher', 'pass'), 1)).toBe('▼ was yes');
  });

  it('says nothing for a change too small to show', () => {
    expect(deltaText(m(5.42, 'lower', 'ratio'), 5.4)).toBe('');
  });
});

const card = (commit: string, values: Record<string, number>): Scorecard => ({
  v: 1, at: 0, commit, branch: 'main', dirty: false, frictions: [], notes: [],
  metrics: Object.entries(values).map(([key, value]) => ({ ...m(value, 'lower', 'count', key), section: key === 'gate' ? 'gate' : 'fence' })),
});

describe('compared', () => {
  it('lists the latest numbers by section, in order, each with its change and its history', () => {
    const sections = compared([card('a', { asserts: 9, gate: 1 }), card('b', { asserts: 8, gate: 1 }), card('c', { asserts: 6, gate: 1 })]);
    expect(sections.map((s) => s.section)).toEqual(['gate', 'fence']);
    expect(sections[1].rows[0]).toMatchObject({ delta: '▲ −2', trend: 'better', series: [9, 8, 6] });
  });

  it('shows a number new since the card before without a change', () => {
    const [fence] = compared([card('a', {}), card('b', { asserts: 3 })]);
    expect(fence.rows[0]).toMatchObject({ delta: '', trend: 'same', series: [3] });
  });

  it('calls a change too small to show neither better nor worse', () => {
    const tiny = (v: number): Scorecard => ({ ...card('a', {}), metrics: [m(v, 'lower', 'ratio', 'rounds')] });
    expect(compared([tiny(0.14), tiny(0.13)])[0].rows[0]).toMatchObject({ delta: '', trend: 'same' });
  });

  it('has nothing to show with no scorecards', () => {
    expect(compared([])).toEqual([]);
  });
});

describe('measuredAt', () => {
  it('names the branch and short commit, and says when uncommitted changes went in', () => {
    expect(measuredAt(card('f6f4c667abcdef', {}))).toBe('main @ f6f4c667');
    expect(measuredAt({ ...card('f6f4c667abcdef', {}), dirty: true })).toBe('main @ f6f4c667 (uncommitted changes)');
  });
});

describe('changeWords', () => {
  it('says a count got fewer or more, and a time faster or slower', () => {
    expect(changeWords(m(219, 'lower'), 222)).toBe('3 fewer');
    expect(changeWords(m(12, 'higher'), 10)).toBe('2 more');
    expect(changeWords(m(105, 'lower', 'seconds'), 93)).toBe('12.0s slower');
  });

  it('signs a share or a cost, and says what a pass was', () => {
    expect(changeWords(m(0.3, 'higher', 'percent'), 0.29)).toBe('+1%');
    expect(changeWords(m(10.5, 'lower', 'usd'), 11.25)).toBe('−$0.75');
    expect(changeWords(m(0, 'higher', 'pass'), 1)).toBe('was yes');
  });

  it('says nothing for a change too small to show', () => {
    expect(changeWords(m(5, 'lower'), 5)).toBe('');
  });
});

describe('duration', () => {
  it('reads seconds under a minute, and minutes and seconds over', () => {
    expect(duration(56.3)).toBe('56s');
    expect(duration(105.25)).toBe('1m 45s');
    expect(duration(61)).toBe('1m 01s');
  });
});

describe('glance', () => {
  const metric = (section: Metric['section'], key: string, value: number, better: Metric['better'] = 'lower', format: Metric['format'] = 'count'): Metric =>
    ({ section, key, label: key, value, better, format });
  const full = (over: Partial<Record<string, number>> = {}): Scorecard => ({
    v: 1, at: 0, commit: 'c', branch: 'main', dirty: false, frictions: [], notes: [],
    metrics: [
      metric('gate', 'gate.pass', over['gate.pass'] ?? 1, 'higher', 'pass'),
      metric('gate', 'gate.seconds', over['gate.seconds'] ?? 100, 'lower', 'seconds'),
      metric('gate', 'typecheck.errors', over['typecheck.errors'] ?? 0),
      metric('fence', 'fence.typeAssertions', over['fence.typeAssertions'] ?? 200),
      metric('fence', 'fence.nonNull', over['fence.nonNull'] ?? 100),
      metric('office', 'office.merged', over['office.merged'] ?? 10, 'none'),
    ],
  });

  it('has nothing to sum up with no scorecards', () => {
    expect(glance([])).toBeUndefined();
  });

  it('leads each section with its headline number and lists the ones beside it', () => {
    const g = glance([full()]);
    expect(g?.tiles.map((t) => [t.section, t.hero.metric.key])).toEqual([['gate', 'gate.pass'], ['fence', 'fence.typeAssertions'], ['office', 'office.merged']]);
    expect(g?.tiles[1].also.map((r) => r.metric.key)).toEqual(['fence.nonNull']);
    expect(g?.compared).toBe(false);
  });

  it('colours the gate by its time while it passes, since the pass itself rarely changes', () => {
    const g = glance([full(), full({ 'gate.seconds': 130 })]);
    expect(g?.tiles[0]).toMatchObject({ tone: 'worse', trend: { metric: { key: 'gate.seconds' }, change: '30.0s slower' } });
    expect(g?.gate).toEqual({ pass: true, seconds: 130, failing: [] });
  });

  it('marks a failing gate bad, whatever its time did, and names what failed it', () => {
    const g = glance([full(), full({ 'gate.pass': 0, 'gate.seconds': 60, 'typecheck.errors': 3 })]);
    expect(g?.tiles[0].tone).toBe('bad');
    expect(g?.gate).toMatchObject({ pass: false, failing: ['3 typecheck.errors'] });
  });

  it('counts what moved and lists the slips before the climbs', () => {
    const g = glance([full(), full({ 'fence.typeAssertions': 190, 'fence.nonNull': 104, 'office.merged': 30 })]);
    expect(g).toMatchObject({ compared: true, better: 1, worse: 1 });
    expect(g?.moved.map((r) => [r.metric.key, r.change])).toEqual([['fence.nonNull', '4 more'], ['fence.typeAssertions', '10 fewer']]);
  });
});
