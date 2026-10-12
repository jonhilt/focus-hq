import { describe, expect, it } from 'vitest';
import { compared, deltaText, direction, measuredAt } from './scorecard';
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
