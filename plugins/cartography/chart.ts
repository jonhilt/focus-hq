// The stellar cartography screen in a project's holodeck (README.md): the project's map as a star chart, the way
// Stellar Cartography's wall shows a sector. Each layer is an orbit round the middle, each part a star on it, as bright
// as its share of the code, and each import a faint gold line; LCARS round the edge says whose it is and that E takes
// you in. Drawn on a canvas the hologram shows (client.ts).
import { type Miniature, MINIATURE } from './miniature';

const INK = { bg: '#02040c', orange: '#ff9900', lilac: '#cc99cc', peach: '#ffcc99', muted: '#8e9cc4', orbit: 'rgba(140, 170, 255, 0.22)', link: 'rgba(255, 204, 102, 0.28)' };
const FONT = 'Antonio, "Arial Narrow", system-ui, sans-serif';

/** The same faint stars behind every chart. */
function field(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(200, 210, 255, ${0.15 + rnd() * 0.5})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1.6, 1.6);
  }
}

/** Project `name`'s map `mini` as a star chart on a `w` × `h` canvas. */
export function drawChart(ctx: CanvasRenderingContext2D, w: number, h: number, name: string, mini: Miniature): void {
  ctx.fillStyle = INK.bg;
  ctx.fillRect(0, 0, w, h);
  field(ctx, w, h);
  // the LCARS frame: an elbow down the left, a bar along the top with the title, and one along the bottom
  const bar = 64;
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
  ctx.font = `700 34px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('STELLAR CARTOGRAPHY', 180, (bar - 16) / 2 + 2);
  ctx.textAlign = 'right';
  ctx.fillText(name.toUpperCase(), w - 28, (bar - 16) / 2 + 2, w / 2);
  ctx.fillText('E TO STEP IN', w - 28, h - (bar - 16) / 2 - 2);
  ctx.textAlign = 'left';
  ctx.fillText('ARCHITECTURE', 180, h - (bar - 16) / 2 - 2);
  // the chart, seen from above: the miniature's rings flattened onto the screen
  const cx = 150 + (w - 150) / 2;
  const cy = h / 2;
  const scale = (Math.min(w - 150, h - bar * 2) / 2 - 40) / MINIATURE.radius;
  const at = (p: { x: number; z: number }) => ({ x: cx + p.x * scale, y: cy + p.z * scale });
  if (!mini.parts.length) {
    ctx.fillStyle = INK.muted;
    ctx.font = `28px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('NOT MAPPED YET', cx, cy);
    ctx.textAlign = 'left';
    return;
  }
  const radii = [...new Set(mini.parts.map((p) => Math.round(Math.hypot(p.x, p.z) * 1000) / 1000))].filter((r) => r > 0);
  ctx.strokeStyle = INK.orbit;
  ctx.lineWidth = 1.5;
  for (const r of radii) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = INK.link;
  ctx.lineWidth = 1.2;
  for (const [a, b] of mini.links) {
    const [p, q] = [at(mini.parts[a]), at(mini.parts[b])];
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  // each part a star, glowing in its layer's colour, named beside it
  ctx.font = `21px ${FONT}`;
  ctx.textBaseline = 'middle';
  for (const part of mini.parts) {
    const { x, y } = at(part);
    const r = 4 + (part.size / MINIATURE.biggest) * 11;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    glow.addColorStop(0, part.colour);
    glow.addColorStop(0.35, `${part.colour}88`);
    glow.addColorStop(1, `${part.colour}00`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK.peach;
    ctx.fillText(part.label, x + r + 6, y);
  }
}
