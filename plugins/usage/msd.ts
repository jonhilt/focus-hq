// Your plan's usage on main engineering's MSD, beside the ship, while the captain has put it up there.
import { type Box, fitText, LCARS, LCARS_FONT } from '../../plugin-api/client';
import { signInLine, usageHeadline, usageRows, type UsageTone } from './readout';
import type { Usage } from './shared';

const TONE: Record<UsageTone, string> = { ok: LCARS.sky, warn: LCARS.gold, bad: LCARS.red };

/** The readout as the engineering panel has it, big enough to read from the gallery: a gauge per limit, and how the office signs in. */
export function drawUsage(ctx: CanvasRenderingContext2D, b: Box, usage: Usage | null): void {
  const px = (f: number) => Math.round(b.h * f);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = LCARS.gold;
  ctx.font = `600 ${px(0.075)}px ${LCARS_FONT}`;
  ctx.fillText(fitText(ctx, `Plan usage · ${usageHeadline(usage)}`.toUpperCase(), b.w), b.x, b.y);
  // a gauge per limit: its name and when it resets over a bar that fills as it's used
  usageRows(usage).slice(0, 4).forEach((r, i) => {
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
    ctx.fillStyle = TONE[r.tone];
    ctx.beginPath();
    ctx.roundRect(b.x, bar.y, Math.max(bar.h, (b.w * Math.min(100, r.percent)) / 100), bar.h, bar.h / 2);
    ctx.fill();
  });
  ctx.fillStyle = LCARS.lilac;
  ctx.font = `500 ${px(0.05)}px ${LCARS_FONT}`;
  ctx.fillText(fitText(ctx, signInLine(usage), b.w), b.x, b.y + b.h * 0.92);
}
