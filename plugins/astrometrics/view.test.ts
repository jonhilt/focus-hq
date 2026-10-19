import { describe, expect, it } from 'vitest';
import type { MachineRun } from '../../plugin-api/shared';
import type { Astrometrics, MachineLayout } from './shared';
import { drawDue, fit, pickedLayout, runsOf, screenView, tabs } from './view';

const layout = (id: string, title: string, runs: string): MachineLayout => ({ id, title, about: '', runs, width: 100, height: 50, states: [], edges: [] });
const run = (machine: string, key: string, state: string, projectId = 'p1'): MachineRun => ({ machine, key, label: key, projectId, state, seq: 1 });

const state: Astrometrics = {
  layouts: [layout('run', 'A crew member’s run', 'crew member'), layout('review', 'QA’s review', 'pull request')],
  runs: [run('run', 'a1', 'idle'), run('run', 'a2', 'turn.started'), run('run', 'b1', 'idle', 'p2'), run('review', 'acme/web#1', 'testing')],
};

describe('pickedLayout and runsOf', () => {
  it('shows the machine picked, or the first when it’s gone, and only that machine’s runs in the project', () => {
    expect(pickedLayout(state.layouts, 'review')?.id).toBe('review');
    expect(pickedLayout(state.layouts, 'gone')?.id).toBe('run');
    expect(pickedLayout([], 'run')).toBeUndefined();
    expect(runsOf(state.runs, 'p1', 'run').map((r) => r.key)).toEqual(['a1', 'a2']);
  });
});

describe('screenView', () => {
  it('heads the screen with the machine, how many of the project’s runs are in it, and which of the machines it is', () => {
    const view = screenView(state, 'run', 'p1');
    expect(view.title).toBe('A crew member’s run');
    expect(view.sub).toBe('2 crew members here · machine 1 of 2 · E to toggle through them');
    expect(view.version).toBe('run:a1@idle,a2@turn.started');
    expect(screenView(state, 'review', 'p1').sub).toBe('1 pull request here · machine 2 of 2 · E to toggle through them');
  });

  it('draws again when a run moves or another machine is picked, not when another project’s run does', () => {
    const before = screenView(state, 'run', 'p1').version;
    expect(screenView({ ...state, runs: [...state.runs.slice(0, 2), run('run', 'b1', 'held', 'p2')] }, 'run', 'p1').version).toBe(before);
    expect(screenView({ ...state, runs: [run('run', 'a1', 'waiting'), ...state.runs.slice(1)] }, 'run', 'p1').version).not.toBe(before);
    expect(screenView(state, 'review', 'p1').version).not.toBe(before);
  });

  it('says why there’s nothing to draw yet: laying them out, or why that failed', () => {
    expect(screenView(undefined, 'run', 'p1')).toEqual({ title: 'State machines', sub: 'Laying the machines out…', runs: [], version: 'none:Laying the machines out…' });
    expect(screenView({ layouts: [], runs: [], error: 'ELK fell over' }, 'run', 'p1').sub).toBe('ELK fell over');
  });
});

describe('tabs', () => {
  it('has a tab per machine with how many of the project’s runs are in it, the one shown on', () => {
    expect(tabs(state, 'gone', 'p1')).toEqual([
      { id: 'run', label: 'A crew member’s run · 2', on: true },
      { id: 'review', label: 'QA’s review · 1', on: false },
    ]);
    expect(tabs(undefined, 'run', 'p1')).toEqual([]);
  });
});

describe('fit', () => {
  it('fits a drawing inside a box, centred, shrinking it but never blowing it up past 1.4', () => {
    expect(fit(200, 100, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(fit(10, 10, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 43, y: 43, w: 14, h: 14 });
  });
});

describe('drawDue', () => {
  it('draws a screen again when what it shows changed, unless it’s still drawing the last', () => {
    expect(drawDue({ shown: 'a', drawing: false }, 'b')).toBe(true);
    expect(drawDue({ shown: 'a', drawing: false }, 'a')).toBe(false);
    expect(drawDue({ shown: 'a', drawing: true }, 'b')).toBe(false);
  });
});
