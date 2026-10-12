// How a scorecard reads, wherever it's shown: the terminal (`pnpm run scorecard`), the engineering panel and the MSD.
import type { Metric, MetricFormat, Scorecard, ScorecardSection } from './types';

export const SECTIONS: Record<ScorecardSection, string> = {
  gate: 'Gate',
  fence: 'Fence (code outside tests)',
  effect: 'Effect (server)',
  tests: 'Tests',
  office: 'Office (ledger)',
};

const ORDER: ScorecardSection[] = ['gate', 'fence', 'effect', 'tests', 'office'];

export function formatValue(value: number, format: MetricFormat): string {
  switch (format) {
    case 'pass': return value ? 'yes' : 'NO';
    case 'seconds': return `${value.toFixed(1)}s`;
    case 'percent': return `${Math.round(value * 100)}%`;
    case 'usd': return `$${value.toFixed(2)}`;
    case 'ratio': return value.toFixed(1);
    case 'count': return value.toLocaleString('en-US');
  }
}

/** Whether moving from `before` to `after` is a climb, a slip, or neither. Seconds wobble, so time counts only past 10%. */
export function direction(m: Metric, before: number): 'better' | 'worse' | 'same' {
  const delta = m.value - before;
  const noise = m.format === 'seconds' ? Math.abs(before) * 0.1 : 1e-9;
  if (Math.abs(delta) <= noise || m.better === 'none') return 'same';
  return (delta < 0) === (m.better === 'lower') ? 'better' : 'worse';
}

export const MARK = { better: '▲', worse: '▼', same: ' ' } as const;

/** The change since `before`, marked; nothing when it rounds away to nothing as shown. */
export function deltaText(m: Metric, before: number): string {
  const delta = m.value - before;
  if (formatValue(Math.abs(delta), m.format) === formatValue(0, m.format)) return '';
  const shown = m.format === 'pass' ? `was ${formatValue(before, 'pass')}` : `${delta > 0 ? '+' : '−'}${formatValue(Math.abs(delta), m.format)}`;
  return `${MARK[direction(m, before)]} ${shown}`;
}

/** Each of the latest card's numbers with its change since the card before, a section at a time. */
export function compared(history: Scorecard[]): { section: ScorecardSection; title: string; rows: ComparedRow[] }[] {
  const latest = history.at(-1);
  if (!latest) return [];
  const previous = history.at(-2);
  const series = (key: string) => history.flatMap((c) => c.metrics.filter((m) => m.key === key).map((m) => m.value));
  return ORDER.map((section) => ({
    section,
    title: SECTIONS[section],
    rows: latest.metrics.filter((m) => m.section === section).map((metric) => {
      const before = previous?.metrics.find((m) => m.key === metric.key)?.value;
      const delta = before === undefined ? '' : deltaText(metric, before);
      return {
        metric,
        before,
        delta,
        change: before === undefined ? '' : changeWords(metric, before),
        // a change too small to show isn't called a climb or a slip either
        trend: before === undefined || !delta ? 'same' : direction(metric, before),
        series: series(metric.key),
      };
    }),
  })).filter((s) => s.rows.length);
}

/** Which commit a card measured, to say under it: `main @ f6f4c667`, marked when uncommitted changes went in too. */
export const measuredAt = (card: Scorecard) => `${card.branch} @ ${card.commit.slice(0, 8)}${card.dirty ? ' (uncommitted changes)' : ''}`;

export type Trend = 'better' | 'worse' | 'same';

/** One number on the latest card, against the card before. */
export interface ComparedRow {
  metric: Metric;
  /** Its value on the card before, if it was measured then. */
  before: number | undefined;
  /** The change marked, for the terminal: `▲ −22`. */
  delta: string;
  /** The change in words, for the panel: `22 fewer`. */
  change: string;
  trend: Trend;
  /** Its values over the history, oldest first. */
  series: number[];
}

/** A time as people say it: `56s`, `1m 45s`. */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** The change since `before` in words, for a tile or a list: `3 fewer`, `12s slower`, `+1%`, `was yes`; nothing when it rounds away. */
export function changeWords(m: Metric, before: number): string {
  const delta = m.value - before;
  const size = formatValue(Math.abs(delta), m.format);
  if (size === formatValue(0, m.format)) return '';
  if (m.format === 'pass') return `was ${formatValue(before, 'pass')}`;
  if (m.format === 'count') return `${size} ${delta < 0 ? 'fewer' : 'more'}`;
  if (m.format === 'seconds') return `${size} ${delta < 0 ? 'faster' : 'slower'}`;
  return `${delta > 0 ? '+' : '−'}${size}`;
}

/** Each section's tile on the overview: the number it leads with, the one its trend follows, and a few beside it. */
const HEADLINE: Record<ScorecardSection, { hero: string; trend?: string; also: string[] }> = {
  gate: { hero: 'gate.pass', trend: 'gate.seconds', also: ['typecheck.seconds', 'test.seconds', 'lint.seconds', 'build.seconds'] },
  fence: { hero: 'fence.typeAssertions', also: ['fence.nonNull', 'fence.explicitAny', 'fence.lintDisables', 'fence.tsSuppressions'] },
  effect: { hero: 'effect.share', also: ['effect.files', 'effect.runs'] },
  tests: { hero: 'crap.over', also: ['tests.total', 'tests.files'] },
  office: { hero: 'office.firstTime', also: ['office.merged', 'office.costPerMerge'] },
};

/** The numbers that have to be 0 for the gate to pass, to name when it doesn't. */
const MUST_BE_ZERO = ['typecheck.errors', 'lint.errors', 'test.failed'];

export interface Tile {
  section: ScorecardSection;
  title: string;
  /** The number it leads with. */
  hero: ComparedRow;
  /** The row whose trend colours it: the hero's, or for the gate (which rarely changes) its time. */
  trend: ComparedRow;
  /** `bad` overrides the trend: the gate is failing. */
  tone: Trend | 'bad';
  also: ComparedRow[];
}

export interface Glance {
  /** Whether the gate passes, and if not, what failed it (`3 typecheck errors`). */
  gate: { pass: boolean; seconds?: number; failing: string[] } | undefined;
  /** Whether there was a card before this one to compare with. */
  compared: boolean;
  better: number;
  worse: number;
  tiles: Tile[];
  /** Every number that moved since the card before, the slips first, then the climbs. */
  moved: ComparedRow[];
}

/** The scorecard summed up for the overview: the gate's verdict, a tile per section, and what moved. */
export function glance(history: Scorecard[]): Glance | undefined {
  const sections = compared(history);
  if (!sections.length) return undefined;
  const rows = sections.flatMap((s) => s.rows);
  const row = (key: string) => rows.find((r) => r.metric.key === key);
  const pass = row('gate.pass');
  const gate = pass && {
    pass: pass.metric.value === 1,
    seconds: row('gate.seconds')?.metric.value,
    failing: MUST_BE_ZERO.flatMap((k) => {
      const r = row(k);
      return r && r.metric.value > 0 ? [`${r.metric.value} ${r.metric.label.toLowerCase()}`] : [];
    }),
  };
  const tiles = sections.map(({ section, title, rows: own }): Tile => {
    const plan = HEADLINE[section];
    const hero = own.find((r) => r.metric.key === plan.hero) ?? own[0];
    const trend = (plan.trend && own.find((r) => r.metric.key === plan.trend)) || hero;
    const failing = section === 'gate' && gate && !gate.pass;
    const also = plan.also.flatMap((k) => own.filter((r) => r.metric.key === k));
    return { section, title, hero, trend, tone: failing ? 'bad' : trend.trend, also };
  });
  const moved = rows.filter((r) => r.trend !== 'same');
  return {
    gate,
    compared: history.length > 1,
    better: moved.filter((r) => r.trend === 'better').length,
    worse: moved.filter((r) => r.trend === 'worse').length,
    tiles,
    moved: [...moved.filter((r) => r.trend === 'worse'), ...moved.filter((r) => r.trend === 'better')],
  };
}
