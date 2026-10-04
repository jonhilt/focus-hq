import * as THREE from 'three';

export const UI_FONT = '"Fredoka", "Trebuchet MS", system-ui, sans-serif';
export const MONO_FONT = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
}

export function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Splits text into lines that fit maxWidth with the current ctx.font. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = Infinity): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (ctx.measureText(candidate).width <= maxWidth || line === '') {
        if (ctx.measureText(candidate).width > maxWidth) {
          // a single very long token: hard-break it
          let chunk = '';
          for (const ch of candidate) {
            if (ctx.measureText(chunk + ch).width > maxWidth) {
              lines.push(chunk);
              chunk = '';
            }
            chunk += ch;
          }
          line = chunk;
        } else {
          line = candidate;
        }
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** A sign texture with centered text. */
export function signTexture(text: string, opts: { w?: number; h?: number; bg?: string; fg?: string; font?: string; border?: string; sub?: string } = {}): THREE.CanvasTexture {
  const w = opts.w ?? 1024;
  const h = opts.h ?? 200;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = opts.bg ?? '#ffffff';
  roundRect(ctx, 0, 0, w, h, h * 0.18);
  ctx.fill();
  if (opts.border) {
    ctx.lineWidth = h * 0.06;
    ctx.strokeStyle = opts.border;
    roundRect(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth, h * 0.16);
    ctx.stroke();
  }
  ctx.fillStyle = opts.fg ?? '#222';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = Math.min(opts.sub ? h * 0.42 : h * 0.55, w * 0.16);
  const font = (px: number) => opts.font ?? `700 ${px}px ${UI_FONT}`;
  ctx.font = font(size);
  while (size > 12 && ctx.measureText(text).width > w * 0.9) ctx.font = font((size *= 0.92));
  ctx.fillText(fitText(ctx, text, w * 0.9), w / 2, opts.sub ? h * 0.38 : h / 2 + h * 0.03);
  if (opts.sub) {
    ctx.globalAlpha = 0.75;
    ctx.font = `500 ${Math.min(h * 0.22, size * 0.55)}px ${UI_FONT}`;
    ctx.fillText(fitText(ctx, opts.sub, w * 0.9), w / 2, h * 0.75);
    ctx.globalAlpha = 1;
  }
  return canvasTexture(canvas);
}
