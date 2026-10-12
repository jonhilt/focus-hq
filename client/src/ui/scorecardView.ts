import { compared, formatValue, measuredAt } from '../../../shared/scorecard';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { busy, h, timeAgo } from './dom';

const SVG = 'http://www.w3.org/2000/svg';

/** A number's last few measurements as a little line, the latest at the right end; nothing with fewer than two. */
function sparkline(series: number[], tone: string): SVGElement | null {
  if (series.length < 2) return null;
  const [w, hgt] = [56, 14];
  const lo = Math.min(...series);
  const span = Math.max(...series) - lo || 1;
  const points = series.map((v, i) => `${((i / (series.length - 1)) * w).toFixed(1)},${(hgt - 1 - ((v - lo) / span) * (hgt - 2)).toFixed(1)}`);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', `spark ${tone}`);
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', points.join(' '));
  svg.append(line);
  return svg;
}

/**
 * The scorecard at the top of the engineering panel: the latest measurement of Focus's own code and the office, each
 * number with its change since the one before and a line of its last few, a section at a time (docs/scorecard.md).
 */
export function scorecardView(ui: Ui): HTMLElement {
  const desk = state.scorecards;
  const history = desk?.history ?? [];
  const latest = history.at(-1);
  const measuring = desk?.status === 'measuring';

  const measure = h('button', { class: 'btn primary small' }, measuring ? 'Measuring…' : 'Measure now');
  measure.disabled = measuring;
  measure.onclick = () => void busy(measure, () => api.measureScorecard().then(() => undefined), ui.error);
  const onMsd = h('button', { class: 'btn small' }, 'Show on the MSD');
  onMsd.disabled = !latest;
  onMsd.onclick = () => ui.showOnMsd('scorecard');

  const head = h('div', { class: 'row' },
    h('strong', { class: 'grow' }, latest ? `Scorecard · ${measuredAt(latest)} · ${timeAgo(latest.at)}` : 'Scorecard'),
    measure, onMsd);
  const status = measuring
    ? h('small', { class: 'muted' }, `Running the gate on the office’s own checkout${desk?.startedAt ? `, started ${timeAgo(desk.startedAt)}` : ''}: about a minute and a half`)
    : desk?.status === 'failed'
      ? h('small', null, h('span', { class: 'chip bad' }, 'failed'), ' ', desk.error ?? '')
      : h('small', { class: 'muted' }, latest
        ? `▲ better, ▼ worse since the one before; each line is the last ${history.length}`
        : 'Not measured yet. Measure now runs the gate, counts the fence and reads the ledger on the office’s own checkout.');

  const sections = compared(history).map(({ section, title, rows }) =>
    h('div', { class: `scorecard-section ${section}` },
      h('h4', null, title),
      ...rows.map(({ metric, delta, trend, series }) => h('div', { class: 'scorecard-row' },
        h('span', { class: 'grow' }, metric.label),
        sparkline(series, trend),
        h('strong', null, formatValue(metric.value, metric.format)),
        h('small', { class: `delta ${trend}` }, delta),
      )),
      section === 'office' && latest?.frictions.length
        ? h('small', { class: 'muted' }, `Most widespread open friction: ${latest.frictions[0].key} (${latest.frictions[0].sessions} sessions)`)
        : null,
    ));

  return h('div', { class: 'card scorecard' }, head, status, sections.length ? h('div', { class: 'scorecard-grid' }, ...sections) : null,
    latest?.notes.length ? h('small', { class: 'muted' }, latest.notes.join(' · ')) : null);
}
