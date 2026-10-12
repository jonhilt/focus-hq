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
    case 'count': return String(value);
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
export function compared(history: Scorecard[]): { section: ScorecardSection; title: string; rows: { metric: Metric; delta: string; trend: 'better' | 'worse' | 'same'; series: number[] }[] }[] {
  const latest = history.at(-1);
  if (!latest) return [];
  const previous = history.at(-2);
  const series = (key: string) => history.flatMap((c) => c.metrics.filter((m) => m.key === key).map((m) => m.value));
  return ORDER.map((section) => ({
    section,
    title: SECTIONS[section],
    rows: latest.metrics.filter((m) => m.section === section).map((metric) => {
      const before = previous?.metrics.find((m) => m.key === metric.key)?.value;
      return {
        metric,
        delta: before === undefined ? '' : deltaText(metric, before),
        trend: before === undefined ? 'same' : direction(metric, before),
        series: series(metric.key),
      };
    }),
  })).filter((s) => s.rows.length);
}

/** Which commit a card measured, to say under it: `main @ f6f4c667`, marked when uncommitted changes went in too. */
export const measuredAt = (card: Scorecard) => `${card.branch} @ ${card.commit.slice(0, 8)}${card.dirty ? ' (uncommitted changes)' : ''}`;
