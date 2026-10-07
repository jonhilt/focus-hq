import { describe, expect, it } from 'vitest';
import { screenPanes } from './screenPanes';

const panes = (width: number, browser: boolean, progress: boolean) => screenPanes(width, { browser, progress }).map((p) => `${p.pane}@${p.x}+${p.w}`);

describe('screenPanes', () => {
  it('gives the terminal the whole screen when there is nothing else to show', () => {
    expect(panes(800, false, false)).toEqual(['terminal@0+800']);
  });

  it('puts the browser or the progress pane beside the terminal', () => {
    expect(panes(800, true, false)).toEqual(['terminal@0+400', 'browser@400+400']);
    expect(panes(800, false, true)).toEqual(['terminal@0+528', 'progress@528+272']);
  });

  it('fits all three on a wide screen, and lets the browser win on a small one', () => {
    expect(panes(1250, true, true)).toEqual(['terminal@0+500', 'browser@500+438', 'progress@938+312']);
    expect(panes(800, true, true)).toEqual(['terminal@0+400', 'browser@400+400']);
  });

  it('shows a lead’s artifact instead of their browser, with the most room', () => {
    const layout = (width: number, browser: boolean, progress: boolean) =>
      screenPanes(width, { browser, artifact: true, progress }).map((p) => `${p.pane}@${p.x}+${p.w}`);
    expect(layout(1280, true, true)).toEqual(['terminal@0+384', 'artifact@384+576', 'progress@960+320']);
    expect(layout(1280, false, false)).toEqual(['terminal@0+512', 'artifact@512+768']);
    expect(layout(800, false, true)).toEqual(['terminal@0+320', 'artifact@320+480']);
  });

  it('always fills the screen exactly', () => {
    for (const width of [640, 800, 999, 1000, 1250, 1601]) {
      for (const [b, a, p] of [[true, false, true], [true, false, false], [false, false, true], [false, false, false], [true, true, true], [false, true, false]]) {
        const layout = screenPanes(width, { browser: b, artifact: a, progress: p });
        expect(layout.reduce((sum, at) => sum + at.w, 0)).toBe(width);
        layout.forEach((at, i) => expect(at.x).toBe(i ? layout[i - 1].x + layout[i - 1].w : 0));
      }
    }
  });
});
