import { describe, expect, it } from 'vitest';
import { checkModel, edgeFor, layoutLayers, modelError, traceGaps } from './systemModel';
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
      'Part page: /r/Gone.razor isn\'t there (or isn\'t one Ops can read).',
      'Part api: r/Api.cs has only 4 lines.',
      'Part db has no cite.',
      'Connection page → api: r/Db.cs:1 doesn\'t mention SaveProposal.',
      'Connection api → db has no cite.',
    ]);
  });
});

describe('layout', () => {
  it('puts parts in columns down the connections, one to a place, the same every time', () => {
    const { at, cols, rows } = layoutLayers(model());
    expect(['page', 'api', 'db'].map((id) => at.get(id)?.col)).toEqual([0, 1, 2]);
    expect({ cols, rows }).toEqual({ cols: 3, rows: 1 });
    expect(layoutLayers(model()).at).toEqual(at);
  });

  it('breaks a loop back rather than letting it push everything on, and never shares a place', () => {
    const loop = model({ edges: [...model().edges, { from: 'db', to: 'page', kind: 'emits' }, { from: 'db', to: 'api', kind: 'emits' }] });
    const { at, cols } = layoutLayers(loop);
    expect(cols).toBe(3);
    expect(at.get('page')?.col).toBe(0);
    const places = [...at.values()].map((s) => `${s.col},${s.row}`);
    expect(new Set(places).size).toBe(places.length);
  });

  it('orders a column by where its neighbours sit, to cut crossings', () => {
    // a and b fan out to their own children; the children's column follows a, b's order however the model lists them
    const fan = model({
      nodes: ['a', 'b', 'b2', 'a2'].map((id) => ({ id, label: id, kind: 'service' as const, layer: 'X' })),
      edges: [{ from: 'b', to: 'b2', kind: 'calls' }, { from: 'a', to: 'a2', kind: 'calls' }],
      trace: [],
    });
    const { at } = layoutLayers(fan);
    expect((at.get('a2')?.row ?? 0) < (at.get('b2')?.row ?? 0)).toBe((at.get('a')?.row ?? 0) < (at.get('b')?.row ?? 0));
  });

  it('finds a step\'s connection either way along it', () => {
    expect(edgeFor(model().edges, 'api', 'page')?.from).toBe('page');
  });
});

describe('the check\'s advice', () => {
  it('doesn\'t count an import as where a part is defined, unless it\'s outside the code', () => {
    const m = model({
      nodes: [
        { ...model().nodes[0], cite: { file: '/r/Imports.ts', line: 1 } },
        { ...model().nodes[1], kind: 'external', cite: { file: '/r/Imports.ts', line: 2 } },
        model().nodes[2],
      ],
    });
    const lines = (f: string) => (f === '/r/Imports.ts' ? ['import { ProposalPage } from "./page";', "import { SaveProposal } from 'sdk';"] : files[f]);
    const { model: checked, problems } = checkModel(m, lines);
    expect(checked.nodes.map((n) => n.found)).toEqual([false, true, true]);
    expect(problems[0]).toBe('Part page: r/Imports.ts:1 is an import, not where it\'s defined.');
  });

  it('points out where the scenario jumps, but not a fan-out or a reply', () => {
    expect(traceGaps(model())).toEqual([]);
    const jumpy = model({ trace: [{ from: 'page', to: 'api', label: 'a' }, { from: 'db', to: 'api', label: 'b' }, { from: 'db', to: 'page', label: 'c' }] });
    expect(traceGaps(jumpy)).toEqual(['Step 2 starts at db, but step 1 ended at api: the scenario jumps there.']);
  });
});

describe('a model of a change', () => {
  it('doesn\'t check what the change removed, since it\'s only in the code it was removed from', () => {
    const m = model({ nodes: [...model().nodes.slice(0, 2), { ...model().nodes[2], change: 'removed', cite: { file: '/r/Gone.cs', line: 9 } }], edges: [model().edges[0], { ...model().edges[1], change: 'removed' }] });
    const { model: checked, problems } = checkModel(m, (f) => files[f]);
    expect(problems).toEqual([]);
    expect(checked.nodes[2].found).toBeUndefined();
    expect(modelError(model({ nodes: [{ ...model().nodes[0], change: 'moved' as 'added' }, ...model().nodes.slice(1)] }))).toContain('change is one of');
  });
});
