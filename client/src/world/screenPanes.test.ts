import { describe, expect, it } from 'vitest';
import type { Agent } from '../../../shared/types';
import { paneAt, paneUse, screenPanes } from './screenPanes';

const H = 600;
const layout = (width: number, has: { browser: boolean; artifact?: boolean; progress: boolean }) =>
  screenPanes(width, H, has).map((p) => `${p.pane}@${p.x}+${p.w}` + (p.y || p.h !== H ? `,${p.y}+${p.h}` : ''));
const panes = (width: number, browser: boolean, progress: boolean) => layout(width, { browser, progress });

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

  it('gives a lead’s artifact the most room', () => {
    expect(layout(1280, { browser: false, artifact: true, progress: true })).toEqual(['terminal@0+384', 'artifact@384+576', 'progress@960+320']);
    expect(layout(1280, { browser: false, artifact: true, progress: false })).toEqual(['terminal@0+512', 'artifact@512+768']);
    expect(layout(800, { browser: false, artifact: true, progress: true })).toEqual(['terminal@0+320', 'artifact@320+480']);
  });

  it('shows a lead’s artifact and their browser both, the artifact over the browser', () => {
    expect(layout(1280, { browser: true, artifact: true, progress: true }))
      .toEqual(['terminal@0+384', 'artifact@384+576,0+348', 'browser@384+576,348+252', 'progress@960+320']);
    expect(layout(800, { browser: true, artifact: true, progress: true })).toEqual(['terminal@0+320', 'artifact@320+480,0+348', 'browser@320+480,348+252']);
  });

  it('puts a lead’s artifact and their browser side by side on a viewscreen', () => {
    expect(layout(1920, { browser: true, artifact: true, progress: true }))
      .toEqual(['terminal@0+461', 'artifact@461+595', 'browser@1056+518', 'progress@1574+346']);
    expect(layout(1920, { browser: true, artifact: true, progress: false })).toEqual(['terminal@0+576', 'artifact@576+730', 'browser@1306+614']);
  });

  it('always fills the screen exactly', () => {
    for (const width of [640, 800, 999, 1000, 1250, 1601, 1920]) {
      for (const [browser, artifact, progress] of [[true, false, true], [true, false, false], [false, false, true], [false, false, false], [true, true, true], [false, true, false], [true, true, false]]) {
        const at = screenPanes(width, H, { browser, artifact, progress });
        const area = at.reduce((sum, p) => sum + p.w * p.h, 0);
        expect(area).toBe(width * H);
        for (const p of at) expect(p.x + p.w <= width && p.y + p.h <= H).toBe(true);
      }
    }
  });
});

describe('paneAt', () => {
  const at = screenPanes(1280, H, { browser: true, artifact: true, progress: true });

  it('finds the pane under a point, the artifact or the browser by height', () => {
    expect(paneAt(at, 10, 10)).toBe('terminal');
    expect(paneAt(at, 600, 100)).toBe('artifact');
    expect(paneAt(at, 600, 500)).toBe('browser');
    expect(paneAt(at, 1279, 599)).toBe('progress');
  });

  it('finds nothing off the panes', () => {
    expect(paneAt(at, -1, 10)).toBeUndefined();
    expect(paneAt(at, 1280, 10)).toBeUndefined();
    expect(paneAt(at, 10, H)).toBeUndefined();
  });
});

describe('paneUse', () => {
  const lead = (over: Partial<NonNullable<Agent['lead']>> = {}) =>
    ({ id: 'lead_p1_a', name: 'Tendi', task: 'lead', lead: { title: 'Goal', slice: 1, ...over } }) as unknown as Agent;

  it('opens what the lead has shown up close from the artifacts pane', () => {
    const use = paneUse('artifact', lead());
    expect(use.interaction).toEqual({ kind: 'screen', id: 'lead_p1_a' });
    expect(use.label()).toBe('Look at what Tendi has shown up close');
  });

  it('asks you to answer from the artifacts pane while a question waits', () => {
    const asking = lead({ questions: [{ id: 'q1', question: 'Which?', options: [], at: 0 }] });
    expect(paneUse('artifact', asking).label()).toBe('Answer Tendi’s question');
  });

  it('opens the lead’s panel on the browser from the browser pane', () => {
    expect(paneUse('browser', lead()).interaction).toEqual({ kind: 'agent', id: 'lead_p1_a', view: 'browser' });
  });

  it('opens the tasks from the progress pane', () => {
    expect(paneUse('progress', lead()).interaction).toEqual({ kind: 'agent', id: 'lead_p1_a', view: 'tasks' });
  });

  it('opens the lead’s panel from the terminal', () => {
    expect(paneUse('terminal', lead()).interaction).toEqual({ kind: 'agent', id: 'lead_p1_a' });
  });
});
