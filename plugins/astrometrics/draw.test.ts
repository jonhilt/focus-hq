import { describe, expect, it } from 'vitest';
import type { MachineRun } from '../../plugin-api/shared';
import { machineSvg, occupied, whoIsThere } from './draw';
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
    const { at, within } = occupied([run('a', 'turn.cloud.attaching'), run('b', 'idle'), run('c', 'idle')]);
    expect([...at]).toEqual([['turn.cloud.attaching', ['a']], ['idle', ['b', 'c']]]);
    expect([...within]).toEqual(['turn', 'turn.cloud']);
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
