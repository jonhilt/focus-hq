import * as THREE from 'three';
import type { AgentStatus } from '../../../shared/types';
import { sound } from '../sound';
import { canvasTexture, fitText, makeCanvas, roundRect } from './canvas';
import { box, flat, lighten, toon } from './materials';
import { cyl, seatBack } from './props';

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

/** An agent's status as an LCARS colour, for speech bubbles, station displays and the board. Matches the DOM UI's styles.css. */
export const LCARS_STATUS: Record<AgentStatus, string> = {
  queued: '#8d86a0',
  'setting-up': LCARS.sky,
  working: LCARS.periwinkle,
  testing: LCARS.lilac,
  waiting: LCARS.gold,
  pushing: LCARS.orange,
  // not on the ship's walls: green keeps "done" and "passing" from reading as just another blue (--lcars-green)
  done: '#99cc66',
  error: LCARS.red,
  stopped: '#8d86a0',
};

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

/** LCARS readouts for a w×h panel: rows of numbers under a frame titled after a ship's system. */
export function readoutTexture(w: number, h: number, seed: number): THREE.CanvasTexture {
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
  return canvasTexture(canvas);
}

/** Each LCARS console station's two colours, its keys mostly the first. */
const CONSOLE_SCHEMES = [
  [LCARS.orange, LCARS.peach],
  [LCARS.lilac, LCARS.periwinkle],
  [LCARS.gold, LCARS.peach],
  [LCARS.periwinkle, LCARS.sky],
];

/**
 * An LCARS console top, w×h metres, as the Okudagrams on a starship's consoles are: a station for each of
 * `stations` crew side by side, each an elbow sweeping from a labelled bar along the back edge (the canvas's top)
 * into a numbered bar down its left, framing a block of numbered keys and a small display.
 */
export function consoleTexture(w: number, h: number, seed: number, stations = 1): THREE.CanvasTexture {
  const perMetre = 700;
  const W = Math.min(4096, Math.round(w * perMetre));
  const H = Math.round(h * perMetre);
  const { canvas, ctx } = makeCanvas(W, H);
  const rnd = seeded(seed * 104729);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  const gap = Math.max(4, Math.round(H * 0.03));
  const bar = Math.round(H * 0.1);
  const side = Math.round(H * 0.15);
  const inner = bar;
  const number = () => `${Math.floor(rnd() * 90) + 10}`;
  const sw = W / stations;
  for (let s = 0; s < stations; s++) {
    const [main, second] = CONSOLE_SCHEMES[Math.floor(rnd() * CONSOLE_SCHEMES.length)];
    const x0 = s * sw + gap * 3;
    const x1 = (s + 1) * sw - gap * 3;
    const elbowBottom = H * 0.48;
    // the elbow
    ctx.fillStyle = main;
    ctx.beginPath();
    ctx.moveTo(x0, elbowBottom);
    ctx.lineTo(x0, side);
    ctx.arc(x0 + side, side, side, Math.PI, (Math.PI * 3) / 2);
    ctx.lineTo(x0 + side * 3, 0);
    ctx.lineTo(x0 + side * 3, bar);
    ctx.lineTo(x0 + side + inner, bar);
    ctx.arc(x0 + side + inner, bar + inner, inner, (Math.PI * 3) / 2, Math.PI, true);
    ctx.lineTo(x0 + side, elbowBottom);
    ctx.closePath();
    ctx.fill();
    // along the back: blocks, the station's name in a gap, and a round end
    ctx.font = `600 ${Math.round(bar * 1.1)}px ${LCARS_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const title = `${['OPS', 'CONN', 'ENG', 'SCI', 'TAC', 'EPS', 'NAV'][Math.floor(rnd() * 7)]} ${Math.floor(rnd() * 90) + 10}-${Math.floor(rnd() * 9000) + 1000}`;
    const titleW = ctx.measureText(title).width;
    const end = x1 - bar * 1.5;
    let x = x0 + side * 3 + gap;
    const titleAt = x + (end - x - titleW) * (0.3 + rnd() * 0.4);
    while (x < titleAt - gap * 2) {
      const bw = Math.min(titleAt - gap - x, bar * (1.5 + rnd() * 5));
      ctx.fillStyle = rnd() < 0.7 ? main : second;
      ctx.fillRect(x, 0, bw, bar);
      x += bw + gap;
    }
    ctx.fillStyle = main;
    ctx.fillText(title, titleAt, bar * 0.55);
    x = titleAt + titleW + gap;
    while (x < end - gap) {
      const bw = Math.min(end - gap - x, bar * (1.5 + rnd() * 5));
      ctx.fillStyle = rnd() < 0.7 ? main : second;
      ctx.fillRect(x, 0, bw, bar);
      x += bw + gap;
    }
    ctx.fillStyle = main;
    pill(ctx, end, 0, bar * 1.5, bar, { right: true });
    // down the left: numbered blocks to a round end
    ctx.font = `500 ${Math.round(bar * 0.6)}px ${LCARS_FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    let y = elbowBottom + gap;
    const foot = H - gap - side / 2;
    while (y < foot - bar) {
      const bh = Math.min(foot - y, bar * (1.2 + rnd() * 1.6));
      ctx.fillStyle = rnd() < 0.5 ? second : LCARS.red;
      ctx.fillRect(x0, y, side, bh);
      ctx.fillStyle = '#000000';
      ctx.fillText(`${Math.floor(rnd() * 900) + 100}`, x0 + side - 4, y + bh - 3);
      y += bh + gap;
    }
    ctx.fillStyle = second;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + side, y);
    ctx.lineTo(x0 + side, H - gap - side / 2);
    ctx.arc(x0 + side / 2, H - gap - side / 2, side / 2, 0, Math.PI);
    ctx.closePath();
    ctx.fill();

    // inside the frame: the keys, and a display to one side
    const top = bar + inner * 0.6 + gap;
    const left = x0 + side + inner * 0.6 + gap;
    const display = (x1 - left) * (0.26 + rnd() * 0.08);
    const keysLeft = rnd() < 0.5;
    const kx0 = keysLeft ? left : left + display + gap * 3;
    const kx1 = keysLeft ? x1 - display - gap * 3 : x1;
    const rows = 4;
    const kh = (H - gap - top - gap * (rows - 1)) / rows;
    ctx.font = `600 ${Math.round(kh * 0.36)}px ${LCARS_FONT}`;
    for (let r = 0; r < rows; r++) {
      const ky = top + r * (kh + gap);
      let kx = kx0;
      while (kx < kx1 - kh) {
        const kw = Math.min(kx1 - kx, kh * (1.2 + rnd() * 1.8));
        if (kx1 - kx - kw < kh) {
          // the row's last key runs to its end
          ctx.fillStyle = rnd() < 0.5 ? main : second;
          pill(ctx, kx, ky, kx1 - kx, kh, { right: true });
          break;
        }
        const pick = rnd();
        if (pick > 0.08) {
          ctx.fillStyle = pick < 0.6 ? main : pick < 0.93 ? second : LCARS.red;
          roundRect(ctx, kx, ky, kw, kh, kh * 0.08);
          ctx.fill();
          ctx.fillStyle = '#000000';
          ctx.fillText(number(), kx + kw - kh * 0.1, ky + kh - kh * 0.06);
        }
        kx += kw + gap;
      }
    }
    // the display: a frame round a bar graph, or a sweep of a sensor scan
    const dx0 = keysLeft ? kx1 + gap * 3 : left;
    const dw = display;
    const dh = H - gap - top;
    ctx.strokeStyle = second;
    ctx.lineWidth = Math.max(2, gap * 0.4);
    roundRect(ctx, dx0, top, dw, dh, gap);
    ctx.stroke();
    const pad = gap * 1.6;
    if (rnd() < 0.5) {
      const n = 7 + Math.floor(rnd() * 6);
      const bw = (dw - pad * 2) / n;
      for (let i = 0; i < n; i++) {
        const bh = (dh - pad * 2) * (0.2 + rnd() * 0.8);
        ctx.fillStyle = i === Math.floor(n * rnd()) ? LCARS.red : LCARS.sky;
        ctx.fillRect(dx0 + pad + i * bw + bw * 0.15, top + dh - pad - bh, bw * 0.7, bh);
      }
    } else {
      const cx = dx0 + dw / 2;
      const cy = top + dh / 2;
      const r = Math.min(dw, dh) / 2 - pad;
      ctx.strokeStyle = LCARS.sky;
      ctx.lineWidth = Math.max(1.5, gap * 0.25);
      for (const k of [1, 0.66, 0.33]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i ? LCARS.gold : LCARS.red;
        const a = rnd() * Math.PI * 2;
        const d = r * (0.2 + rnd() * 0.75);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, Math.max(3, gap * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return canvasTexture(canvas);
}

/** Long-range sensors: a scatter of stars (the same every time) and the course the ship has laid in across them. */
export function starChartTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(1280, 768);
  const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: 'Long-range sensors', color: LCARS.lilac, seed: 1864 });
  let seed = 1864;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = rand() > 0.85 ? LCARS.gold : '#e8e2f0';
    ctx.globalAlpha = 0.4 + rand() * 0.6;
    ctx.beginPath();
    ctx.arc(area.x + rand() * area.w, area.y + 40 + rand() * (area.h - 40), 1 + rand() * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const course: [number, number][] = [[0.06, 0.82], [0.3, 0.6], [0.52, 0.66], [0.74, 0.38], [0.92, 0.22]];
  const at = ([u, v]: [number, number]): [number, number] => [area.x + u * area.w, area.y + 40 + v * (area.h - 40)];
  ctx.strokeStyle = LCARS.orange;
  ctx.lineWidth = 4;
  ctx.setLineDash([16, 12]);
  ctx.beginPath();
  for (const [i, point] of course.entries()) ctx[i ? 'lineTo' : 'moveTo'](...at(point));
  ctx.stroke();
  ctx.setLineDash([]);
  for (const point of course) {
    const [x, y] = at(point);
    ctx.fillStyle = LCARS.orange;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = LCARS.peach;
  ctx.font = `600 40px ${LCARS_FONT}`;
  ctx.fillText('COURSE LAID IN', area.x, area.y);
  return canvasTexture(canvas);
}

/** Height of a workstation's touch panel at its front edge, where a seated crew member's hands rest. */
const CONSOLE_TOP = 0.72;
/** From the seat's centre to the touch panel's front edge: a seated Character's hands land just inside it. */
const REACH = 0.28;
const PANEL_DEPTH = 0.44;
const PANEL_SLOPE = 0.2;
const CONSOLE_WIDTH = 1.2;

let touchPanel: THREE.CanvasTexture | undefined;
let touchPanelMat: THREE.MeshBasicMaterial | undefined;

/** The LCARS touch surface every workstation shares: rows of coloured keys on black. */
function touchPanelMaterial(): THREE.MeshBasicMaterial {
  return (touchPanelMat ??= flat(touchPanelTexture()));
}

/** The touch surface's keys: a 512×192 canvas. */
export function touchPanelTexture(): THREE.CanvasTexture {
  if (touchPanel) return touchPanel;
  const w = 512;
  const h = 192;
  const { canvas, ctx } = makeCanvas(w, h);
  const rnd = seeded(1701);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  const gap = 8;
  const rows = 4;
  const rowH = (h - gap * (rows + 1)) / rows;
  for (let r = 0; r < rows; r++) {
    const y = gap + r * (rowH + gap);
    let x = gap;
    while (x < w - gap) {
      const last = w - gap - x < 110;
      const kw = last ? w - gap - x : 30 + rnd() * 60;
      ctx.fillStyle = PALETTE[Math.floor(rnd() * PALETTE.length)];
      if (last || rnd() > 0.12) pill(ctx, x, y, kw, rowH, { left: x === gap, right: last });
      x += kw + gap;
    }
  }
  return (touchPanel = canvasTexture(canvas));
}

/** A bridge-style seat on a pedestal, facing +X; a Character sits on it at the origin. */
export function stationSeat(upholstery: string): THREE.Group {
  const g = new THREE.Group();
  const foot = cyl(0.24, 0.28, 0.06, HULL.dado, 24);
  foot.position.y = 0.03;
  const column = cyl(0.07, 0.09, 0.34, HULL.frame);
  column.position.y = 0.23;
  const shell = cyl(0.29, 0.27, 0.06, HULL.frame, 24);
  shell.position.y = 0.41;
  const cushion = cyl(0.27, 0.27, 0.06, upholstery, 24);
  cushion.position.y = 0.47;
  g.add(foot, column, shell, cushion);
  // the back curves round the seat's edge, so it meets the seat all the way across rather than only in the middle,
  // leaning back from where it rises out of the shell
  const back = new THREE.Group();
  back.position.set(-0.28, 0.42, 0);
  back.rotation.z = 0.1;
  const curved = (r0: number, r1: number, spread: number, h: number, color: string, y: number) => {
    const mesh = new THREE.Mesh(seatBack(r0, r1, spread, h), toon(color));
    mesh.position.set(0.28, y, 0);
    return mesh;
  };
  back.add(curved(0.25, 0.32, 1.13, 0.66, HULL.frame, 0), curved(0.21, 0.26, 0.96, 0.54, upholstery, 0.08));
  g.add(back);
  // the arms on posts standing in the shell, their back ends buried in the back
  for (const s of [-1, 1]) {
    g.add(box(0.05, 0.18, 0.05, HULL.frame, -0.05, 0.44, s * 0.255));
    g.add(box(0.3, 0.05, 0.07, upholstery, -0.01, 0.62, s * 0.27));
  }
  return g;
}

/**
 * A TNG-style workstation with its seat: an LCARS touch panel sloping up to an upright display, on a sculpted
 * pedestal. Faces +X from the seat at the origin; seat a Character by adding it to `seat`. The screen mesh faces the
 * seat, ready for a StationScreen's material.
 */
export function workstation(screen: THREE.Material, accent: string): { group: THREE.Group; screen: THREE.Mesh; seat: THREE.Group } {
  const g = new THREE.Group();
  const seat = new THREE.Group();
  seat.add(stationSeat('#5c5470'));
  g.add(seat);
  // the console sits a little right of the seat, so whoever stands at its right shoulder can read the display
  const station = new THREE.Group();
  station.position.set(REACH, 0, 0.22);
  g.add(station);

  // the pedestal is a side profile swept across the console, cut away under the panel's overhang for the knees
  const under = CONSOLE_TOP - 0.04;
  const backX = PANEL_DEPTH * Math.cos(PANEL_SLOPE);
  const backY = under + PANEL_DEPTH * Math.sin(PANEL_SLOPE);
  const profile = new THREE.Shape();
  profile.moveTo(0.36, 0);
  profile.lineTo(0.66, 0);
  profile.lineTo(0.66, backY);
  profile.lineTo(backX, backY);
  profile.lineTo(0.02, under);
  profile.quadraticCurveTo(0.36, under, 0.36, under - 0.28);
  profile.closePath();
  const bodyW = CONSOLE_WIDTH - 0.24;
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: bodyW, bevelEnabled: false }), toon(HULL.bulkhead));
  body.position.z = -bodyW / 2;
  station.add(body);
  station.add(box(0.4, 0.08, CONSOLE_WIDTH - 0.14, HULL.dado, 0.51, 0, 0));
  station.add(box(0.02, 0.05, bodyW + 0.01, accent, 0.355, 0.3, 0));

  const panel = new THREE.Group();
  panel.position.y = under;
  panel.rotation.z = PANEL_SLOPE;
  panel.add(box(PANEL_DEPTH, 0.04, CONSOLE_WIDTH, '#2b2735', PANEL_DEPTH / 2, 0, 0));
  panel.add(box(0.05, 0.05, CONSOLE_WIDTH + 0.02, accent, 0, -0.005, 0));
  const keys = new THREE.Mesh(
    new THREE.PlaneGeometry(CONSOLE_WIDTH - 0.08, PANEL_DEPTH - 0.1).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2),
    touchPanelMaterial(),
  );
  keys.position.set(PANEL_DEPTH / 2 + 0.02, 0.044, 0);
  panel.add(keys);
  station.add(panel);

  // 800×512, like a StationScreen's canvas
  const dw = 0.94;
  const dh = 0.6;
  const display = new THREE.Group();
  display.position.set(backX + 0.02, backY, 0);
  display.rotation.z = -0.2; // leaning back
  display.add(box(0.07, dh + 0.1, dw + 0.1, HULL.frame, 0.035, 0, 0));
  display.add(box(0.08, 0.06, dw + 0.1, accent, 0.035, dh + 0.1, 0));
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(dw, dh), screen);
  plane.rotation.y = -Math.PI / 2;
  plane.position.set(-0.005, 0.05 + dh / 2, 0);
  display.add(plane);
  station.add(display);
  return { group: g, screen: plane, seat };
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

  /** `at` is the doorway's centre on the floor; the leaves slide along its local X, turned `yaw` about Y. Locked doors never open. */
  constructor(
    private readonly at: THREE.Vector3,
    yaw: number,
    private readonly width: number,
    height: number,
    private readonly locked = false,
  ) {
    this.group.position.copy(at);
    this.group.rotation.y = yaw;
    for (const s of [-1, 1]) {
      const leaf = new THREE.Group();
      const w = width / 2;
      leaf.add(box(w, height, 0.08, HULL.door, (s * w) / 2, 0, 0));
      leaf.add(box(w, 0.14, 0.1, HULL.dado, (s * w) / 2, height * 0.42, 0));
      // the seam where the leaves meet, a little deeper than the band across them so their faces don't fight
      leaf.add(box(0.05, height, 0.11, HULL.frame, s * 0.025, 0, 0));
      this.leaves.push(leaf);
      this.group.add(leaf);
    }
  }

  update(eye: THREE.Vector3, dt: number): void {
    if (this.locked) return;
    this.sense(Math.hypot(eye.x - this.at.x, eye.z - this.at.z), dt);
  }

  /** Whether they're open at all, so you can see through. */
  get ajar(): boolean {
    return this.open > 0;
  }

  /** Opens as someone `distance` away (horizontally) comes near, and shuts as they go. `quiet` doors make no sound. */
  sense(distance: number, dt: number, quiet = false): void {
    // the gap between the two distances stops a door stuttering open and shut when you stand at the edge
    const target = distance < DOOR_SENSOR.open ? 1 : distance > DOOR_SENSOR.close ? 0 : this.target;
    if (target !== this.target && !quiet) sound.door(target === 1, this.at);
    this.target = target;
    if (target === this.open) return;
    this.open = target > this.open ? Math.min(1, this.open + dt * 3.5) : Math.max(0, this.open - dt * 2.5);
    const slide = (this.width / 2 + 0.02) * (1 - (1 - this.open) ** 2);
    // fully open, the leaves are tucked inside the wall, but their outlines would still show through the jamb
    this.group.visible = this.open < 1;
    this.leaves.forEach((leaf, i) => (leaf.position.x = (i === 0 ? -1 : 1) * slide));
  }
}
