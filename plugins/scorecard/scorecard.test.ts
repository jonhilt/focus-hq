import { describe, expect, it } from 'vitest';
import { changeMark, changeWords, compared, deltaText, direction, duration, glance, measuredAt, noiseOf, scorecardHeadOf, tileFace, verdictPhrases, wobble } from './scorecard';
import type { Metric, Scorecard, Scorecards } from './types';

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

describe('noise floor', () => {
  const runs = [card('a', { asserts: 9, secs: 60 }), card('a', { asserts: 9, secs: 66 }), card('a', { asserts: 9, secs: 57 })];

  it('takes each number’s lowest and highest over repeated runs on one commit', () => {
    expect(noiseOf(runs)).toMatchObject({ commit: 'a', runs: 3, spread: { asserts: { min: 9, max: 9 }, secs: { min: 57, max: 66 } } });
  });

  it('won’t call runs on different commits, uncommitted changes or a single run a noise floor', () => {
    expect(noiseOf([...runs, card('b', { asserts: 9, secs: 60 })])).toBeUndefined();
    expect(noiseOf([runs[0], { ...runs[1], dirty: true }])).toBeUndefined();
    expect(noiseOf([runs[0]])).toBeUndefined();
  });

  it('counts a change only past the measured spread, in place of the 10% guess for a time', () => {
    const noise = noiseOf(runs);
    const secs = (v: number) => m(v, 'lower', 'seconds', 'secs');
    expect(wobble(secs(60), 60, noise)).toBe(9);
    // 10% would call this a climb; the runs wobbled by 9s, so 7s is noise
    expect(direction(secs(53), 60)).toBe('better');
    expect(direction(secs(53), 60, noise)).toBe('same');
    expect(direction(secs(50), 60, noise)).toBe('better');
    // a count that never wobbled still counts on a change of one
    expect(direction(m(8, 'lower', 'count', 'asserts'), 9, noise)).toBe('better');
    expect(compared([card('a', { secs: 60 }), card('b', { secs: 53 })], noise)[0].rows[0].trend).toBe('same');
  });
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

describe('scorecardHeadOf', () => {
  const ago = (at: number) => `${at}m ago`;
  const desk = (patch: Partial<Scorecards>): Scorecards => ({ status: 'idle', history: [], ...patch });

  it('says nothing has been measured yet, with nothing to show on the MSD', () => {
    for (const d of [null, desk({})]) {
      const head = scorecardHeadOf(d, ago);
      expect(head).toMatchObject({ measuring: false, latest: null, canShowOnMsd: false, status: { tone: 'muted' } });
      expect(head.status?.text).toMatch(/^Not measured yet/);
    }
  });

  it('names the latest card’s commit and when it was measured', () => {
    expect(scorecardHeadOf(desk({ history: [card('aaaa', {}), { ...card('f6f4c667abcdef', {}), at: 3 }] }), ago)).toEqual({
      measuring: false, latest: 'main @ f6f4c667 · measured 3m ago', canShowOnMsd: true, status: null,
    });
  });

  it('says what a measurement under way is measuring, and since when', () => {
    expect(scorecardHeadOf(desk({ status: 'measuring', trigger: 'new-commit', startedAt: 2 }), ago)).toMatchObject({
      measuring: true, status: { tone: 'muted', text: 'Measuring the new commit the office started on, started 2m ago: about a minute and a half' },
    });
    expect(scorecardHeadOf(desk({ status: 'measuring', trigger: 'captain' }), ago).status?.text).toBe('Running the gate on the office’s own checkout: about a minute and a half');
  });

  it('says why the last measurement failed', () => {
    expect(scorecardHeadOf(desk({ status: 'failed', error: 'pnpm not found', history: [card('aaaa', {})] }), ago).status).toEqual({ tone: 'bad', text: 'pnpm not found' });
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

describe('what the overview says', () => {
  const metric = (section: Metric['section'], key: string, value: number, better: Metric['better'] = 'lower', format: Metric['format'] = 'count', label = key): Metric =>
    ({ section, key, label, value, better, format });
  const card = (over: Partial<Record<string, number>> = {}): Scorecard => ({
    v: 1, at: 0, commit: 'c', branch: 'main', dirty: false, frictions: [], notes: [],
    metrics: [
      metric('gate', 'gate.pass', over['gate.pass'] ?? 1, 'higher', 'pass'),
      metric('gate', 'gate.seconds', over['gate.seconds'] ?? 105, 'lower', 'seconds'),
      metric('gate', 'typecheck.seconds', 56, 'lower', 'seconds'),
      metric('gate', 'test.failed', over['test.failed'] ?? 0, 'lower', 'count', 'Tests failing'),
      metric('fence', 'fence.typeAssertions', over['fence.typeAssertions'] ?? 200),
      metric('fence', 'fence.nonNull', over['fence.nonNull'] ?? 100),
    ],
  });
  const said = (cards: Scorecard[]) => {
    const g = glance(cards);
    return g ? verdictPhrases(g).map((p) => (p.tone ? `[${p.text}]` : p.text)).join('') : '';
  };

  it('opens on the gate, then counts what climbed and slipped, marking the news', () => {
    expect(said([card()])).toBe('The gate is [passing], in 1m 45s. This is the first scorecard: the next will show what moved.');
    expect(said([card(), card()])).toBe('The gate is [passing], in 1m 45s. Nothing moved since the one before.');
    expect(said([card(), card({ 'fence.typeAssertions': 190, 'fence.nonNull': 110 })])).toBe('The gate is [passing], in 1m 45s. Since the one before, [1 number improved] and [1 slipped].');
  });

  it('names what failed the gate', () => {
    expect(said([card({ 'gate.pass': 0, 'test.failed': 2 })])).toMatch(/^The gate is \[failing\]: 2 tests failing\. /);
  });

  it('marks a change by its direction, a time inside its wobble with ≈, and a failing gate with ✕', () => {
    const rows = compared([card(), card({ 'gate.seconds': 100, 'fence.nonNull': 104 })]).flatMap((s) => s.rows);
    const row = (key: string) => rows.find((r) => r.metric.key === key)!;
    expect(changeMark(row('fence.nonNull'))).toMatchObject({ icon: '▼', words: '4 more', tone: 'worse', noise: false });
    expect(changeMark(row('gate.seconds'))).toMatchObject({ icon: '≈', words: '5.0s faster', noise: true });
    expect(changeMark(row('fence.typeAssertions'))).toMatchObject({ icon: '–', words: 'no change' });
    expect(changeMark(row('gate.pass'), 'bad')).toMatchObject({ icon: '✕', words: 'failing' });
  });

  it('shows the gate as PASS and its time, and other tiles as their number and a few words', () => {
    const [gate, fence] = glance([card()])!.tiles;
    expect(tileFace(gate)).toEqual({ value: 'PASS', caption: 'in 1m 45s', also: 'typecheck 56s' });
    expect(tileFace(fence)).toEqual({ value: '200', caption: 'type assertions', also: '100 non-null' });
  });
});
