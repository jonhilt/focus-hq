import { describe, expect, it } from 'vitest';
import { viewDrawing } from './draw';
import { lifelines, sequenceSvg } from './sequence';
import type { MapView, RepoMap } from './shared';
import { checkSteps, stepSentence } from './steps';
import { MAP } from './views.test';

const scenario: MapView = {
  id: 'order',
  question: 'How is an order saved?',
  answer: 'The API hands it to the core, which saves it.',
  parts: ['api', 'core', 'db'],
  steps: [
    { from: 'api', to: 'core', says: 'hands over the order' },
    { from: 'core', to: 'db', says: 'saves it' },
    { from: 'db', to: 'api', says: 'tells the API directly' },
  ],
};
const recorded: RepoMap = { ...MAP, flows: [{ from: 'api', to: 'core', via: 'ws', names: ['order'], count: 4 }] };

describe('checkSteps', () => {
  it('backs a step with its recorded messages first, then an import either way', () => {
    const [handed, saved, told] = checkSteps(recorded, scenario);
    expect(handed.evidence.map((e) => e.kind)).toEqual(['flow', 'import', 'import']);
    expect(handed.evidence[0].sentence).toBe('Sends order over the WebSocket: 4 events in the recorded run');
    expect(saved.evidence).toEqual([{ kind: 'import', sentence: 'Core imports save from Store (1 import)' }]);
    expect(told.evidence).toEqual([]);
  });

  it('says a step as who reaches whom, and what happens', () => {
    expect(stepSentence(MAP, scenario.steps![0])).toBe('API → Core: hands over the order');
  });
});

describe('a scenario drawn', () => {
  it('stands its parts in the order its steps reach them', () => {
    expect(lifelines(MAP, { ...scenario, parts: ['db', 'core', 'api'] }).map((p) => p.id)).toEqual(['api', 'core', 'db']);
  });

  it('draws a recorded message dashed gold, an import solid, and an unbacked step red', () => {
    const svg = sequenceSvg(recorded, scenario, checkSteps(recorded, scenario));
    expect(svg).toContain('marker-end="url(#cg-seq-flow)"');
    expect(svg).toContain('marker-end="url(#cg-seq)"');
    expect(svg).toContain('marker-end="url(#cg-seq-none)"');
    expect(svg).toContain('3. tells the API directly (nothing in the code backs this step)');
  });

  it('is how any view with steps is shown, each step with its evidence to open', () => {
    const drawn = viewDrawing(recorded, scenario);
    expect(drawn.sentences).toHaveLength(3);
    expect(drawn.details?.[1]).toEqual(['Core imports save from Store (1 import)']);
    expect(drawn.details?.[2][0]).toMatch(/^Nothing in the code backs this step/);
  });
});
