import { describe, expect, it } from 'vitest';
import { setup } from 'xstate';
import type { Agent, Project } from '../../shared/types';
import { leafOf, machineGraph, MACHINES, machineRuns } from './machines';

const about = { id: 'door', title: 'A door', about: 'Whether it opens.', runs: 'door' };

describe('machineGraph', () => {
  it('lists states nested as they are, parents first, and each transition that moves it with its event and named guard', () => {
    const machine = setup({ guards: { ready: () => true } }).createMachine({
      id: 'door',
      initial: 'shut',
      on: { slam: '.shut' },
      states: {
        shut: {
          initial: 'locked',
          on: { kick: '#door.broken', knock: { guard: 'ready', target: '#door.open' } },
          states: { locked: { on: { unlock: 'unlocked', rattle: { target: 'locked' }, polish: { actions: [] } } }, unlocked: {} },
        },
        open: {},
        broken: { type: 'final' },
      },
    });
    const graph = machineGraph(machine, about);
    expect(graph.states).toEqual([
      { id: 'shut', key: 'shut', kind: 'compound', initial: true },
      { id: 'shut.locked', key: 'locked', parent: 'shut', kind: 'atomic', initial: true },
      { id: 'shut.unlocked', key: 'unlocked', parent: 'shut', kind: 'atomic' },
      { id: 'open', key: 'open', kind: 'atomic' },
      { id: 'broken', key: 'broken', kind: 'final' },
    ]);
    // the machine's own transition is from '', a self-transition is kept, and one without a target (polish) isn't drawn
    expect(graph.transitions).toEqual([
      { from: '', to: 'shut', event: 'slam' },
      { from: 'shut', to: 'broken', event: 'kick' },
      { from: 'shut', to: 'open', event: 'knock', guard: 'ready' },
      { from: 'shut.locked', to: 'shut.unlocked', event: 'unlock' },
      { from: 'shut.locked', to: 'shut.locked', event: 'rattle' },
    ]);
  });

  it('draws every one of the office’s machines with each transition between states it has', () => {
    for (const graph of MACHINES) {
      const ids = new Set(['', ...graph.states.map((s) => s.id)]);
      expect(graph.states.length, graph.id).toBeGreaterThan(3);
      for (const t of graph.transitions) expect([ids.has(t.from), ids.has(t.to)], `${graph.id}: ${t.from} → ${t.to}`).toEqual([true, true]);
    }
    expect(MACHINES.map((m) => m.id)).toEqual(['run', 'turn', 'slice', 'review']);
  });
});

describe('leafOf', () => {
  it('reads a state value as the leaf it’s in', () => {
    expect(leafOf('idle')).toBe('idle');
    expect(leafOf({ turn: 'started' })).toBe('turn.started');
    expect(leafOf({ turn: { cloud: 'attaching' } })).toBe('turn.cloud.attaching');
  });
});

describe('machineRuns', () => {
  const agent = (o: Partial<Agent>): Agent => ({ id: 'a1', name: 'Ensign Ro', projectId: 'p1', ...o }) as Agent;
  const projects = [{ id: 'p1', repos: ['acme/web'] }, { id: 'p2', repos: ['acme/api'] }] as Project[];

  it('puts each agent in its run and what followed their last turn, a lead’s goal in its slices, each review in its review', () => {
    const runs = machineRuns({
      agents: [
        agent({ run: { phase: 'turn.started', turns: 1, seq: 4 } }),
        agent({ id: 'l1', name: 'Lt. Lindqvist', cloud: true, run: { phase: 'ended', turns: 2, seq: 9, target: 'lead-done' }, lead: { title: 'State machines' } as Agent['lead'] }),
        agent({ id: 'new', name: 'Not started' }),
      ],
      projects,
      slice: () => ({ phase: 'in-review', seq: 3 }),
      reviews: [{ key: 'acme/api#12', phase: { reported: 'posting' }, seq: 6 }, { key: 'other/repo#1', phase: 'queued', seq: 1 }],
    });
    expect(runs).toEqual([
      { machine: 'run', key: 'a1', label: 'Ensign Ro', projectId: 'p1', state: 'turn.started', seq: 4 },
      // a turn still open runs here: it's where the turn ends that says what follows
      { machine: 'turn', key: 'a1', label: 'Ensign Ro', projectId: 'p1', state: 'turn.local', seq: 4 },
      { machine: 'run', key: 'l1', label: 'Lt. Lindqvist', projectId: 'p1', state: 'ended', seq: 9 },
      { machine: 'turn', key: 'l1', label: 'Lt. Lindqvist', projectId: 'p1', state: 'lead-done', seq: 9 },
      { machine: 'slice', key: 'l1', label: 'State machines', projectId: 'p1', state: 'in-review', seq: 3 },
      { machine: 'review', key: 'acme/api#12', label: 'acme/api#12', projectId: 'p2', state: 'reported.posting', seq: 6 },
      { machine: 'review', key: 'other/repo#1', label: 'other/repo#1', state: 'queued', seq: 1 },
    ]);
  });

  it('puts every run in a state its machine has', () => {
    const states = new Map(MACHINES.map((m) => [m.id, new Set(m.states.map((s) => s.id))]));
    const runs = machineRuns({
      agents: [agent({ cloud: true, run: { phase: 'delivering.pushing', turns: 1, seq: 2 }, lead: { title: 'x' } as Agent['lead'] })],
      projects,
      slice: () => ({ phase: 'working', seq: 0 }),
      reviews: [{ key: 'acme/web#1', phase: 'idle', seq: 0 }],
    });
    for (const run of runs) expect(states.get(run.machine)?.has(run.state), `${run.machine}: ${run.state}`).toBe(true);
  });
});
