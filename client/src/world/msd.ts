import { LCARS, LCARS_FONT, lcarsFrame } from './starship';

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
 * the side, its saucer forward to the left, with the decks marked and the warp core glowing in the engineering hull.
 */
export function drawMsd(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const a = lcarsFrame(ctx, w, h, { title: 'Master systems display · U.S.S. Focus', color: LCARS.lilac, seed: 5005 });
  const X = (f: number) => a.x + a.w * f;
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
