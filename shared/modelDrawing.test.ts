import { describe, expect, it } from 'vitest';
import { dataView, fit, INK, participants, sequenceView, type Shape, structurePositions, structureView, toSvg } from './modelDrawing';
import type { SystemModel } from './types';

const model = (): SystemModel => ({
  question: 'How does an author save a proposal?',
  nodes: [
    { id: 'page', label: 'Proposal page', kind: 'ui', layer: 'UI', cite: { file: '/r/Page.razor', line: 3 }, found: true },
    { id: 'api', label: 'Save endpoint', kind: 'route', layer: 'API', cite: { file: '/r/Api.cs', line: 2 }, found: true },
    { id: 'db', label: 'Proposals', kind: 'store', layer: 'Data', found: false },
  ],
  edges: [
    { from: 'page', to: 'api', kind: 'calls', backed: true },
    { from: 'api', to: 'db', kind: 'writes', backed: false },
  ],
  trace: [
    { from: 'page', to: 'api', label: 'POST the draft', payload: 'ProposalDto { title, body }' },
    { from: 'api', to: 'db', label: 'Insert the row' },
    { from: 'api', to: 'page', label: 'Saved', payload: '201 Created' },
  ],
  simplified: ['Validation left out'],
  checks: [{ q: 'Where is the row written?', a: 'Api.cs' }],
});

const texts = (shapes: Shape[]) => shapes.flatMap((s) => (s.t === 'text' ? [s.text] : []));
const lines = (shapes: Shape[]) => shapes.filter((s): s is Extract<Shape, { t: 'line' }> => s.t === 'line');

describe('structureView', () => {
  it('draws every part, pickable, with its label and where it is in the code', () => {
    const d = structureView(model());
    for (const id of ['page', 'api', 'db']) expect(d.shapes.some((s) => 'part' in s && s.part === id)).toBe(true);
    expect(texts(d.shapes)).toEqual(expect.arrayContaining(['Proposal page', 'Page.razor:3', 'no cite']));
  });

  it('draws what the code check didn\'t confirm red and dashed, and the step under way gold, with its payload', () => {
    const d = structureView(model(), { step: 0 });
    const [call, write] = lines(d.shapes);
    expect(call).toMatchObject({ stroke: INK.gold, arrow: true });
    expect(write).toMatchObject({ stroke: INK.red, dash: true });
    expect(texts(d.shapes)).toEqual(expect.arrayContaining(['STEP 1 OF 3 · POST the draft', 'ProposalDto { title, body }']));
    expect(d.shapes.some((s) => 'part' in s && s.part === 'db' && 'stroke' in s && s.stroke === INK.red)).toBe(true);
  });

  it('outlines the picked part, and keeps every part inside the drawing', () => {
    const d = structureView(model(), { picked: 'api' });
    expect(d.shapes.some((s) => s.t === 'poly' && s.part === 'api' && s.stroke === INK.text)).toBe(true);
    for (const p of structurePositions(model()).values()) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(d.w);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(d.h);
    }
  });
});

describe('sequenceView', () => {
  it('has a lifeline for each part the scenario passes through, in the order it reaches them, and an arrow per step', () => {
    expect(participants(model())).toEqual(['page', 'api', 'db']);
    const d = sequenceView(model(), { step: 2 });
    const arrows = lines(d.shapes).filter((l) => l.arrow);
    expect(arrows).toHaveLength(3);
    expect(arrows[2]).toMatchObject({ stroke: INK.gold });
    expect(arrows[2].x2).toBeLessThan(arrows[2].x1);
    expect(arrows[1].stroke).toBe(INK.red);
    expect(texts(d.shapes)).toEqual(expect.arrayContaining(['Saved', '201 Created']));
  });
});

describe('dataView', () => {
  it('lists what moves at each step, and the model\'s caveats', () => {
    const t = texts(dataView(model(), { step: 1 }).shapes);
    expect(t).toEqual(expect.arrayContaining(['Proposal page → Save endpoint', 'ProposalDto { title, body }', '—', 'SIMPLIFIED', '· Validation left out', 'CHECK YOURSELF', '· Where is the row written?']));
  });
});

describe('toSvg and fit', () => {
  it('writes an SVG with pickable parts and escaped text', () => {
    const m = model();
    m.nodes[0].label = 'Page <Edit> & "Save"';
    const svg = toSvg(structureView(m));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('data-part="page"');
    expect(svg).toContain('Page &lt;Edit&gt; &amp; &quot;Save&quot;');
    expect(svg).toContain('marker-end="url(#arrow)"');
  });

  it('cuts text that won\'t fit, with an ellipsis', () => {
    expect(fit('short', 20, 400)).toBe('short');
    expect(fit('a very long label indeed', 20, 100).endsWith('…')).toBe(true);
  });
});
