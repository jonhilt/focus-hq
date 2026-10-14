import type { Drawing, Shape } from '../../../shared/modelDrawing';

// A model drawing (shared/modelDrawing.ts) painted onto a canvas, for the holodeck's boards and their contact sheet:
// the same shapes the live panel draws as SVG, drawn at once, with no image to wait for.

const FONT = "Antonio, 'Arial Narrow', sans-serif";
const MONO = "'JetBrains Mono', monospace";

/** Paints `d` onto `ctx`, scaled by `k` (canvas pixels per drawing unit). */
export function paintDrawing(ctx: CanvasRenderingContext2D, d: Drawing, k = 1): void {
  ctx.save();
  ctx.scale(k, k);
  ctx.clearRect(0, 0, d.w, d.h);
  for (const s of d.shapes) paint(ctx, s);
  ctx.restore();
}

function finish(ctx: CanvasRenderingContext2D, s: { fill?: string; stroke?: string; sw?: number; dash?: boolean }): void {
  if (s.fill && s.fill !== 'none') {
    ctx.fillStyle = s.fill;
    ctx.fill();
  }
  if (s.stroke) {
    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = s.sw ?? 2;
    ctx.setLineDash(s.dash ? [10, 7] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function paint(ctx: CanvasRenderingContext2D, s: Shape): void {
  ctx.beginPath();
  switch (s.t) {
    case 'rect':
      ctx.roundRect(s.x, s.y, s.w, s.h, s.r ?? 0);
      return finish(ctx, s);
    case 'ellipse':
      ctx.ellipse(s.cx, s.cy, s.rx, s.ry, 0, 0, Math.PI * 2);
      return finish(ctx, s);
    case 'poly':
      for (let i = 0; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i], s.pts[i + 1]);
      ctx.closePath();
      return finish(ctx, s);
    case 'line': {
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      finish(ctx, { stroke: s.stroke, sw: s.sw, dash: s.dash });
      if (!s.arrow) return;
      // an arrowhead at the far end, sized to the line
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const len = 10 + s.sw * 2.2;
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - len * Math.cos(a - 0.45), s.y2 - len * Math.sin(a - 0.45));
      ctx.lineTo(s.x2 - len * Math.cos(a + 0.45), s.y2 - len * Math.sin(a + 0.45));
      ctx.closePath();
      ctx.fillStyle = s.stroke;
      ctx.fill();
      return;
    }
    case 'text':
      ctx.font = `${s.bold ? '600 ' : ''}${s.size}px ${s.mono ? MONO : FONT}`;
      ctx.fillStyle = s.fill;
      ctx.textAlign = s.anchor === 'middle' ? 'center' : s.anchor === 'end' ? 'right' : 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(s.text, s.x, s.y);
  }
}
