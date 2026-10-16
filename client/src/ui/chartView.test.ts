import { describe, expect, it } from 'vitest';
import { close, closer, home, kept, panBy, wheelZoom, whole, ZOOM, zoomAbout, zoomOn } from './chartView';

const world = { width: 900, height: 560 };

describe('the chart in view', () => {
  it('zooms about the point under the pointer, which stays where it was on the screen', () => {
    const v = whole(world);
    const at = { x: 300, y: 200 };
    const z = zoomAbout(world, v, at, 2);
    expect(closer(z)).toBeCloseTo(2);
    // the share of the way across the view the point lies is the same before and after
    expect((at.x - z.x) / z.w).toBeCloseTo((at.x - v.x) / v.w);
    expect((at.y - z.y) / z.h).toBeCloseTo((at.y - v.y) / v.h);
  });

  it('goes no further out than the whole chart nor further in than it should', () => {
    expect(zoomAbout(world, whole(world), { x: 450, y: 280 }, 0.2)).toEqual(whole(world));
    expect(closer(zoomAbout(world, whole(world), { x: 450, y: 280 }, 100))).toBeCloseTo(ZOOM.most);
  });

  it('drags with the pointer, but not off the chart', () => {
    const v = zoomAbout(world, whole(world), { x: 450, y: 280 }, 2);
    const moved = panBy(world, v, 50, -20);
    expect(moved.x).toBeCloseTo(v.x - 50);
    expect(moved.y).toBeCloseTo(v.y + 20);
    const far = panBy(world, v, -5000, -5000);
    expect(far.x + far.w).toBeCloseTo(world.width);
    expect(far.y + far.h).toBeCloseTo(world.height);
  });

  it('can be dragged out over what is drawn past the chart’s edge', () => {
    const v = zoomAbout(world, whole(world), { x: 0, y: 280 }, 2);
    expect(panBy(world, v, 5000, 0, { x0: -200, y0: 0, x1: 100, y1: 100 }).x).toBeCloseTo(-200);
  });

  it('keeps its shape however it is moved', () => {
    const v = kept(world, { x: 10, y: 10, w: 300, h: 50 });
    expect(v.w / v.h).toBeCloseTo(world.width / world.height);
  });

  it('shows the picked waypoint’s work in a column once it is about halfway in', () => {
    expect(close(whole(world))).toBe(false);
    expect(close(zoomAbout(world, whole(world), { x: 0, y: 0 }, 1.4))).toBe(true);
  });

  it('zooms to a waypoint and its column, fitting it all in', () => {
    const z = zoomOn(world, { x0: 400, y0: 200, x1: 400, y1: 200 });
    expect(closer(z)).toBeCloseTo(ZOOM.pick);
    const tall = zoomOn(world, { x0: 300, y0: 0, x1: 500, y1: 500 });
    expect(tall.h).toBeGreaterThanOrEqual(500);
  });

  it('pinches in finer steps than a mouse wheel turns', () => {
    expect(wheelZoom(-100, false)).toBeGreaterThan(1);
    expect(wheelZoom(100, false)).toBeLessThan(1);
    expect(Math.abs(Math.log(wheelZoom(-10, true)))).toBeGreaterThan(Math.abs(Math.log(wheelZoom(-10, false))));
  });

  it('opens a long voyage on its latest stretch, a frame’s worth, and zooms out as far as all of it', () => {
    const big = { width: 1800, height: 1120 };
    expect(home(world)).toEqual(whole(world));
    expect(home(big)).toEqual({ x: 900, y: 0, w: 900, h: 560 });
    expect(zoomAbout(big, home(big), { x: 1350, y: 280 }, 0.01)).toEqual(whole(big));
    // picking a waypoint zooms against the frame, not the whole of a long voyage
    expect(closer(zoomOn(big, { x0: 1000, y0: 500, x1: 1000, y1: 500 }))).toBeCloseTo(ZOOM.pick);
  });
});
