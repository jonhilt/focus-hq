import { describe, expect, it } from 'vitest';
import { bandHeights, chartKey, chartLayout, FRAME, starRadius } from './chartLayout';
import { type Miniature, miniature } from './miniature';
import { MAP } from './views.test';

const W = 1280;
const H = 800;

/** Two bands: a, b and c along the top, d below. */
const mini: Miniature = {
  bands: [{ layer: 'Client', colour: '#8fd3ff' }, { layer: 'Server', colour: '#c9a0ff' }],
  parts: [
    { key: 'r#a', label: 'A', band: 0, at: 0.5, size: 1, bright: 1, colour: '#8fd3ff' },
    { key: 'r#b', label: 'B', band: 0, at: 1 / 6, size: 0, bright: 0, colour: '#8fd3ff' },
    { key: 'r#c', label: 'C', band: 0, at: 5 / 6, size: 0.5, bright: 0.5, colour: '#8fd3ff' },
    { key: 'r#d', label: 'D', band: 1, at: 0.5, size: 0.5, bright: 1, colour: '#c9a0ff' },
  ],
  links: [{ from: 0, to: 3, imports: 28 }, { from: 1, to: 2, imports: 7 }],
  imports: 5,
};

describe('bandHeights', () => {
  it('spaces the bands evenly from the top of the chart to its bottom, one band in the middle', () => {
    const [top, , bottom] = bandHeights(3, H);
    expect(top).toBe(FRAME.bar + FRAME.top);
    expect(bottom).toBe(H - FRAME.bar - FRAME.top);
    expect(bandHeights(3, H)[1]).toBe((top + bottom) / 2);
    expect(bandHeights(1, H)).toEqual([H / 2]);
    expect(bandHeights(0, H)).toEqual([]);
  });
});

describe('chartKey', () => {
  it('says how to read the chart and how many imports it draws, or just what it is when nothing is mapped', () => {
    expect(chartKey(mini)).toBe('BAND: LAYER · SIZE: FILES · BRIGHTNESS: COMMITS · LINES: THE 2 HEAVIEST OF 5 IMPORTS');
    expect(chartKey(miniature([]))).toBe('ARCHITECTURE');
  });
});

describe('chartLayout', () => {
  const layout = chartLayout(mini, W, H);
  const star = (label: string) => layout.stars.find((s) => s.label === label);

  it('stands each star on its band, along it by its place, within the frame', () => {
    expect(layout.bands.map((b) => b.y)).toEqual(bandHeights(2, H));
    expect(star('A')?.y).toBe(layout.bands[0].y);
    expect(star('D')?.y).toBe(layout.bands[1].y);
    expect(star('B')?.x).toBeLessThan(star('A')?.x ?? 0);
    expect(star('A')?.x).toBeLessThan(star('C')?.x ?? 0);
    for (const s of layout.stars) {
      expect(s.x).toBeGreaterThan(FRAME.left);
      expect(s.x).toBeLessThan(W - FRAME.right);
    }
  });

  it('sizes a star by its code and lights it by its commits, never quite out', () => {
    expect(star('A')?.r).toBe(starRadius(1));
    expect(star('B')?.r).toBe(starRadius(0));
    expect(star('A')?.alpha).toBe(1);
    expect(star('B')?.alpha).toBe(0.35);
  });

  it('names stars below and above by turns along a band, each name as wide as two stars’ room', () => {
    // along the top band: B, A, C
    expect(star('B')?.labelY).toBeGreaterThan(star('B')?.y ?? 0);
    expect(star('A')?.labelY).toBeLessThan(star('A')?.y ?? 0);
    expect(star('C')?.labelY).toBeGreaterThan(star('C')?.y ?? 0);
    expect(star('B')?.room).toBeLessThan(star('D')?.room ?? 0);
  });

  it('draws the lightest line first, as thick as its imports, bending halfway down or arching over its own band', () => {
    const [light, heavy] = layout.lines;
    expect(light.width).toBeLessThan(heavy.width);
    expect(heavy.bend).toBe((layout.bands[0].y + layout.bands[1].y) / 2);
    expect(light.bend).toBeLessThan(layout.bands[0].y);
  });

  it('lays out nothing when nothing is mapped', () => {
    expect(chartLayout(miniature([]), W, H)).toEqual({ key: 'ARCHITECTURE', bands: [], stars: [], lines: [] });
  });

  it('lays out a real map: a star for every part', () => {
    expect(chartLayout(miniature([MAP]), W, H).stars).toHaveLength(3);
  });
});
