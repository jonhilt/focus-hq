import * as THREE from 'three';

export const UI_FONT = '"Fredoka", "Trebuchet MS", system-ui, sans-serif';
export const MONO_FONT = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

/**
 * `?canvas=cpu`, to tell whether drawing the screens on the GPU is what holds frames up on someone's machine: the
 * browser then draws every canvas in software, on the main thread, rather than in its GPU process as each is sent.
 */
export const canvasTest = { software: false };

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d', canvasTest.software ? { willReadFrequently: true } : undefined)! };
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

/**
 * Sets the largest font from `size` down to `min` pixels (in `weight` and `family`) that fits `text` in `maxWidth`, so a
 * short label stays whole rather than being cut off; at `min`, `fitText` cuts what's still too long.
 */
export function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, min: number, weight: string, family: string): void {
  for (let px = size; px >= min; px -= 2) {
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return;
  }
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}
