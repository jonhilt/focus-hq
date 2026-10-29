import { describe, expect, it } from 'vitest';
import { setup } from 'xstate';
import type { Agent, Project } from '../../shared/types';
import { leafOf, machineGraph, MACHINES, machineRuns, PATH_MAX, pathOf, turnPath } from './machines';

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

  it('draws every one of Focus’s machines with each transition between states it has', () => {
    for (const graph of MACHINES) {
      const ids = new Set(['', ...graph.states.map((s) => s.id)]);
      expect(graph.states.length, graph.id).toBeGreaterThan(3);
      for (const t of graph.transitions) expect([ids.has(t.from), ids.has(t.to)], `${graph.id}: ${t.from} → ${t.to}`).toEqual([true, true]);
    }
    expect(MACHINES.map((m) => m.id)).toEqual(['run', 'turn', 'review']);
  });
});

describe('leafOf', () => {
  it('reads a state value as the leaf it’s in', () => {
    expect(leafOf('idle')).toBe('idle');
    expect(leafOf({ turn: 'started' })).toBe('turn.started');
    expect(leafOf({ turn: { local: 'started' } })).toBe('turn.local.started');
  });
});

describe('machineRuns', () => {
  const agent = (o: Partial<Agent>): Agent => ({ id: 'a1', name: 'Ensign Ro', projectId: 'p1', ...o }) as Agent;
  const projects = [{ id: 'p1', repos: ['acme/web'] }, { id: 'p2', repos: ['acme/api'] }] as Project[];

  it('puts each agent in its run and what followed their last turn, each review in its review', () => {
    const runs = machineRuns({
      agents: [
        agent({ run: { phase: 'turn.started', turns: 1, seq: 4 } }),
        agent({ id: 'l1', name: 'Lt. Lindqvist', run: { phase: 'ended', turns: 2, seq: 9, target: 'lead-done' }, lead: { title: 'State machines' } as Agent['lead'] }),
        agent({ id: 'new', name: 'Not started' }),
      ],
      projects,
      reviews: [{ key: 'acme/api#12', phase: { reported: 'posting' }, seq: 6 }, { key: 'other/repo#1', phase: 'queued', seq: 1 }],
    });
    expect(runs).toEqual([
      { machine: 'run', key: 'a1', label: 'Ensign Ro', projectId: 'p1', state: 'turn.started', seq: 4 },
      // a turn still open runs here: it's where the turn ends that says what follows
      { machine: 'turn', key: 'a1', label: 'Ensign Ro', projectId: 'p1', state: 'turn.local', seq: 4 },
      { machine: 'run', key: 'l1', label: 'Lt. Lindqvist', projectId: 'p1', state: 'ended', seq: 9 },
      { machine: 'turn', key: 'l1', label: 'Lt. Lindqvist', projectId: 'p1', state: 'lead-done', seq: 9 },
      { machine: 'review', key: 'acme/api#12', label: 'acme/api#12', projectId: 'p2', state: 'reported.posting', seq: 6 },
      { machine: 'review', key: 'other/repo#1', label: 'other/repo#1', state: 'queued', seq: 1 },
    ]);
  });

  it('puts every run in a state its machine has', () => {
    const states = new Map(MACHINES.map((m) => [m.id, new Set(m.states.map((s) => s.id))]));
    const runs = machineRuns({
      agents: [agent({ run: { phase: 'delivering.pushing', turns: 1, seq: 2 }, lead: { title: 'x' } as Agent['lead'] })],
      projects,
      reviews: [{ key: 'acme/web#1', phase: 'idle', seq: 0 }],
    });
    for (const run of runs) expect(states.get(run.machine)?.has(run.state), `${run.machine}: ${run.state}`).toBe(true);
  });
});

describe('pathOf', () => {
  // a machine that's only its phase: each fact names the phase it moves to
  const evolve = (_: { phase: string }, e: { to: string }) => ({ phase: e.to });
  const fact = (seq: number, to: string) => ({ seq, t: seq * 1000, to });

  it('starts where the machine does, then adds each state a fact moved it into, not one that left it where it was', () => {
    expect(pathOf([fact(1, 'waiting'), fact(2, 'waiting'), fact(3, 'turn')], evolve, { phase: 'idle' })).toEqual([
      { state: 'idle', seq: 0, t: 1000 },
      { state: 'waiting', seq: 1, t: 1000 },
      { state: 'turn', seq: 3, t: 3000 },
    ]);
    expect(pathOf([], evolve, { phase: 'idle' })).toEqual([{ state: 'idle', seq: 0, t: 0 }]);
  });

  it('keeps a long-lived run’s last steps', () => {
    const facts = Array.from({ length: PATH_MAX * 2 }, (_, i) => fact(i + 1, i % 2 ? 'idle' : 'turn'));
    const path = pathOf(facts, evolve, { phase: 'idle' });
    expect(path).toHaveLength(PATH_MAX);
    expect(path.at(-1)?.seq).toBe(PATH_MAX * 2);
  });
});

describe('turnPath', () => {
  it('is what followed each turn, as it was decided', () => {
    expect(turnPath([
      { kind: 'turn-ended', seq: 3, t: 3 },
      { kind: 'decided', seq: 4, t: 4, target: 'carry-on' },
      { kind: 'decided', seq: 9, t: 9, target: 'lead-done' },
    ])).toEqual([{ state: 'carry-on', seq: 4, t: 4 }, { state: 'lead-done', seq: 9, t: 9 }]);
  });
});
