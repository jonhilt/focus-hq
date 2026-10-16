import { describe, expect, it } from 'vitest';
import { OFFICE_DIR } from '../../plugin-api/testing';
import { viewDrawing } from './draw';
import { legibility, SEQUENCE_BUDGET } from './legibility';
import { mapRepo } from './map';
import { lifelines } from './sequence';
import { scenarioSteps } from './steps';

describe('legibility', () => {
  it('measures the smallest text as it is seen, shrunk with a wide drawing, and the texts cut short', () => {
    const svg = '<svg width="2432" height="10"><text font-size="16">fine</text><text x="1" font-size="20">too lo…</text></svg>';
    expect(legibility(svg)).toEqual({ width: 2432, smallestPx: 8, cut: ['too lo…'] });
    expect(legibility('<svg width="600"><text font-size="14">a</text></svg>').smallestPx).toBe(14);
  });
});

describe("the office's own scenarios", () => {
  // every view of Focus's model with steps is held to the sequence budget, as the station's screen shows it
  it('each reads at a glance: few lifelines and steps, nothing cut short, no text too small', async () => {
    const map = await mapRepo('jonhilt/focus', OFFICE_DIR, { history: false });
    const scenarios = (map.model?.views ?? []).filter((v) => scenarioSteps(map, v).length);
    expect(scenarios.length).toBeGreaterThan(0);
    for (const view of scenarios) {
      const drawn = viewDrawing(map, view);
      const read = legibility(drawn.svg);
      expect({ view: view.id, lifelines: lifelines(map, view).length <= SEQUENCE_BUDGET.lifelines, steps: scenarioSteps(map, view).length <= SEQUENCE_BUDGET.steps, cut: read.cut, bigEnough: read.smallestPx >= SEQUENCE_BUDGET.smallestPx })
        .toEqual({ view: view.id, lifelines: true, steps: true, cut: [], bigEnough: true });
      // and every step is backed by the code
      expect({ view: view.id, unbacked: drawn.details!.filter((d) => d[0].startsWith('Nothing')).length }).toEqual({ view: view.id, unbacked: 0 });
    }
  }, 30_000);
});
