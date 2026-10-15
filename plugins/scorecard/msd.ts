// The scorecard on main engineering's MSD (client/src/world/msd.ts), beside the ship, while the captain has put it up there.
import { fitText } from '../../client/src/world/canvas';
import type { Box } from '../../client/src/world/msd';
import { LCARS, LCARS_FONT, LCARS_STATUS } from '../../client/src/world/starship';
import { changeMark, formatValue, glance, measuredAt, SECTIONS, tileFace, type Trend, verdictPhrases } from './scorecard';
import type { ScorecardSection, Scorecards } from './types';

/** Each section's colour on the MSD, as on the engineering panel's tiles. */
const SECTION_COLOR: Record<ScorecardSection, string> = { gate: LCARS.gold, fence: LCARS.sky, effect: LCARS.periwinkle, tests: LCARS.lilac, office: LCARS.orange };
const GOOD = LCARS_STATUS.done;
const TONE: Record<Trend | 'bad', string> = { better: GOOD, worse: LCARS.red, bad: LCARS.red, same: '#a49db4' };

/**
 * The scorecard as the engineering panel's overview has it, big enough to read from the gallery: the verdict, a tile
 * per section (its headline number, a few words, and its change), then what moved, the slips first.
 */
export function drawScorecard(ctx: CanvasRenderingContext2D, b: Box, scorecards: Scorecards | null): void {
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
