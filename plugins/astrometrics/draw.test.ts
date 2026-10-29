import { describe, expect, it } from 'vitest';
import type { MachineRun } from '../../plugin-api/shared';
import { arrowTaken, machineSvg, occupied, TRAIL_STEPS, trailOf, whoIsThere } from './draw';
import type { MachineLayout } from './shared';

const run = (key: string, state: string, label = key): MachineRun => ({ machine: 'door', key, label, state, seq: 1 });

const layout: MachineLayout = {
  id: 'door',
  title: 'A door',
  about: 'Whether it opens.',
  runs: 'door',
  width: 400,
  height: 200,
  states: [
    { id: 'shut', key: 'shut', kind: 'compound', x: 10, y: 20, w: 200, h: 120 },
    { id: 'shut.locked', key: 'locked', kind: 'atomic', x: 15, y: 50, w: 80, h: 34 },
    { id: 'open', key: 'open', kind: 'atomic', x: 300, y: 40, w: 80, h: 34 },
    { id: 'gone', key: 'gone', kind: 'final', x: 300, y: 120, w: 80, h: 34 },
    { id: '*', key: 'any state', kind: 'anywhere', x: 10, y: 160, w: 100, h: 34 },
  ],
  edges: [{ from: 'shut', to: 'open', label: 'knock [ready]', points: [{ x: 210, y: 57 }, { x: 300, y: 57 }], at: { x: 220, y: 40 } }],
};

describe('occupied', () => {
  it('says who is in each state, and every compound state any of them is within', () => {
    const { at, within } = occupied([run('a', 'delivering.pushing'), run('b', 'idle'), run('c', 'idle')]);
    expect([...at]).toEqual([['delivering.pushing', ['a']], ['idle', ['b', 'c']]]);
    expect([...within]).toEqual(['delivering']);
  });
});

describe('whoIsThere', () => {
  it('names one, or one and how many more, cutting a long name short', () => {
    expect(whoIsThere([])).toBe('');
    expect(whoIsThere(['Ensign Ro'])).toBe('Ensign Ro');
    expect(whoIsThere(['Ensign Ro', 'Lt. Lindqvist', 'QA'])).toBe('Ensign Ro +2');
    expect(whoIsThere(['State machines, part 2: machines the crew can read'])).toBe('State machines, part …');
  });
});

describe('machineSvg', () => {
  it('lights the states its runs are in, saying who, and outlines the compound states round them', () => {
    const svg = machineSvg(layout, [run('a', 'shut.locked', 'Ensign <Ro>'), { ...run('x', 'open'), machine: 'other' }]);
    expect(svg).toContain('Ensign &lt;Ro&gt;');
    // the lit state, and the compound state it's in, in gold; open's run is another machine's, so it isn't lit
    expect(svg.match(/<rect [^>]*fill="#ffcc66"/g)?.length).toBe(1);
    expect(svg).toContain('stroke="#ffcc66" stroke-width="2.5" stroke-dasharray');
    expect(svg).toContain('knock [ready]');
    expect(svg).toContain('font-style="italic">any state<');
  });

  it('draws the compound states under the arrows, and the states over them', () => {
    const svg = machineSvg(layout, []);
    const [compound, arrow, state] = ['stroke-dasharray', '<polyline', '>locked<'].map((s) => svg.indexOf(s));
    expect(compound).toBeLessThan(arrow);
    expect(arrow).toBeLessThan(state);
  });
});

describe('a run’s trail', () => {
  const edges = [
    { from: 'shut', to: 'open', label: 'knock', points: [] },
    { from: 'shut.locked', to: 'shut.unlocked', label: 'unlock', points: [] },
    { from: '*', to: 'shut', label: 'slam', points: [] },
  ];
  const step = (state: string, seq: number) => ({ state, seq, t: seq });

  it('finds the arrow taken: from the state or one it’s in, or from any state, into the state or one it’s in', () => {
    expect(arrowTaken(edges, 'shut.unlocked', 'open')).toBe(0);
    expect(arrowTaken(edges, 'shut.locked', 'shut.unlocked')).toBe(1);
    expect(arrowTaken(edges, 'open', 'shut.locked')).toBe(2);
    expect(arrowTaken(edges, 'open', 'gone')).toBe(-1);
  });

  it('takes the closest fitting arrow: into the state itself over one it’s in, from the state over any state', () => {
    const turn = [
      { from: '*', to: 'turn', label: 'turn-requested', points: [] },
      { from: 'turn', to: 'turn.started', label: 'turn-started', points: [] },
      { from: '*', to: 'turn.started', label: 'resumed', points: [] },
    ];
    expect(arrowTaken(turn, 'turn.requested', 'turn.started')).toBe(1);
    expect(arrowTaken(turn, 'idle', 'turn.started')).toBe(2);
    expect(arrowTaken(turn, 'idle', 'turn.requested')).toBe(0);
  });

  it('numbers the last steps in order, a state visited twice with both, and lights the arrows between them', () => {
    const { order, taken } = trailOf({ ...layout, edges }, [step('shut.locked', 1), step('open', 2), step('shut.locked', 3)]);
    expect([...order]).toEqual([['shut.locked', [1, 3]], ['open', [2]]]);
    expect([...taken].sort()).toEqual([0, 2]);
  });

  it('numbers only the last TRAIL_STEPS steps', () => {
    const steps = Array.from({ length: TRAIL_STEPS + 5 }, (_, i) => step(i % 2 ? 'open' : 'shut.locked', i));
    const numbers = [...trailOf(layout, steps).order.values()].flat();
    expect(Math.max(...numbers)).toBe(TRAIL_STEPS);
    expect(numbers).toHaveLength(TRAIL_STEPS);
  });

  it('draws the trail over the machine: the arrows taken in its colour, the states’ numbers tagged', () => {
    const svg = machineSvg(layout, [], [step('shut.locked', 1), step('open', 2)]);
    expect(svg).toContain('stroke="#7fe3ff" stroke-width="3" marker-end="url(#trail)"');
    expect(svg).toMatch(/fill="#0b1020" font-size="12" font-weight="700">1</);
    expect(machineSvg(layout, [])).not.toContain('url(#trail)"');
  });
});
