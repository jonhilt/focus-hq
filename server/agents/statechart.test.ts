import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setup } from 'xstate';
import { reviewMachine } from './reviewJournal';
import { journalMachine } from './runJournal';
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

  it('draws a machine with transitions of its own as a box its states sit in, they leave from', () => {
    const machine = setup({}).createMachine({ id: 'lamp', initial: 'off', on: { unplug: '.off' }, states: { off: { on: { flick: 'on' } }, on: { on: { flick: 'off' } } } });
    expect(mermaidStatechart(machine)).toBe(
      [
        'stateDiagram-v2',
        '  direction LR',
        '  state "lamp" as lamp {',
        '    [*] --> lamp_off',
        '    state "off" as lamp_off',
        '    state "on" as lamp_on',
        '  }',
        '  lamp_off --> lamp_on : flick',
        '  lamp_on --> lamp_off : flick',
        '  lamp --> lamp_off : unplug',
        '  classDef final fill:#1d3320,stroke:#9fd39f,color:#e8e4d8',
      ].join('\n'),
    );
  });

  it.each([
    ['run-machine', runMachine, 'agents.md'],
    ['journal-machine', journalMachine, 'agents.md'],
    ['review-machine', reviewMachine, 'qa.md'],
  ] as const)('keeps the %s’s picture in its docs page as the code has it', (marker, machine, page) => {
    const doc = readFileSync(join(__dirname, '../../docs', page), 'utf8');
    const drawn = new RegExp(`<!-- ${marker}:start -->\\n\`\`\`mermaid\\n---\\nconfig:\\n {2}layout: elk\\n---\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- ${marker}:end -->`).exec(doc)?.[1];
    // out of step? paste mermaidStatechart(machine)'s output between the markers
    expect(drawn).toBe(mermaidStatechart(machine));
  });
});
