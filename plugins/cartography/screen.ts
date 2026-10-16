// A view drawn as a screen in the architecture space (space.ts): its question over its drawing, on a canvas.
import { type Marks, viewDrawing } from './draw';
import type { MapView, RepoMap } from './shared';
import { fitInto } from './views';

const INK = { bg: 'rgba(8, 14, 32, 0.92)', title: '#ffcc66', muted: '#9aa6c4', stale: '#ff7a7a' };
const FONT = 'system-ui, sans-serif';

/** An SVG drawing as an image, to draw on a canvas. */
async function image(svg: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

function heading(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, sub: string): void {
  ctx.fillStyle = INK.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK.title;
  ctx.font = `600 40px ${FONT}`;
  ctx.fillText(title, 48, 36, w - 96);
  ctx.fillStyle = INK.muted;
  ctx.font = `24px ${FONT}`;
  ctx.fillText(sub, 48, 90, w - 96);
}

/** `view` of `map` (with a slice's `marks`, said in `sub`), on a `w` × `h` canvas. */
export async function drawView(ctx: CanvasRenderingContext2D, w: number, h: number, map: RepoMap, view: MapView, marks?: Marks, sub?: string): Promise<void> {
  await drawSvg(ctx, w, h, view.question, sub ?? `${map.repo}${map.commit ? ` · ${map.commit.slice(0, 7)}` : ''}`, viewDrawing(map, view, marks).svg);
}

/** A drawing `svg` under `title` and what it's of (`sub`), on a `w` × `h` canvas. */
export async function drawSvg(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, sub: string, svg: string): Promise<void> {
  heading(ctx, w, h, title, `${sub} · E to read it up close`);
  const img = await image(svg);
  const at = fitInto(img.naturalWidth || img.width, img.naturalHeight || img.height, { x: 32, y: 140, w: w - 64, h: h - 164 });
  ctx.drawImage(img, at.x, at.y, at.w, at.h);
}

/**
 * A kept diagram (diagrams.ts) on a `w` × `h` canvas: its question, how it stands (`sub`), and its picture, when it has
 * one (a data URL); out of date, a red band across its top says so.
 */
export async function drawPicture(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, sub: string, picture: string | undefined, stale: boolean): Promise<void> {
  heading(ctx, w, h, title, `${sub} · E to read it up close`);
  if (stale) {
    ctx.fillStyle = INK.stale;
    ctx.fillRect(0, 0, w, 14);
  }
  if (!picture) return;
  const img = new Image();
  img.src = picture;
  await img.decode();
  const at = fitInto(img.naturalWidth, img.naturalHeight, { x: 32, y: 140, w: w - 64, h: h - 164 });
  ctx.drawImage(img, at.x, at.y, at.w, at.h);
}

/** A screen with nothing to draw yet: `title`, and why. */
export function drawNote(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, why: string): void {
  heading(ctx, w, h, title, why);
}
