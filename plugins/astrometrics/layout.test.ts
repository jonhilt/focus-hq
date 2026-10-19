import { describe, expect, it } from 'vitest';
import type { MachineGraph } from '../../plugin-api/shared';
import { MACHINES } from '../../plugin-api/testing';
import { arrows, laidOut, layOut } from './layout';

const door: MachineGraph = {
  id: 'door',
  title: 'A door',
  about: 'Whether it opens.',
  runs: 'door',
  states: [
    { id: 'shut', key: 'shut', kind: 'compound', initial: true },
    { id: 'shut.locked', key: 'locked', parent: 'shut', kind: 'atomic', initial: true },
    { id: 'shut.unlocked', key: 'unlocked', parent: 'shut', kind: 'atomic' },
    { id: 'open', key: 'open', kind: 'atomic' },
  ],
  transitions: [
    { from: '', to: 'shut', event: 'slam' },
    { from: 'shut.locked', to: 'shut.unlocked', event: 'unlock' },
    { from: 'shut', to: 'open', event: 'knock', guard: 'ready' },
    { from: 'shut', to: 'open', event: 'push', guard: 'ready' },
    { from: 'shut', to: 'open', event: 'kick' },
  ],
};

describe('arrows', () => {
  it('draws one arrow per from, to and guard, with every event that takes it, and those taken from any state from a box of their own', () => {
    expect(arrows(door.transitions)).toEqual([
      { from: '*', to: 'shut', label: 'slam' },
      { from: 'shut.locked', to: 'shut.unlocked', label: 'unlock' },
      { from: 'shut', to: 'open', label: 'knock | push [ready]' },
      { from: 'shut', to: 'open', label: 'kick' },
    ]);
  });
});

describe('laidOut', () => {
  it('puts boxes and arrows in the drawing’s own coordinates, though ELK gives each relative to what it’s in', () => {
    const layout = laidOut(door, {
      id: 'root',
      width: 400,
      height: 200,
      children: [
        { id: 'shut', x: 10, y: 20, width: 200, height: 120, children: [{ id: 'shut.locked', x: 5, y: 30, width: 80, height: 34 }, { id: 'shut.unlocked', x: 100, y: 30, width: 80, height: 34 }] },
        { id: 'open', x: 300, y: 40, width: 80, height: 34 },
        { id: '*', x: 300, y: 150, width: 100, height: 34 },
      ],
      edges: [
        { id: 'e0', sources: ['shut.locked'], targets: ['shut.unlocked'], container: 'shut', sections: [{ id: 's0', startPoint: { x: 85, y: 47 }, endPoint: { x: 100, y: 47 } }], labels: [{ text: 'unlock', x: 86, y: 30 }] },
        { id: 'e1', sources: ['shut'], targets: ['open'], container: 'root', sections: [{ id: 's1', startPoint: { x: 210, y: 57 }, bendPoints: [{ x: 250, y: 57 }], endPoint: { x: 300, y: 57 } }] },
      ],
    });
    expect(layout.states).toEqual([
      { id: 'shut', key: 'shut', kind: 'compound', x: 10, y: 20, w: 200, h: 120 },
      { id: 'shut.locked', key: 'locked', kind: 'atomic', x: 15, y: 50, w: 80, h: 34 },
      { id: 'shut.unlocked', key: 'unlocked', kind: 'atomic', x: 110, y: 50, w: 80, h: 34 },
      { id: 'open', key: 'open', kind: 'atomic', x: 300, y: 40, w: 80, h: 34 },
      { id: '*', key: 'any state', kind: 'anywhere', x: 300, y: 150, w: 100, h: 34 },
    ]);
    expect(layout.edges).toEqual([
      { from: 'shut.locked', to: 'shut.unlocked', label: 'unlock', points: [{ x: 95, y: 67 }, { x: 110, y: 67 }], at: { x: 96, y: 50 } },
      { from: 'shut', to: 'open', label: '', points: [{ x: 210, y: 57 }, { x: 250, y: 57 }, { x: 300, y: 57 }] },
    ]);
  });
});

describe('layOut', () => {
  it('lays every one of the office’s machines out: each state boxed inside its parent, each arrow drawn', async () => {
    for (const graph of MACHINES) {
      const layout = await layOut(graph);
      const boxes = new Map(layout.states.map((s) => [s.id, s]));
      const anyState = graph.transitions.some((t) => !t.from) ? 1 : 0;
      expect(layout.states.length, graph.id).toBe(graph.states.length + anyState);
      for (const s of graph.states) {
        const box = boxes.get(s.id);
        const parent = s.parent ? boxes.get(s.parent) : { x: 0, y: 0, w: layout.width, h: layout.height };
        expect(box && parent && box.x >= parent.x && box.y >= parent.y && box.x + box.w <= parent.x + parent.w + 0.5 && box.y + box.h <= parent.y + parent.h + 0.5, `${graph.id}: ${s.id}`).toBe(true);
      }
      expect(layout.edges.length, graph.id).toBe(arrows(graph.transitions).length);
      for (const e of layout.edges) expect(e.points.length, `${graph.id}: ${e.from} → ${e.to}`).toBeGreaterThanOrEqual(2);
    }
  });
});
