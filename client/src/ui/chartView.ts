// The part of a star chart in view, and how it moves as the captain zooms and drags it about, in the chart's units.
// Pure, so the chart panel only turns wheel turns, drags and keys into calls here.

import { type Box, CHART, type Pt } from './course';

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A chart's extent: what it's laid out over (`chartSize`: a long voyage's is bigger than the frame it's shown in). */
export interface World {
  width: number;
  height: number;
}

/** How far in the chart zooms on the waypoint picked, and at most when zoomed by hand, against `CHART`'s frame. */
export const ZOOM = { pick: 1.7, most: 4 } as const;

/** How much room (in the chart's units) to leave round what's zoomed to. */
export const MARGIN = 24;

/** The whole chart in view. */
export const whole = (world: World): View => ({ x: 0, y: 0, w: world.width, h: world.height });

/** Where the chart opens: the stretch of a long voyage nearest the objective (top right), a frame's worth; a short one whole. */
export const home = (world: World): View => ({ x: world.width - CHART.width, y: 0, w: CHART.width, h: CHART.height });

/** How many times closer than `CHART`'s frame a view is. */
export const closer = (v: View) => CHART.width / v.w;

/**
 * Close enough in for the picked waypoint's work to stand in a column round it (further out, every waypoint's is a
 * count): about halfway to where picking a waypoint zooms.
 */
export const close = (v: View) => closer(v) >= 1.3;

/**
 * Kept where there's something to see: no further out than the whole chart, no further in than `ZOOM.most`, the
 * frame's shape, and its middle on the chart (or on `extra`, what's drawn past its edge).
 */
export function kept(world: World, v: View, extra?: Box): View {
  const w = Math.max(CHART.width / ZOOM.most, Math.min(world.width, v.w));
  const h = (w * CHART.height) / CHART.width;
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  const x0 = Math.min(0, extra?.x0 ?? 0);
  const y0 = Math.min(0, extra?.y0 ?? 0);
  const x1 = Math.max(world.width, extra?.x1 ?? 0);
  const y1 = Math.max(world.height, extra?.y1 ?? 0);
  const mx = Math.max(x0 + w / 2, Math.min(x1 - w / 2, cx));
  const my = Math.max(y0 + h / 2, Math.min(y1 - h / 2, cy));
  return { x: mx - w / 2, y: my - h / 2, w, h };
}

/** `v` zoomed `by` times closer (less than 1 to zoom out), keeping `about` (in the chart's units) where it is on the screen. */
export function zoomAbout(world: World, v: View, about: Pt, by: number, extra?: Box): View {
  const w = Math.max(CHART.width / ZOOM.most, Math.min(world.width, v.w / by));
  const s = w / v.w;
  return kept(world, { x: about.x - (about.x - v.x) * s, y: about.y - (about.y - v.y) * s, w, h: v.h * s }, extra);
}

/** `v` dragged `dx`, `dy` (in the chart's units): what's under the pointer moves with it. */
export const panBy = (world: World, v: View, dx: number, dy: number, extra?: Box): View => kept(world, { ...v, x: v.x - dx, y: v.y - dy }, extra);

/**
 * The part of the chart in view zoomed in on `b` (the waypoint picked and its column): `ZOOM.pick` times closer than
 * the frame, unless it takes less to fit all of it in with a margin, centred on it, and kept on the chart unless `b` runs
 * past its edge.
 */
export function zoomOn(world: World, b: Box): View {
  const fits = Math.min(CHART.width / (b.x1 - b.x0 + MARGIN * 2), CHART.height / (b.y1 - b.y0 + MARGIN * 2));
  const k = Math.min(ZOOM.pick, Math.max(CHART.width / world.width, fits));
  const w = CHART.width / k;
  const h = CHART.height / k;
  const c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  const x = Math.max(Math.min(0, b.x0 - MARGIN), Math.min(Math.max(world.width, b.x1 + MARGIN) - w, c.x - w / 2));
  const y = Math.max(Math.min(0, b.y0 - MARGIN), Math.min(Math.max(world.height, b.y1 + MARGIN) - h, c.y - h / 2));
  return { x, y, w, h };
}

/** How far a wheel turn zooms: a trackpad's pinch (which comes as a wheel with Ctrl held) in finer steps than a mouse's. */
export const wheelZoom = (deltaY: number, pinch: boolean) => Math.exp(-deltaY * (pinch ? 0.01 : 0.0015));
