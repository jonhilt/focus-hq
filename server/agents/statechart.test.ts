import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setup } from 'xstate';
import { runMachine } from './runMachine';
import { mermaidStatechart } from './statechart';

describe('mermaidStatechart', () => {
  it('draws compound states round their children, one arrow per target and guard, and final states as final', () => {
    const machine = setup({ guards: { ready: () => true } }).createMachine({
      id: 'door',
      initial: 'shut',
      states: {
        shut: {
          initial: 'locked',
          on: { kick: '#door.broken', knock: { guard: 'ready', target: '#door.open' }, push: { guard: 'ready', target: '#door.open' } },
          states: { locked: { on: { unlock: 'unlocked' } }, unlocked: {} },
        },
        open: {},
        broken: { type: 'final' },
      },
    });
    expect(mermaidStatechart(machine)).toBe(
      [
        'stateDiagram-v2',
        '  direction LR',
        '  state "shut" as door_shut {',
        '    [*] --> door_shut_locked',
        '    state "locked" as door_shut_locked',
        '    state "unlocked" as door_shut_unlocked',
        '  }',
        '  state "open" as door_open',
        '  state "broken" as door_broken',
        '  [*] --> door_shut',
        '  door_shut_locked --> door_shut_unlocked : unlock',
        '  door_shut --> door_broken : kick',
        '  door_shut --> door_open : knock | push [ready]',
        '  classDef final fill:#1d3320,stroke:#9fd39f,color:#e8e4d8',
        '  class door_broken final',
      ].join('\n'),
    );
  });

  it('keeps the run machine’s picture in docs/agents.md as the code has it', () => {
    const doc = readFileSync(join(__dirname, '../../docs/agents.md'), 'utf8');
    const drawn = /<!-- run-machine:start -->\n```mermaid\n---\nconfig:\n {2}layout: elk\n---\n([\s\S]*?)\n```\n<!-- run-machine:end -->/.exec(doc)?.[1];
    // out of step? paste mermaidStatechart(runMachine)'s output between the markers
    expect(drawn).toBe(mermaidStatechart(runMachine));
  });
});
