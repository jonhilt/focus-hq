import { roundRect, UI_FONT } from './canvas';
import type { RailMap, RailTrack, StopState } from './railMap';
import { LCARS, LCARS_STATUS } from './starship';

// The rail map (railMap.ts) drawn on the transporter room's tactical display: the lead on the left, a line fanning out
// into a track per item, a station per phase with each track's stop on it, the tracks merging into one line between
// sections and, on the right, the report going back to the lead. A track lights in each phase's colour as far as its item
// has got, green once it's through, and red where it failed, its line ending at a buffer stop. Flat and plain, not
// LCARS: it's a diagram to read across the room.

const BG = '#0c0f16';
const DIM = '#3a4152';
const TEXT = '#e8eaf0';
const MUTED = '#8b93a7';
const THROUGH = LCARS_STATUS.done;
const FAILED = '#ff6b6b';

/** The canvas's layout (px of a 1440 × 800 canvas): where the trunk runs, the lead and report sit, and how far tracks fan. */
const L = { trunk: 450, lead: 74, report: 1366, fan: 70, spread: 470, gap: 110, line: 10, bundle: 24 };

export interface RailHeader {
  name: string;
  /** What it says under the name: how many at work, done and failed. */
  counts: string;
  clock: string;
  /** What E on the screen does, in its bottom corner. */
  hint: string;
}

export function drawRailMap(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, map: RailMap, header: RailHeader): void {
  const { width: w, height: h } = canvas;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = TEXT;
  ctx.font = `600 48px ${UI_FONT}`;
  ctx.fillText(header.name, 44, 76);
  ctx.fillStyle = MUTED;
  ctx.font = `500 28px ${UI_FONT}`;
  ctx.fillText(header.counts, 44, 118);
  ctx.textAlign = 'right';
  ctx.font = `500 34px ${UI_FONT}`;
  ctx.fillText(header.clock, w - 44, 76);
  ctx.font = `500 22px ${UI_FONT}`;
  ctx.fillText(header.hint, w - 44, h - 30);

  // the lead
  disc(ctx, L.lead, L.trunk, 32, TEXT);
  ctx.fillStyle = BG;
  ctx.font = `700 18px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('LEAD', L.lead, L.trunk + 6);

  // each section a share of the width by how many stations it has, its tracks fanning out and merging back
  const units = map.sections.map((s) => 2 * L.fan + 230 * Math.max(1, s.stations.length));
  const scale = (L.report - L.lead - 80) / Math.max(1, units.reduce((a, b) => a + b, 0));
  let x = L.lead + 40;
  const line = (from: number, to: number, colour: string, width: number) => stroke(ctx, L.trunk, L.trunk, from, to, colour, width);
  line(L.lead + 30, x, TEXT, L.line);
  map.sections.forEach((section, si) => {
    const width = (units[si] ?? 0) * scale;
    const fan = L.fan * scale;
    const a = x, b = x + fan, e = x + width - fan, z = x + width;
    const stations = section.stations.map((_, i) => b + ((e - b) * (i + 0.5)) / section.stations.length);
    const n = section.tracks.length;
    const gap = n > 1 ? Math.min(L.gap, L.spread / (n - 1)) : 0;
    const ys = section.tracks.map((_, i) => L.trunk + (i - (n - 1) / 2) * gap);
    const top = n ? Math.min(...ys) : L.trunk, bottom = n ? Math.max(...ys) : L.trunk;
    const bundled = section.tracks.some((tr) => tr.bundle);
    section.stations.forEach((st, i) => {
      const c = LCARS[st.colour];
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = c;
      roundRect(ctx, (stations[i] ?? 0) - 46, top - 56, 92, bottom - top + 112, 46);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c;
      ctx.font = `700 30px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(st.title.toUpperCase(), stations[i] ?? 0, top - (bundled ? 90 : 70));
    });
    if (!n) line(a, z, DIM, L.line);
    section.tracks.forEach((track, ti) => drawTrack(ctx, track, { a, b, e, z, y: ys[ti] ?? L.trunk, stations, colours: section.stations.map((s) => LCARS[s.colour]) }));
    x = z;
  });
  // the report back to the lead
  const finished = map.status !== 'running';
  const end = map.status === 'failed' ? FAILED : THROUGH;
  line(x, L.report - 30, finished ? end : DIM, L.line);
  ctx.beginPath();
  ctx.arc(L.report, L.trunk, 30, 0, Math.PI * 2);
  ctx.fillStyle = finished ? end : BG;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = finished ? end : DIM;
  ctx.stroke();
  ctx.fillStyle = finished ? end : MUTED;
  ctx.font = `500 22px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(finished ? (map.status === 'failed' ? 'failed' : 'report sent') : 'to the lead', L.report - 6, L.trunk + 66);
}

interface Span {
  /** Where the track leaves the trunk, reaches its own line, leaves it and rejoins the trunk (x). */
  a: number;
  b: number;
  e: number;
  z: number;
  y: number;
  stations: number[];
  colours: string[];
}

function drawTrack(ctx: CanvasRenderingContext2D, track: RailTrack, s: Span): void {
  const width = track.bundle ? L.bundle : L.line;
  const draw = (from: number, to: number, colour: string) => stroke(ctx, L.trunk, s.y, from, to, colour, width, s);
  draw(s.a, s.z, DIM);
  // lit as far as its item has got: each stretch in the colour of the station it leads to, red where it failed
  let from = s.a;
  for (const [i, stop] of track.stops.entries()) {
    if (track.failedAt >= 0 && i > track.failedAt) break;
    if (stop.state === 'none' || stop.state === 'queued') break;
    draw(from, s.stations[i] ?? from, i === track.failedAt ? FAILED : (s.colours[i] ?? TEXT));
    from = s.stations[i] ?? from;
  }
  if (track.through) draw(from, s.z, THROUGH);
  for (const [i, stop] of track.stops.entries()) {
    if (track.failedAt >= 0 && i > track.failedAt) break;
    drawStop(ctx, stop.state, s.stations[i] ?? 0, s.y, s.colours[i] ?? TEXT, track.bundle);
    if (track.bundle) drawDots(ctx, stop.agents, s.stations[i] ?? 0, s.y, s.colours[i] ?? TEXT);
  }
  if (!track.bundle) {
    ctx.fillStyle = track.failedAt >= 0 ? FAILED : track.through ? THROUGH : '#cfd5e3';
    ctx.font = `600 26px ${UI_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, track.item, s.e - s.b - 20), s.b + 4, s.y - 18);
  }
  if (track.failedAt >= 0) {
    const fx = (s.stations[track.failedAt] ?? 0) + 44;
    ctx.strokeStyle = FAILED;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(fx, s.y - 16);
    ctx.lineTo(fx, s.y + 16);
    ctx.stroke();
  }
}

function drawStop(ctx: CanvasRenderingContext2D, state: StopState, x: number, y: number, colour: string, bundle: boolean): void {
  const r = bundle ? 22 : 16;
  if (state === 'working') {
    // at work: a lozenge in a halo, like a train standing at the platform
    ctx.globalAlpha = 0.3;
    disc(ctx, x, y, r * 2.2, colour);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colour;
    ctx.strokeStyle = BG;
    ctx.lineWidth = 4;
    roundRect(ctx, x - r * 2, y - r, r * 4, r * 2, r);
    ctx.fill();
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = state === 'done' ? colour : state === 'failed' ? FAILED : BG;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = state === 'done' ? colour : state === 'failed' ? FAILED : DIM;
  ctx.stroke();
}

/** A bundle's agents at a station: a dot each over the line (a bar of them past a hundred), and the count under it. */
function drawDots(ctx: CanvasRenderingContext2D, agents: readonly string[], x: number, y: number, colour: string): void {
  if (!agents.length) return;
  const shade = (s: string) => (s === 'done' ? colour : s === 'failed' ? FAILED : s === 'working' ? TEXT : DIM);
  const across = 360;
  const step = across / Math.max(1, agents.length);
  agents.forEach((s, i) => {
    ctx.fillStyle = shade(s);
    if (step >= 6) disc(ctx, x - across / 2 + step * (i + 0.5), y - 54, Math.min(8, step * 0.38), ctx.fillStyle);
    else ctx.fillRect(x - across / 2 + step * i, y - 60, Math.max(1, step), 12);
  });
  const done = agents.filter((s) => s === 'done').length;
  const failed = agents.filter((s) => s === 'failed').length;
  ctx.fillStyle = MUTED;
  ctx.font = `500 24px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${agents.length} · ${done} ✓${failed ? ` · ${failed} ✗` : ''}`, x, y + 60);
}

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** A stretch of track from x `from` to `to`, curving out of the trunk into its own line and back. */
function stroke(ctx: CanvasRenderingContext2D, trunk: number, y: number, from: number, to: number, colour: string, width: number, s?: Span): void {
  const at = (x: number) => (!s ? y : x < s.b ? trunk + (y - trunk) * smooth((x - s.a) / (s.b - s.a)) : x > s.e ? y + (trunk - y) * smooth((x - s.e) / (s.z - s.e)) : y);
  if (to <= from) return;
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from, at(from));
  for (let x = from + 4; x < to; x += 4) ctx.lineTo(x, at(x));
  ctx.lineTo(to, at(to));
  ctx.stroke();
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string | CanvasGradient | CanvasPattern): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`…${s}`).width > width) s = s.slice(1);
  return `…${s}`;
}
