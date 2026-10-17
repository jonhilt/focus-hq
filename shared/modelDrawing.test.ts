import { describe, expect, it } from 'vitest';
import { dataView, fit, INK, participants, partShape, sequenceView, type Shape, structurePositions, structureView, toSvg } from './modelDrawing';
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

describe('the structure\'s legend', () => {
  it('keys each kind of part and of connection the model uses, and only those', () => {
    const t = texts(structureView(model()).shapes);
    expect(t).toContain('SHAPE = KIND: ui window · route hexagon · store cylinder');
    const row = t.indexOf('the step under way');
    // the layers' colours, then the connections'
    expect(t.slice(row - 3, row)).toEqual(['Data', 'calls', 'writes']);
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

describe('a real-sized model', () => {
  it('lays twenty parts with loops back out with no two overlapping, growing the drawing rather than squeezing it', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const big: SystemModel = {
      question: 'Big?',
      nodes: ids.map((id, i) => ({ id, label: id, kind: 'service', layer: `L${i % 4}` })),
      // a chain with fan-outs, and replies looping back to earlier parts
      edges: [
        ...ids.slice(1).map((id, i) => ({ from: ids[Math.floor(i / 2)], to: id, kind: 'calls' as const })),
        { from: 'p19', to: 'p3', kind: 'emits' },
        { from: 'p15', to: 'p0', kind: 'emits' },
      ],
      trace: [],
      simplified: [],
    };
    const at = [...structurePositions(big).values()];
    for (const [i, a] of at.entries()) for (const b of at.slice(i + 1)) expect(Math.abs(a.x - b.x) >= 270 || Math.abs(a.y - b.y) >= 96).toBe(true);
    const d = structureView(big);
    expect(d.w).toBeGreaterThanOrEqual(1600);
    for (const p of at) expect(p.x + 135).toBeLessThanOrEqual(d.w);
  });
});

describe('partShape', () => {
  it('draws each kind of part as its own outline, pickable, round the place it\'s given', () => {
    const kinds = ['ui', 'route', 'handler', 'service', 'store', 'queue', 'external', 'job', 'type'] as const;
    const outlines = kinds.map((k) => partShape(k, 500, 300, { stroke: '#fff', part: k }));
    for (const [i, shapes] of outlines.entries()) {
      expect(shapes.length).toBeGreaterThan(0);
      expect(shapes.some((s) => 'part' in s && s.part === kinds[i])).toBe(true);
    }
    // no two kinds look the same
    expect(new Set(outlines.map((o) => JSON.stringify(o.map((s) => ({ ...s, part: undefined }))))).size).toBe(kinds.length);
  });
});

describe('a change\'s marks', () => {
  it('tags what a change added, changed or removed, keys it, and greys out what it removed', () => {
    const m = model();
    m.nodes[0].change = 'added';
    m.nodes[1].change = 'changed';
    m.nodes[2].change = 'removed';
    m.edges[1].change = 'removed';
    const d = structureView(m);
    expect(texts(d.shapes)).toEqual(expect.arrayContaining(['NEW', 'CHANGED', 'REMOVED', 'new in this change', 'removed in this change', 'REMOVED · writes']));
    expect(lines(d.shapes)[1]).toMatchObject({ stroke: INK.muted, dash: true });
  });
});
