import * as THREE from 'three';
import { sound } from '../sound';
import { canvasTexture, fitText, makeCanvas } from './canvas';
import { box, flat, lighten, toon } from './materials';
import { viewportGlass } from './starfield';

// The building is a starship in the style of Star Trek: Lower Decks: lilac-grey bulkheads over a dark dado,
// blue carpet, LCARS consoles and signs, doors that swoosh open and viewports onto space (see starfield.ts).
// The project rooms are its holodecks.

export const HULL = {
  bulkhead: '#d9d3e2',
  dado: '#4c4562',
  stripe: '#ff9966',
  frame: '#7a7290',
  door: '#b4adc4',
  ceiling: '#c8c2d2',
  carpet: '#34406c',
  carpetEdge: '#5e6fae',
};

export const LCARS = {
  orange: '#ff9966',
  lilac: '#cc99cc',
  periwinkle: '#9999ff',
  peach: '#ffcc99',
  red: '#cc6666',
  gold: '#ff9900',
  sky: '#99ccff',
};
const PALETTE = Object.values(LCARS);

export const LCARS_FONT = '"Antonio", "Arial Narrow", "Roboto Condensed", sans-serif';

function seeded(seed: number): () => number {
  let s = (Math.abs(seed) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A bar with round ends where `round` says so: the LCARS building block. */
function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, round: { left?: boolean; right?: boolean }): void {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + (round.left ? r : 0), y);
  ctx.lineTo(x + w - (round.right ? r : 0), y);
  if (round.right) ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + (round.left ? r : 0), y + h);
  if (round.left) ctx.arc(x + r, y + r, r, Math.PI / 2, (Math.PI * 3) / 2);
  else ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Paints a black screen with an LCARS frame (an elbow sweeping from the top bar into a segmented left bar) and
 * returns the box left for content.
 */
export function lcarsFrame(ctx: CanvasRenderingContext2D, w: number, h: number, opts: { title?: string; color?: string; seed?: number } = {}): { x: number; y: number; w: number; h: number } {
  const rnd = seeded(opts.seed ?? 4477);
  const color = opts.color ?? LCARS.orange;
  const bar = Math.round(Math.min(h * 0.07, 40));
  const side = Math.round(Math.min(w * 0.13, 150));
  const elbowEnd = w * 0.42;
  const r = side * 0.9;
  const inner = bar * 1.4;
  const gap = Math.max(4, Math.round(bar * 0.18));
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  // elbow
  const elbowBottom = h * 0.38;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, elbowBottom);
  ctx.lineTo(0, r);
  ctx.arc(r, r, r, Math.PI, (Math.PI * 3) / 2);
  ctx.lineTo(elbowEnd, 0);
  ctx.lineTo(elbowEnd, bar);
  ctx.lineTo(side + inner, bar);
  ctx.arc(side + inner, bar + inner, inner, (Math.PI * 3) / 2, Math.PI, true);
  ctx.lineTo(side, elbowBottom);
  ctx.closePath();
  ctx.fill();

  // top bar: a block or two, the title, then a round end
  ctx.font = `600 ${Math.round(bar * 1.25)}px ${LCARS_FONT}`;
  ctx.textBaseline = 'middle';
  const title = opts.title?.toUpperCase() ?? '';
  const titleW = title ? ctx.measureText(title).width + bar : 0;
  const end = w - bar * 1.6;
  let x = elbowEnd + gap;
  const blocksEnd = end - titleW - gap;
  while (x < blocksEnd - bar) {
    const bw = Math.min(blocksEnd - x, bar * (2 + rnd() * 5));
    ctx.fillStyle = PALETTE[Math.floor(rnd() * PALETTE.length)];
    ctx.fillRect(x, 0, bw, bar * 0.6);
    x += bw + gap;
  }
  if (title) {
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.fillText(title, end - gap, bar * 0.62);
  }
  ctx.fillStyle = color;
  pill(ctx, end, 0, bar * 1.6, bar * 0.6, { right: true });

  // left bar: numbered blocks down to a round end
  let y = elbowBottom + gap;
  ctx.font = `500 ${Math.round(bar * 0.6)}px ${LCARS_FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  while (y < h - side * 0.6) {
    const bh = Math.min(h - side * 0.6 - y, bar * (1.5 + rnd() * 3));
    ctx.fillStyle = PALETTE[Math.floor(rnd() * PALETTE.length)];
    ctx.fillRect(0, y, side, bh);
    if (bh > bar) {
      ctx.fillStyle = '#000000';
      ctx.fillText(`${10 + Math.floor(rnd() * 89)}-${1000 + Math.floor(rnd() * 8999)}`, side - 6, y + bh - 4);
    }
    y += bh + gap;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(side, y);
  ctx.lineTo(side, h - side / 2);
  ctx.arc(side / 2, h - side / 2, side / 2, 0, Math.PI);
  ctx.closePath();
  ctx.fill();

  const pad = bar * 0.8;
  return { x: side + pad, y: bar + pad, w: w - side - pad * 2, h: h - bar - pad * 2 };
}

/**
 * An LCARS door or wall sign: a black plate between two coloured end caps. `code` goes in the right cap,
 * the way a starship numbers its doors.
 */
export function lcarsSign(text: string, opts: { color?: string; sub?: string; code?: string; w?: number; h?: number } = {}): THREE.CanvasTexture {
  const w = opts.w ?? 1024;
  const h = opts.h ?? 200;
  const color = opts.color ?? LCARS.orange;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, h / 2);
  ctx.fill();
  const pad = h * 0.1;
  const capH = h - pad * 2;
  ctx.fillStyle = color;
  pill(ctx, pad, pad, h * 0.55, capH, { left: true });
  ctx.font = `600 ${Math.round(h * 0.26)}px ${LCARS_FONT}`;
  const codeW = opts.code ? ctx.measureText(opts.code.toUpperCase()).width + h * 0.45 : h * 0.35;
  ctx.fillStyle = lighten(color, 0.2);
  pill(ctx, w - pad - codeW, pad, codeW, capH, { right: true });
  if (opts.code) {
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(opts.code.toUpperCase(), w - pad - h * 0.28, h - pad * 1.6);
  }
  // a thin rail above and below the text, LCARS-style
  const left = pad + h * 0.55 + pad;
  const right = w - pad * 2 - codeW;
  ctx.fillRect(left, pad, right - left, h * 0.05);
  ctx.fillRect(left, h - pad - h * 0.05, (right - left) * 0.4, h * 0.05);

  const maxW = right - left - pad * 2;
  ctx.fillStyle = lighten(color, 0.15);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = opts.sub ? h * 0.42 : h * 0.55;
  const font = (px: number) => `600 ${px}px ${LCARS_FONT}`;
  ctx.font = font(size);
  const label = text.toUpperCase();
  while (size > 12 && ctx.measureText(label).width > maxW) ctx.font = font((size *= 0.92));
  const cx = (left + right) / 2;
  ctx.fillText(fitText(ctx, label, maxW), cx, opts.sub ? h * 0.4 : h / 2);
  if (opts.sub) {
    ctx.fillStyle = LCARS.peach;
    ctx.font = `500 ${Math.round(Math.min(h * 0.2, size * 0.55))}px ${LCARS_FONT}`;
    ctx.fillText(fitText(ctx, opts.sub.toUpperCase(), maxW), cx, h * 0.73);
  }
  return canvasTexture(canvas);
}

/** A wall console of LCARS readouts, for a corridor wall. Faces +Z in its local frame. */
export function lcarsConsole(w: number, h: number, seed: number): THREE.Group {
  const res = 512;
  const { canvas, ctx } = makeCanvas(res, Math.round((res * h) / w));
  const rnd = seeded(seed * 7919);
  const color = PALETTE[seed % PALETTE.length];
  const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: `${['OPS', 'ENG', 'SCI', 'NAV', 'COMMS', 'EPS'][seed % 6]} ${seed + 3}`, color, seed });
  // readouts: rows of numbers with the odd coloured gauge
  const rowH = 22;
  ctx.font = `500 16px ${LCARS_FONT}`;
  ctx.textBaseline = 'middle';
  for (let y = area.y + rowH / 2; y < area.y + area.h - rowH / 2; y += rowH) {
    if (rnd() < 0.3) {
      ctx.fillStyle = PALETTE[Math.floor(rnd() * PALETTE.length)];
      pill(ctx, area.x, y - 6, area.w * (0.2 + rnd() * 0.7), 12, { left: true, right: true });
      continue;
    }
    let x = area.x;
    while (x < area.x + area.w - 40) {
      ctx.fillStyle = rnd() < 0.15 ? LCARS.red : rnd() < 0.5 ? LCARS.peach : LCARS.sky;
      ctx.textAlign = 'left';
      const n = String(Math.floor(rnd() * 99999)).padStart(1 + Math.floor(rnd() * 5), '0');
      ctx.fillText(n, x, y);
      x += ctx.measureText(n).width + 10 + rnd() * 12;
    }
  }
  const g = new THREE.Group();
  g.add(box(w + 0.12, h + 0.12, 0.04, HULL.frame, 0, -h / 2 - 0.06, -0.02));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat(canvasTexture(canvas)));
  screen.position.z = 0.002;
  g.add(screen);
  return g;
}

function roundedRect(w: number, h: number, r: number): THREE.Path {
  const p = new THREE.Path();
  p.moveTo(-w / 2 + r, -h / 2);
  p.lineTo(w / 2 - r, -h / 2);
  p.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  p.lineTo(w / 2, h / 2 - r);
  p.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  p.lineTo(-w / 2 + r, h / 2);
  p.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  p.lineTo(-w / 2, -h / 2 + r);
  p.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return p;
}

/** A flat ring between two rounded rectangles, `depth` deep and facing +Z. */
function ring(w: number, h: number, border: number, depth: number, color: string): THREE.Mesh {
  const r = Math.min(w, h) * 0.18;
  const shape = new THREE.Shape(roundedRect(w + border * 2, h + border * 2, r + border).getPoints(6));
  shape.holes.push(roundedRect(w, h, r));
  return new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 }), toon(color));
}

/**
 * A viewport onto space: a rounded port in a thick bulkhead surround, with a sill below. Its back is centred on its
 * origin and it faces +Z, so mount it on a wall's face.
 */
export function viewport(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(roundedRect(w, h, Math.min(w, h) * 0.18).getPoints(6))), viewportGlass);
  glass.position.z = 0.005;
  g.add(glass);
  g.add(ring(w, h, 0.05, 0.06, HULL.dado));
  g.add(ring(w + 0.1, h + 0.1, 0.18, 0.1, HULL.frame));
  g.add(box(w * 0.8, 0.07, 0.16, HULL.frame, 0, -h / 2 - 0.3, 0.08));
  g.add(box(w * 0.3, 0.035, 0.012, LCARS.orange, -w * 0.2, -h / 2 - 0.22, 0.1));
  return g;
}

/**
 * How close (horizontally) someone must be for a door to open; it shuts again once they're a little further off.
 * Under HALL_HALF, so walking down the middle of the corridor doesn't open every door you pass.
 */
const DOOR_SENSOR = { open: 1.75, close: 2.05 };

/** A pair of sliding doors filling a doorway, opening as you come near. Built in world coordinates. */
export class SlidingDoors {
  readonly group = new THREE.Group();
  private readonly leaves: THREE.Group[] = [];
  private open = 0;
  private target = 0;

  /** `along` is the doorway's axis; `at` is its centre on the floor. */
  constructor(
    private readonly at: THREE.Vector3,
    along: 'x' | 'z',
    private readonly width: number,
    height: number,
  ) {
    this.group.position.copy(at);
    if (along === 'z') this.group.rotation.y = Math.PI / 2;
    for (const s of [-1, 1]) {
      const leaf = new THREE.Group();
      const w = width / 2;
      leaf.add(box(w, height, 0.08, HULL.door, (s * w) / 2, 0, 0));
      leaf.add(box(w, 0.14, 0.1, HULL.dado, (s * w) / 2, height * 0.42, 0));
      leaf.add(box(0.05, height, 0.1, HULL.frame, s * 0.025, 0, 0)); // the seam where the leaves meet
      this.leaves.push(leaf);
      this.group.add(leaf);
    }
  }

  update(eye: THREE.Vector3, dt: number): void {
    // the gap between the two distances stops a door stuttering open and shut when you stand at the edge
    const distance = Math.hypot(eye.x - this.at.x, eye.z - this.at.z);
    const target = distance < DOOR_SENSOR.open ? 1 : distance > DOOR_SENSOR.close ? 0 : this.target;
    if (target !== this.target) sound.door(target === 1, this.at);
    this.target = target;
    if (target === this.open) return;
    this.open = target > this.open ? Math.min(1, this.open + dt * 3.5) : Math.max(0, this.open - dt * 2.5);
    const slide = (this.width / 2 + 0.02) * (1 - (1 - this.open) ** 2);
    // fully open, the leaves are tucked inside the wall, but their outlines would still show through the jamb
    this.group.visible = this.open < 1;
    this.leaves.forEach((leaf, i) => (leaf.position.x = (i === 0 ? -1 : 1) * slide));
  }
}
