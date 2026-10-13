import { frictionName, type ReportCard, reportLines } from '../../../shared/ledger';
import type { Trace } from '../../../shared/ledgerReview';
import { changeMark, formatValue, glance, measuredAt, SECTIONS, tileFace, type Trend, verdictPhrases } from '../../../shared/scorecard';
import type { ScorecardSection, Scorecards, Usage } from '../../../shared/types';
import { signInLine, usageHeadline, usageRows } from '../../../shared/usage';
import { fitText } from './canvas';
import { LCARS, LCARS_FONT, LCARS_STATUS, lcarsFrame } from './starship';

/**
 * What the MSD shows beside the ship: the ledger's report card, the scorecard, your plan's usage, or the trace picked at
 * the master systems table.
 */
export type MsdBoard =
  | { kind: 'report'; card: ReportCard | null }
  | { kind: 'scorecard'; scorecards: Scorecards | null }
  | { kind: 'usage'; usage: Usage | null }
  | { kind: 'trace'; trace: Trace };

/** A deck on the MSD: where it is on the cutaway (fractions of the drawing's width and height), and its colour. */
interface DeckMark {
  label: string;
  at: [number, number];
  color: string;
}

const DECKS: DeckMark[] = [
  { label: 'Deck 1 · Bridge', at: [0.3, 0.17], color: LCARS.orange },
  { label: 'Deck 4 · Holodecks', at: [0.24, 0.36], color: LCARS.periwinkle },
  { label: 'Deck 5 · Main engineering', at: [0.6, 0.66], color: LCARS.sky },
];

/**
 * Main engineering's master systems display (the 'msd' screen on deck 5's port wall): a cutaway of the ship from
 * the side, its saucer forward to the left, with the decks marked and the warp core glowing in the engineering hull,
 * and beside it the ledger: its report card, or whichever pull request or goal the captain traced at the table.
 */
export function drawMsd(ctx: CanvasRenderingContext2D, w: number, h: number, board: MsdBoard): void {
  const a = lcarsFrame(ctx, w, h, { title: 'Master systems display · U.S.S. Focus', color: LCARS.lilac, seed: 5005 });
  drawBoard(ctx, { x: a.x + a.w * 0.55, y: a.y, w: a.w * 0.45, h: a.h }, board);
  // the ship, in the left half
  const X = (f: number) => a.x + a.w * 0.53 * f;
  const Y = (f: number) => a.y + a.h * f;
  const hull = '#1e2a4a';
  const line = LCARS.periwinkle;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';

  const shape = (draw: () => void, fill = hull) => {
    ctx.beginPath();
    draw();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.stroke();
  };

  // the nacelle on its pylon, behind the engineering hull
  shape(() => {
    ctx.moveTo(X(0.62), Y(0.6));
    ctx.lineTo(X(0.7), Y(0.3));
    ctx.lineTo(X(0.75), Y(0.3));
    ctx.lineTo(X(0.7), Y(0.6));
    ctx.closePath();
  });
  shape(() => ctx.roundRect(X(0.56), Y(0.2), X(0.97) - X(0.56), Y(0.31) - Y(0.2), a.h * 0.05));
  ctx.fillStyle = LCARS.red;
  ctx.beginPath();
  ctx.roundRect(X(0.56), Y(0.215), a.w * 0.035, Y(0.295) - Y(0.215), a.h * 0.04);
  ctx.fill();
  ctx.fillStyle = '#4a8fbf';
  ctx.fillRect(X(0.62), Y(0.285), X(0.94) - X(0.62), a.h * 0.012);

  // the neck, and the engineering hull with the core through it
  shape(() => {
    ctx.moveTo(X(0.38), Y(0.4));
    ctx.lineTo(X(0.47), Y(0.4));
    ctx.lineTo(X(0.55), Y(0.56));
    ctx.lineTo(X(0.44), Y(0.56));
    ctx.closePath();
  });
  shape(() => {
    ctx.moveTo(X(0.42), Y(0.55));
    ctx.lineTo(X(0.8), Y(0.55));
    ctx.quadraticCurveTo(X(0.86), Y(0.64), X(0.8), Y(0.76));
    ctx.lineTo(X(0.5), Y(0.76));
    ctx.quadraticCurveTo(X(0.4), Y(0.66), X(0.42), Y(0.55));
    ctx.closePath();
  });
  const core = ctx.createLinearGradient(X(0.59), 0, X(0.61), 0);
  core.addColorStop(0, '#3fb8ff');
  core.addColorStop(0.5, '#e6fbff');
  core.addColorStop(1, '#3fb8ff');
  ctx.fillStyle = core;
  ctx.fillRect(X(0.592), Y(0.565), a.w * 0.016, Y(0.75) - Y(0.565));

  // the saucer, its decks in bands, and the bridge on top
  shape(() => ctx.ellipse(X(0.27), Y(0.3), a.w * 0.25, a.h * 0.11, 0, 0, Math.PI * 2));
  shape(() => ctx.ellipse(X(0.3), Y(0.19), a.w * 0.045, a.h * 0.035, 0, Math.PI, Math.PI * 2), LCARS.orange);
  ctx.fillStyle = LCARS.periwinkle;
  ctx.fillRect(X(0.1), Y(0.34), X(0.44) - X(0.1), a.h * 0.03);
  ctx.strokeStyle = 'rgba(153,153,255,0.35)';
  ctx.lineWidth = 1.5;
  for (const f of [0.25, 0.29, 0.39]) {
    ctx.beginPath();
    ctx.moveTo(X(0.08), Y(f));
    ctx.lineTo(X(0.46), Y(f));
    ctx.stroke();
  }

  // each deck's name, down the bottom left, with a line up to it
  ctx.font = `600 ${Math.round(a.h * 0.065)}px ${LCARS_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  DECKS.forEach((deck, i) => {
    const y = Y(0.55 + i * 0.13);
    const x = X(0.02);
    ctx.fillStyle = deck.color;
    ctx.beginPath();
    ctx.roundRect(x, y - a.h * 0.04, a.h * 0.08, a.h * 0.08, a.h * 0.04);
    ctx.fill();
    ctx.fillText(deck.label.toUpperCase(), x + a.h * 0.12, y);
    const end = x + a.h * 0.14 + ctx.measureText(deck.label.toUpperCase()).width;
    ctx.strokeStyle = deck.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(end + 8, y);
    ctx.lineTo(Math.max(end + 20, X(deck.at[0]) - 30), y);
    ctx.lineTo(X(deck.at[0]), Y(deck.at[1]));
    ctx.stroke();
  });
  ctx.fillStyle = LCARS.sky;
  ctx.font = `500 ${Math.round(a.h * 0.05)}px ${LCARS_FONT}`;
  ctx.fillText('YOU ARE HERE', X(0.68), Y(0.84));
}

type Box = { x: number; y: number; w: number; h: number };

/** The ledger beside the ship: big numbers along the top, then lines of text. */
function drawBoard(ctx: CanvasRenderingContext2D, b: Box, board: MsdBoard): void {
  const px = (f: number) => Math.round(b.h * f);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const title = (text: string, color: string) => {
    ctx.fillStyle = color;
    ctx.font = `600 ${px(0.075)}px ${LCARS_FONT}`;
    ctx.fillText(fitText(ctx, text.toUpperCase(), b.w), b.x, b.y);
  };
  const lines = (from: number, rows: { text: string; color: string; tag?: string }[]) => {
    ctx.font = `500 ${px(0.065)}px ${LCARS_FONT}`;
    rows.slice(0, Math.floor((1 - from) / 0.09)).forEach((r, i) => {
      const y = b.y + b.h * (from + i * 0.09);
      let x = b.x;
      if (r.tag) {
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.roundRect(x, y, b.w * 0.17, px(0.06), px(0.03));
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.font = `600 ${px(0.042)}px ${LCARS_FONT}`;
        ctx.fillText(fitText(ctx, r.tag.toUpperCase(), b.w * 0.15), x + b.w * 0.01, y + px(0.008));
        ctx.font = `500 ${px(0.065)}px ${LCARS_FONT}`;
        x += b.w * 0.19;
      }
      ctx.fillStyle = r.tag ? '#e8e2ff' : r.color;
      ctx.fillText(fitText(ctx, r.text, b.x + b.w - x), x, y);
    });
  };
  const tiles = (from: number, list: [string, string][]) => {
    const w = b.w / list.length;
    list.forEach(([value, label], i) => {
      const x = b.x + i * w;
      ctx.fillStyle = '#1b1630';
      ctx.beginPath();
      ctx.roundRect(x, b.y + b.h * from, w - px(0.02), b.h * 0.2, px(0.03));
      ctx.fill();
      ctx.fillStyle = LCARS.sky;
      ctx.font = `600 ${px(0.09)}px ${LCARS_FONT}`;
      ctx.fillText(fitText(ctx, value, w - px(0.05)), x + px(0.02), b.y + b.h * (from + 0.02));
      ctx.fillStyle = '#a49db4';
      ctx.font = `500 ${px(0.042)}px ${LCARS_FONT}`;
      ctx.fillText(fitText(ctx, label, w - px(0.05)), x + px(0.02), b.y + b.h * (from + 0.13));
    });
  };

  if (board.kind === 'report') {
    const { headline, lines: rows } = board.card ? reportLines(board.card) : { headline: 'Reading the ledger…', lines: [] };
    title(`Ledger · ${headline}`, LCARS.gold);
    lines(0.14, rows.map((text) => ({ text, color: LCARS.peach })));
    return;
  }
  if (board.kind === 'scorecard') {
    drawScorecard(ctx, b, board.scorecards);
    return;
  }
  if (board.kind === 'usage') {
    title(`Plan usage · ${usageHeadline(board.usage)}`, LCARS.gold);
    // a gauge per limit: its name and when it resets over a bar that fills as it's used
    usageRows(board.usage).slice(0, 4).forEach((r, i) => {
      const y = b.y + b.h * (0.14 + i * 0.19);
      ctx.font = `500 ${px(0.06)}px ${LCARS_FONT}`;
      ctx.fillStyle = LCARS.peach;
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, r.label.toUpperCase(), b.w * 0.5), b.x, y);
      ctx.textAlign = 'right';
      ctx.fillText(fitText(ctx, `${r.percent}%${r.note ? ` · ${r.note.toUpperCase()}` : ''}`, b.w * 0.5), b.x + b.w, y);
      ctx.textAlign = 'left';
      const bar = { y: y + px(0.08), h: px(0.06) };
      ctx.fillStyle = '#1b1630';
      ctx.beginPath();
      ctx.roundRect(b.x, bar.y, b.w, bar.h, bar.h / 2);
      ctx.fill();
      ctx.fillStyle = USAGE_TONE[r.tone];
      ctx.beginPath();
      ctx.roundRect(b.x, bar.y, Math.max(bar.h, (b.w * Math.min(100, r.percent)) / 100), bar.h, bar.h / 2);
      ctx.fill();
    });
    ctx.fillStyle = LCARS.lilac;
    ctx.font = `500 ${px(0.05)}px ${LCARS_FONT}`;
    ctx.fillText(fitText(ctx, signInLine(board.usage), b.w), b.x, b.y + b.h * 0.92);
    return;
  }
  const { subject, totals: t, steps, goal } = board.trace;
  const friction = subject.kind === 'friction' ? frictionName(subject.key) : undefined;
  title(subject.kind === 'pr' ? `Trace · ${subject.repo.split('/').pop()} #${subject.pr}` : subject.kind === 'goal' ? 'Trace · goal' : `Trace · ${friction?.kind || 'friction'}`, LCARS.gold);
  ctx.fillStyle = LCARS.lilac;
  ctx.font = `500 ${px(0.05)}px ${LCARS_FONT}`;
  const under = friction?.signature ?? goal;
  if (under) ctx.fillText(fitText(ctx, under, b.w), b.x, b.y + b.h * 0.09);
  tiles(0.17, friction
    ? [
      [String(t.sessions), 'sessions'],
      [String(t.frictions), 'times it came up'],
      [String(t.prs), 'pull requests'],
      [`$${t.costUsd.toFixed(2)}`, 'those sessions'],
    ]
    : [
      [t.verdicts ? `${t.fails}/${t.verdicts}` : '–', 'QA fails'],
      [String(t.conflicts), 'conflicts'],
      [`$${t.costUsd.toFixed(2)}`, `${t.sessions} sessions`],
      [String(t.wastedCalls), 'wasted calls'],
    ]);
  // the latest steps, oldest of them first, so it reads down to where it stands; a friction's, by what was said
  const last = steps.slice(-6);
  lines(0.42, last.map((s) => ({ tag: s.tag, text: friction && s.quotes?.length ? `${s.quotes[0]} · ${s.title}` : s.title, color: STEP[s.tone] })));
}

const USAGE_TONE: Record<string, string> = { ok: LCARS.sky, warn: LCARS.gold, bad: LCARS.red };

/** `text` in lines no wider than `width`, at most `most` of them, the last cut short if it has to be. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, most: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(' ')) {
    const last = lines.at(-1);
    if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const kept = lines.slice(0, most);
  if (lines.length > most) kept[most - 1] = `${kept[most - 1]} ${lines.slice(most).join(' ')}`;
  return kept.map((line) => fitText(ctx, line, width));
}

/** Each section's colour on the MSD, as on the engineering panel's tiles. */
const SECTION_COLOR: Record<ScorecardSection, string> = { gate: LCARS.gold, fence: LCARS.sky, effect: LCARS.periwinkle, tests: LCARS.lilac, office: LCARS.orange };
const GOOD = LCARS_STATUS.done;
const TONE: Record<Trend | 'bad', string> = { better: GOOD, worse: LCARS.red, bad: LCARS.red, same: '#a49db4' };

/**
 * The scorecard as the engineering panel's overview has it, big enough to read from the gallery: the verdict, a tile
 * per section (its headline number, a few words, and its change), then what moved, the slips first.
 */
function drawScorecard(ctx: CanvasRenderingContext2D, b: Box, scorecards: Scorecards | null): void {
  const px = (f: number) => Math.round(b.h * f);
  const history = scorecards?.history ?? [];
  const latest = history.at(-1);
  const g = glance(history);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = LCARS.gold;
  ctx.font = `600 ${px(0.075)}px ${LCARS_FONT}`;
  ctx.fillText(fitText(ctx, latest ? `Scorecard · ${measuredAt(latest)}`.toUpperCase() : 'SCORECARD · NOT MEASURED YET', b.w), b.x, b.y);
  if (!g) return;

  // the verdict, a phrase at a time, the news in its colour, wrapped onto two lines at most
  ctx.font = `500 ${px(0.05)}px ${LCARS_FONT}`;
  let [x, line] = [b.x, 0];
  for (const phrase of verdictPhrases(g)) {
    for (const word of phrase.text.split(/(?<= )/)) {
      const width = ctx.measureText(word).width;
      if (x + width > b.x + b.w && x > b.x) [x, line] = [b.x, line + 1];
      if (line > 1) break;
      ctx.fillStyle = phrase.tone ? TONE[phrase.tone] : '#e8e2ff';
      ctx.fillText(word, x, b.y + b.h * (0.1 + line * 0.06));
      x += width;
    }
  }

  // a tile per section
  const top = b.y + b.h * 0.24;
  const tall = b.h * 0.3;
  const w = b.w / g.tiles.length;
  g.tiles.forEach((t, i) => {
    const face = tileFace(t);
    const mark = changeMark(t.trend, t.tone);
    const tx = b.x + i * w;
    const inner = w - px(0.045);
    ctx.fillStyle = '#1b1630';
    ctx.beginPath();
    ctx.roundRect(tx, top, w - px(0.02), tall, [0, px(0.03), px(0.03), 0]);
    ctx.fill();
    ctx.fillStyle = t.tone === 'bad' ? LCARS.red : SECTION_COLOR[t.section];
    ctx.fillRect(tx, top, px(0.012), tall);
    const left = tx + px(0.03);
    ctx.fillStyle = SECTION_COLOR[t.section];
    ctx.font = `600 ${px(0.038)}px ${LCARS_FONT}`;
    ctx.fillText(fitText(ctx, SECTIONS[t.section].split(' (')[0].toUpperCase(), inner), left, top + px(0.02));
    ctx.fillStyle = '#f1eaff';
    ctx.font = `600 ${px(0.085)}px ${LCARS_FONT}`;
    ctx.fillText(fitText(ctx, face.value, inner), left, top + px(0.065));
    ctx.font = `500 ${px(0.032)}px ${LCARS_FONT}`;
    wrap(ctx, face.caption, inner, 2).forEach((text, n) => ctx.fillText(text, left, top + px(0.16 + n * 0.036)));
    ctx.fillStyle = TONE[mark.tone];
    ctx.font = `600 ${px(0.035)}px ${LCARS_FONT}`;
    ctx.fillText(fitText(ctx, `${mark.icon} ${mark.words}`, inner), left, top + px(0.245));
  });

  // what moved, the slips first, each with its change on a pill in its direction's colour
  ctx.fillStyle = '#a49db4';
  ctx.font = `600 ${px(0.04)}px ${LCARS_FONT}`;
  ctx.fillText(g.compared ? 'WHAT MOVED SINCE THE ONE BEFORE' : 'THE NEXT SCORECARD WILL SHOW WHAT MOVED', b.x, b.y + b.h * 0.58);
  // five lines fit: four and a line saying how many more, when there are more
  const room = g.moved.length > 5 ? 4 : 5;
  g.moved.slice(0, room).forEach((r, i) => {
    const mark = changeMark(r);
    const y = b.y + b.h * (0.64 + i * 0.072);
    ctx.fillStyle = TONE[mark.tone];
    ctx.beginPath();
    ctx.roundRect(b.x, y, b.w * 0.2, px(0.055), px(0.028));
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = `600 ${px(0.038)}px ${LCARS_FONT}`;
    ctx.fillText(fitText(ctx, `${mark.icon} ${mark.words}`, b.w * 0.18), b.x + b.w * 0.01, y + px(0.008));
    ctx.fillStyle = '#e8e2ff';
    ctx.font = `500 ${px(0.05)}px ${LCARS_FONT}`;
    ctx.fillText(fitText(ctx, `${r.metric.label}: ${formatValue(r.metric.value, r.metric.format)}`, b.w * 0.78), b.x + b.w * 0.22, y);
  });
  if (g.moved.length > room) {
    ctx.fillStyle = '#a49db4';
    ctx.font = `500 ${px(0.04)}px ${LCARS_FONT}`;
    ctx.fillText(`and ${g.moved.length - room} more on the engineering panel`, b.x + b.w * 0.22, b.y + b.h * (0.64 + room * 0.072));
  }
}

const STEP: Record<string, string> = { ok: LCARS.sky, bad: LCARS.red, warn: LCARS.gold, info: LCARS.lilac };
