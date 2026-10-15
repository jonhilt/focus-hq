// The project's maps in its holodeck (plugins.ts `hall`): a screen per view round the wall, each its question over its
// drawing, and E on it opens it up close.
import type { HallScreen } from '../../plugin-api/client';
import { viewDrawing } from './draw';
import { openView } from './panel';
import type { MapView, RepoMap } from './shared';
import { CHANGES, fitInto, hallViews, screenVersion, WHOLE } from './views';

const INK = { bg: 'rgba(8, 14, 32, 0.92)', title: '#ffcc66', muted: '#9aa6c4' };
const FONT = 'system-ui, sans-serif';

/** An SVG drawing as an image, to draw on a canvas. */
async function image(svg: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

async function drawView(ctx: CanvasRenderingContext2D, w: number, h: number, map: RepoMap, view: MapView): Promise<void> {
  ctx.fillStyle = INK.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK.title;
  ctx.font = `600 40px ${FONT}`;
  ctx.fillText(view.question, 48, 36, w - 96);
  ctx.fillStyle = INK.muted;
  ctx.font = `24px ${FONT}`;
  ctx.fillText(`${map.repo}${map.commit ? ` · ${map.commit.slice(0, 7)}` : ''} · E to read it up close`, 48, 90, w - 96);
  const img = await image(viewDrawing(map, view).svg);
  const at = fitInto(img.naturalWidth || img.width, img.naturalHeight || img.height, { x: 32, y: 140, w: w - 64, h: h - 164 });
  ctx.drawImage(img, at.x, at.y, at.w, at.h);
}

/** The holodeck's screens for a project's maps. */
export function hallMaps(maps: readonly RepoMap[]): HallScreen[] {
  return hallViews(maps).map(({ map, view }) => ({
    key: `${map.repo}#${view.id}`,
    title: view.id === WHOLE.id ? `${map.repo}'s whole map` : view.id === CHANGES.id ? `how ${map.repo} changes` : `the map: ${view.question}`,
    version: screenVersion(map, view),
    draw: (ctx, w, h) => drawView(ctx, w, h, map, view),
    closeUp: (ui) => openView(ui, map, view),
  }));
}
