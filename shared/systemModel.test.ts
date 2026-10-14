import { describe, expect, it } from 'vitest';
import { checkModel, edgeFor, layoutModel, modelError, modelPhases, modelSeconds } from './systemModel';
import type { SystemModel } from './types';

const model = (more: Partial<SystemModel> = {}): SystemModel => ({
  question: 'How does an author save a proposal?',
  nodes: [
    { id: 'page', label: 'Proposal page', kind: 'ui', layer: 'UI', symbol: 'ProposalPage', cite: { file: '/r/Page.razor', line: 1 } },
    { id: 'api', label: 'Save endpoint', kind: 'route', layer: 'API', symbol: 'SaveProposal', cite: { file: '/r/Api.cs', line: 2 } },
    { id: 'db', label: 'Proposals table', kind: 'store', layer: 'Data', symbol: 'Proposals', cite: { file: '/r/Db.cs', line: 1 } },
  ],
  edges: [
    { from: 'page', to: 'api', kind: 'calls', cite: { file: '/r/Page.razor', line: 3 } },
    { from: 'api', to: 'db', kind: 'writes', cite: { file: '/r/Api.cs', line: 4 } },
  ],
  trace: [
    { from: 'page', to: 'api', label: 'POST the draft', payload: 'ProposalDto' },
    { from: 'api', to: 'db', label: 'Insert the row' },
    { from: 'api', to: 'page', label: 'Saved' },
  ],
  simplified: ['Validation left out'],
  ...more,
});

const files: Record<string, string[]> = {
  '/r/Page.razor': ['@page "/proposal" ProposalPage', '', 'await Http.PostAsync("api/SaveProposal")'],
  '/r/Api.cs': ['', 'public async Task SaveProposal()', '', '  db.Proposals.Add(p);'],
  '/r/Db.cs': ['DbSet<Proposal> Proposals'],
};

describe('modelError', () => {
  it('takes a model that holds together, steps back along a connection included', () => {
    expect(modelError(model())).toBeUndefined();
  });

  it('refuses unknown parts, kinds, duplicate ids, and steps off the connections', () => {
    expect(modelError(model({ edges: [{ from: 'page', to: 'nope', kind: 'calls' }] }))).toContain('isn\'t in the model');
    expect(modelError(model({ nodes: [...model().nodes, { ...model().nodes[0] }] }))).toContain('Two parts');
    expect(modelError(model({ trace: [{ from: 'page', to: 'db', label: 'Skip' }] }))).toContain('doesn\'t follow a connection');
    expect(modelError(model({ nodes: [{ ...model().nodes[0], kind: 'blob' as 'ui' }] }))).toContain('kind is one of');
    expect(modelError(model({ edges: [{ ...model().edges[0], cite: { file: '/r/x', line: 0 } }] }))).toContain('line (from 1)');
  });
});

describe('checkModel', () => {
  it('finds parts at their cites, and backs connections whose cited line mentions the part they reach', () => {
    const { model: checked, problems } = checkModel(model(), (f) => files[f]);
    expect(problems).toEqual([]);
    expect(checked.nodes.every((n) => n.found)).toBe(true);
    expect(checked.edges.every((e) => e.backed)).toBe(true);
  });

  it('flags a missing file, a line past the end, a line that doesn\'t mention the target, and no cite at all', () => {
    const m = model({
      nodes: [{ ...model().nodes[0], cite: { file: '/r/Gone.razor', line: 1 } }, { ...model().nodes[1], cite: { file: '/r/Api.cs', line: 40 } }, { ...model().nodes[2], cite: undefined }],
      edges: [{ ...model().edges[0], cite: { file: '/r/Db.cs', line: 1 } }, { ...model().edges[1], cite: undefined }],
    });
    const { model: checked, problems } = checkModel(m, (f) => files[f]);
    expect(checked.nodes.map((n) => n.found)).toEqual([false, false, false]);
    expect(checked.edges.map((e) => e.backed)).toEqual([false, false]);
    expect(problems).toEqual([
      'Part page: /r/Gone.razor isn\'t there (or isn\'t one the office can read).',
      'Part api: r/Api.cs has only 4 lines.',
      'Part db has no cite.',
      'Connection page → api: r/Db.cs:1 doesn\'t mention SaveProposal.',
      'Connection api → db has no cite.',
    ]);
  });
});

describe('timing and layout', () => {
  it('plays each step in turn after a lead-in, as named phases', () => {
    expect(modelSeconds(model())).toBe(2 + 3 * 1.8 + 1.5);
    expect(modelPhases(model())).toEqual({ s1: [2, 3.8], s2: [3.8, 5.6], s3: [5.6, 7.4] });
  });

  it('stands parts in columns down the connections, within the stage, the same every time', () => {
    const at = layoutModel(model());
    const xs = ['page', 'api', 'db'].map((id) => at.get(id)?.x ?? NaN);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect([...at.values()].every((p) => Math.hypot(p.x, p.z) <= 5 + 1e-9)).toBe(true);
    expect([...at.values()].every((p) => p.y >= 1.2)).toBe(true);
    expect(layoutModel(model())).toEqual(at);
  });

  it('stacks a column\'s parts one above another, then another stack behind', () => {
    const many = model({
      nodes: [model().nodes[0], ...Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, kind: 'service' as const, layer: 'API' }))],
      edges: Array.from({ length: 6 }, (_, i) => ({ from: 'page', to: `n${i}`, kind: 'calls' as const })),
      trace: [],
    });
    const at = layoutModel(many);
    const column = Array.from({ length: 6 }, (_, i) => at.get(`n${i}`));
    expect(new Set(column.map((p) => p?.x)).size).toBe(1);
    expect(new Set(column.slice(0, 4).map((p) => p?.y)).size).toBe(4);
    expect(column[4]?.z).toBeLessThan(column[0]?.z ?? 0);
  });

  it('settles a cycle rather than running on', () => {
    const loop = model({ edges: [...model().edges, { from: 'db', to: 'page', kind: 'emits' }] });
    expect(layoutModel(loop).size).toBe(3);
  });

  it('finds a step\'s connection either way along it', () => {
    expect(edgeFor(model().edges, 'api', 'page')?.from).toBe('page');
  });
});
