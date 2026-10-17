// The stellar cartography screen in a project's holodeck (README.md): the project's map as a sector chart. Each layer
// is a band across it, each part a star along its band beside what it's tied to, as big as its share of the code and as
// bright as its share of the commits, and each heavy import a gold line as thick as it is; LCARS round the edge says
// whose it is, how to read it, and that E takes you in. Drawn on a canvas the hologram shows (client.ts).
import { chartLayout, FRAME } from './chartLayout';
import type { Miniature } from './miniature';

const INK = { bg: '#02040c', orange: '#ff9900', lilac: '#cc99cc', peach: '#ffcc99', muted: '#8e9cc4', link: 'rgba(255, 204, 102, 0.34)' };
/** A layer's name, its letters spaced with hair spaces (canvas has no letter-spacing everywhere). */
const spaced = (text: string) => text.toUpperCase().split('').join(String.fromCharCode(8202));
const FONT = 'Antonio, "Arial Narrow", system-ui, sans-serif';

/** The LCARS frame: an elbow down the left, a bar along the top with the title, and one along the bottom with the key. */
function frame(ctx: CanvasRenderingContext2D, w: number, h: number, name: string, key: string): void {
  const bar = FRAME.bar;
  ctx.fillStyle = INK.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = INK.orange;
  ctx.beginPath();
  ctx.roundRect(0, 0, 150, h, [0, 48, 48, 0]);
  ctx.fill();
  ctx.fillStyle = INK.bg;
  ctx.beginPath();
  ctx.roundRect(110, bar, 60, h - bar * 2, [36, 0, 0, 36]);
  ctx.fill();
  ctx.fillStyle = INK.orange;
  ctx.fillRect(150, 0, w - 150, bar - 16);
  ctx.fillStyle = INK.lilac;
  ctx.fillRect(150, h - bar + 16, w - 150, bar - 16);
  ctx.fillStyle = INK.bg;
  ctx.textBaseline = 'middle';
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText('STELLAR CARTOGRAPHY', 180, (bar - 16) / 2 + 2);
  ctx.textAlign = 'right';
  ctx.fillText(name.toUpperCase(), w - 28, (bar - 16) / 2 + 2, w / 2);
  ctx.fillText('E TO STEP IN', w - 28, h - (bar - 16) / 2 - 2);
  ctx.textAlign = 'left';
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(key, 180, h - (bar - 16) / 2 - 2, w - 180 - 220);
}

/** Project `name`'s map `mini` as a sector chart on a `w` × `h` canvas, laid out by chartLayout. */
export function drawChart(ctx: CanvasRenderingContext2D, w: number, h: number, name: string, mini: Miniature): void {
  const layout = chartLayout(mini, w, h);
  frame(ctx, w, h, name, layout.key);
  ctx.textBaseline = 'alphabetic';
  if (!layout.stars.length) {
    ctx.fillStyle = INK.muted;
    ctx.font = `28px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('NOT MAPPED YET', (FRAME.left + w - FRAME.right) / 2, h / 2);
    ctx.textAlign = 'left';
    return;
  }
  // the bands, each a faint rule in its layer's colour, named at its left
  ctx.font = `17px ${FONT}`;
  ctx.lineWidth = 1.5;
  for (const band of layout.bands) {
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = band.colour;
    ctx.beginPath();
    ctx.moveTo(FRAME.left - 20, band.y);
    ctx.lineTo(w - FRAME.right, band.y);
    ctx.stroke();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = band.colour;
    ctx.fillText(spaced(band.layer), FRAME.left - 20, band.y - 14);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = INK.link;
  for (const { from, to, bend, width } of layout.lines) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(from.x, bend, to.x, bend, to.x, to.y);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.font = `22px ${FONT}`;
  for (const star of layout.stars) {
    ctx.globalAlpha = star.alpha;
    ctx.fillStyle = star.colour;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK.peach;
    ctx.fillText(star.label, star.x, star.labelY, star.room);
  }
  ctx.textAlign = 'left';
}
