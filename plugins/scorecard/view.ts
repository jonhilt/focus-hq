import { changeMark, type ComparedRow, compared, duration, formatValue, glance, measuredAt, type Tile, tileFace, type Trend, verdictPhrases } from './scorecard';
import { aboutMetric, SECTION_ABOUT } from './about';
import { api } from '../../client/src/net/api';
import { state } from '../../client/src/net/state';
import type { Ui } from '../../client/src/ui/context';
import { busy, h, timeAgo } from '../../client/src/ui/dom';
import { type Metric, type Scorecard, SCORECARD, type Scorecards, type ScorecardSection } from './types';

const SVG = 'http://www.w3.org/2000/svg';

/** Main engineering's scorecards, as the plugin's server part sends them (its state). */
export const scorecards = (): Scorecards | null => (state.plugins[SCORECARD] as Scorecards | undefined) ?? null;

/** Each section's colour, from LCARS's data tones: green and red stay for better and worse. */
export const SECTION_TONE: Record<ScorecardSection, string> = {
  gate: 'var(--lcars-gold)',
  fence: 'var(--lcars-sky)',
  effect: 'var(--lcars-periwinkle)',
  tests: 'var(--lcars-lilac)',
  office: 'var(--lcars-orange)',
};

/** Where the panel goes when a tile or a moved number is picked: the section's view, scrolled to it, the number opened. */
export type Go = (section: ScorecardSection, key?: string) => void;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * A number's measurements as a line, oldest at the left, the latest a dot in its trend's colour: nothing with fewer
 * than two. `points` names each one (`3 h ago: 224`) for its hover, in the bigger chart a number opens to.
 */
function sparkline(series: number[], tone: Trend | 'bad', size: { w: number; h: number }, points?: string[]): SVGElement | null {
  if (series.length < 2) return null;
  const { w, h: hgt } = size;
  const pad = 4;
  const lo = Math.min(...series);
  const span = Math.max(...series) - lo || 1;
  const xy = series.map((v, i) => [pad + (i / (series.length - 1)) * (w - 2 * pad), hgt - pad - ((v - lo) / span) * (hgt - 2 * pad)]);
  const el = svg('svg', { class: `spark ${tone}`, viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt });
  el.append(svg('polyline', { points: xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') }));
  xy.forEach(([x, y], i) => {
    const last = i === xy.length - 1;
    if (!last && !points) return;
    const dot = svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: last ? 3.5 : 2.5, class: last ? 'now' : 'then' });
    if (points) dot.append(Object.assign(svg('title', {}), { textContent: points[i] }));
    el.append(dot);
  });
  return el;
}

/** A change as a capsule: its direction's mark and colour, and the change in words, so it never rests on colour alone. */
function trendPill(row: ComparedRow, tone: Trend | 'bad' = row.trend): HTMLElement {
  const mark = changeMark(row, tone);
  return h('span', { class: `sc-pill ${mark.tone}`, title: mark.noise ? 'Within the 10% timings wobble from run to run' : undefined }, `${mark.icon} ${mark.words}`);
}

/** The scorecard's head: which commit it measured and when, Measure now, the MSD, and how a measurement is going. */
export function scorecardHead(ui: Ui): HTMLElement {
  const desk = scorecards();
  const history = desk?.history ?? [];
  const latest = history.at(-1);
  const measuring = desk?.status === 'measuring';

  const measure = h('button', { class: 'btn primary small' }, measuring ? 'Measuring…' : 'Measure now');
  measure.disabled = measuring;
  measure.onclick = () => void busy(measure, () => api.plugin<Scorecards>(SCORECARD, '/measure').then(() => undefined), ui.error);
  const onMsd = h('button', { class: 'btn small' }, 'Show on the MSD');
  onMsd.disabled = !latest;
  onMsd.onclick = () => ui.showOnMsd({ plugin: SCORECARD });

  const status = measuring
    ? h('small', { class: 'muted' }, `${desk?.trigger === 'new-commit' ? 'Measuring the new commit the office started on' : 'Running the gate on the office’s own checkout'}${desk?.startedAt ? `, started ${timeAgo(desk.startedAt)}` : ''}: about a minute and a half`)
    : desk?.status === 'failed'
      ? h('small', null, h('span', { class: 'chip bad' }, 'failed'), ' ', desk.error ?? '')
      : latest ? null : h('small', { class: 'muted' }, 'Not measured yet. Measure now runs the gate, counts the fence and reads the ledger on the office’s own checkout.');
  return h('div', { class: 'sc-head' },
    h('div', { class: 'row' },
      h('h3', null, 'Scorecard'),
      latest ? h('span', { class: 'muted grow' }, `${measuredAt(latest)} · measured ${timeAgo(latest.at)}`) : h('span', { class: 'grow' }),
      measure, onMsd),
    status,
  );
}

/** The overview's opening sentence: is the gate green, and how many numbers climbed or slipped. */
function verdict(history: Scorecard[]): HTMLElement | null {
  const g = glance(history);
  return g ? h('p', { class: 'sc-verdict' }, ...verdictPhrases(g).map((p) => (p.tone ? h('b', { class: p.tone }, p.text) : p.text))) : null;
}

function tile(t: Tile, go: Go): HTMLElement {
  const face = tileFace(t);
  return h('button', { class: `sc-tile ${t.tone}`, style: `--c:${SECTION_TONE[t.section]}`, title: `${t.title}: open its numbers`, onclick: () => go(t.section) },
    h('h4', null, t.title),
    h('small', { class: 'q' }, SECTION_ABOUT[t.section].question),
    h('div', { class: 'hero' }, face.value, h('span', null, face.caption)),
    h('div', { class: 'row' }, sparkline(t.trend.series, t.tone, { w: 110, h: 26 }), trendPill(t.trend, t.tone)),
    face.also ? h('small', { class: 'also' }, face.also) : null,
  );
}

/** What moved since the card before, the slips first: each opens its number in its section. */
function movedList(moved: ComparedRow[], go: Go): HTMLElement {
  const SHOWN = 7;
  return h('div', { class: 'card sc-moved' },
    h('h4', null, 'What moved since the one before'),
    moved.length
      ? h('div', { class: 'sc-moved-rows' }, ...moved.slice(0, SHOWN).map((r) =>
        h('button', { class: 'sc-moved-row', onclick: () => go(r.metric.section, r.metric.key) },
          h('span', { class: 'dot', style: `background:${SECTION_TONE[r.metric.section]}` }),
          h('span', { class: 'grow' }, r.metric.label),
          h('b', null, formatValue(r.metric.value, r.metric.format)),
          trendPill(r))))
      : h('small', { class: 'muted' }, 'Nothing yet: it fills in once there are two scorecards to compare.'),
    moved.length > SHOWN ? h('small', { class: 'muted' }, `and ${moved.length - SHOWN} more: open a section to see them`) : null,
  );
}

/** The overview: the verdict, a tile per section, what moved, and `beside` it (how it's getting better). */
export function scorecardOverview(ui: Ui, go: Go, beside: HTMLElement): HTMLElement {
  const history = scorecards()?.history ?? [];
  const g = glance(history);
  const notes = history.at(-1)?.notes ?? [];
  return h('div', { class: 'sc' },
    scorecardHead(ui),
    verdict(history),
    g ? h('div', { class: 'sc-tiles' }, ...g.tiles.map((t) => tile(t, go))) : null,
    h('div', { class: 'sc-split' }, g ? movedList(g.moved, go) : null, beside),
    notes.length ? h('small', { class: 'muted' }, `Not measured: ${notes.join(' · ')}`) : null,
  );
}

/** An explanation's `code` spans as code, the rest as text. */
const withCode = (text: string) => text.split('`').map((part, i) => (i % 2 ? h('code', null, part) : part));

const BETTER: Record<Metric['better'], string> = { lower: 'Lower is better', higher: 'Higher is better', none: 'Neither way is better' };

/** One number, a line you can open to say what it counts, why it matters, and how it's gone over the history. */
function metricRow(row: ComparedRow, history: Scorecard[], open: Set<string>): HTMLElement {
  const { metric } = row;
  const about = aboutMetric(metric.key, metric.label);
  const kept = history.filter((c) => c.metrics.some((m) => m.key === metric.key));
  const points = kept.map((c) => `${timeAgo(c.at)}: ${formatValue(c.metrics.find((m) => m.key === metric.key)?.value ?? 0, metric.format)}`);
  const chart = sparkline(row.series, row.trend, { w: 300, h: 64 }, points);
  const lo = Math.min(...row.series);
  const hi = Math.max(...row.series);
  const details = h('details', { class: `sc-metric ${row.trend}`, open: open.has(metric.key), attrs: { 'data-key': metric.key } },
    h('summary', null,
      h('span', { class: 'name' }, metric.label),
      sparkline(row.series, row.trend, { w: 72, h: 18 }) ?? h('span'),
      h('b', null, formatValue(metric.value, metric.format)),
      trendPill(row),
    ),
    h('div', { class: 'sc-about' },
      h('div', null,
        h('p', null, h('span', { class: 'lbl' }, 'What it counts'), ...withCode(about.what)),
        about.why ? h('p', null, h('span', { class: 'lbl' }, 'Why it matters'), ...withCode(about.why)) : null,
        h('p', { class: 'muted' }, metric.format === 'pass' ? 'It should pass.' : `${BETTER[metric.better]}.`),
      ),
      chart
        ? h('figure', null, chart, h('figcaption', { class: 'muted' },
          `Last ${row.series.length}, from ${timeAgo(kept[0].at)}: lowest ${formatValue(lo, metric.format)}, highest ${formatValue(hi, metric.format)}`))
        : h('small', { class: 'muted' }, 'Its history shows once it’s been measured twice.'),
    ),
  );
  details.addEventListener('toggle', () => (details.open ? open.add(metric.key) : open.delete(metric.key)));
  return details;
}

/** The gate's time a step at a time, as one bar: where the wait goes. */
function gateBar(rows: ComparedRow[]): HTMLElement | null {
  const steps = ['typecheck.seconds', 'lint.seconds', 'test.seconds', 'build.seconds'].flatMap((k) => rows.filter((r) => r.metric.key === k));
  const total = steps.reduce((n, r) => n + r.metric.value, 0);
  if (!total) return null;
  return h('div', { class: 'sc-gatebar', title: 'Where the gate’s time goes' },
    ...steps.map((r) => h('span', { style: `flex:${r.metric.value} 1 0`, title: `${aboutMetric(r.metric.key, r.metric.label).short}: ${duration(r.metric.value)}` },
      r.metric.value / total > 0.08 ? `${aboutMetric(r.metric.key, r.metric.label).short} ${duration(r.metric.value)}` : '')),
  );
}

/** Each of `sections` in full: what it's for, and every number in it, each opening to explain itself. */
export function scorecardSections(sections: ScorecardSection[], open: Set<string>, after?: Partial<Record<ScorecardSection, HTMLElement | null>>): HTMLElement[] {
  const history = scorecards()?.history ?? [];
  return compared(history).filter((s) => sections.includes(s.section)).map(({ section, title, rows }) => {
    const better = rows.filter((r) => r.trend === 'better').length;
    const worse = rows.filter((r) => r.trend === 'worse').length;
    return h('section', { class: 'card sc-section', id: `sc-${section}`, style: `--c:${SECTION_TONE[section]}` },
      h('div', { class: 'row' },
        h('h4', { class: 'grow' }, title, h('span', null, SECTION_ABOUT[section].question)),
        better ? h('span', { class: 'sc-pill better' }, `▲ ${better} better`) : null,
        worse ? h('span', { class: 'sc-pill worse' }, `▼ ${worse} worse`) : null),
      h('p', { class: 'muted sc-section-about' }, SECTION_ABOUT[section].about),
      section === 'gate' ? gateBar(rows) : null,
      h('div', { class: 'sc-rows' }, ...rows.map((r) => metricRow(r, history, open))),
      after?.[section] ?? null,
    );
  });
}
