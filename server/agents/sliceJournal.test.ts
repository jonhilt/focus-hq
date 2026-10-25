import { describe, expect, it } from 'vitest';
import { foldSlice, type Moving, type SliceFact } from './sliceJournal';

const pr = (repo: string, number: number): SliceFact => ({ kind: 'pr', repo, number, url: `https://github.com/${repo}/pull/${number}`, sha: 'abc', branch: 'focus/saved-items' });
const moving: Moving = { slice: 2, branch: 'focus/saved-items-2', from: 'focus/saved-items', repos: [{ repo: 'o/web', folder: 'web' }], carry: [{ repo: 'o/web', commits: ['c1'] }] };
const started: SliceFact = { kind: 'started', slice: 1, branch: 'focus/saved-items' };
const shipped: SliceFact[] = [started, { kind: 'shipping', title: 'Saved items', summary: 'First slice' }, pr('o/web', 4), pr('o/api', 7), { kind: 'shipped' }];

describe('a goal’s slice journal', () => {
  it('follows a slice from shipping to landed, and on to fresh code', () => {
    expect(foldSlice([started])).toMatchObject({ phase: 'working', slice: 1, branch: 'focus/saved-items', prs: [] });
    expect(foldSlice(shipped.slice(0, 3))).toMatchObject({ phase: 'shipping', ship: { title: 'Saved items' }, prs: [{ repo: 'o/web', number: 4 }] });
    expect(foldSlice(shipped)).toMatchObject({ phase: 'in-review', ship: undefined });
    const oneIn = [...shipped, { kind: 'landed', repo: 'o/web', number: 4, merged: true }] as SliceFact[];
    expect(foldSlice(oneIn)).toMatchObject({ phase: 'in-review', prs: [{ outcome: 'merged' }, { repo: 'o/api' }] });
    expect(foldSlice(oneIn).prs[1].outcome).toBeUndefined();
    const landed = [...oneIn, { kind: 'landed', repo: 'o/api', number: 7, merged: false }] as SliceFact[];
    expect(foldSlice(landed)).toMatchObject({ phase: 'landed', prs: [{ outcome: 'merged' }, { outcome: 'closed' }] });
    expect(foldSlice([...landed, { kind: 'moving', ...moving }])).toMatchObject({ phase: 'moving', moving });
    expect(foldSlice([...landed, { kind: 'moving', ...moving }, { kind: 'moved' }])).toMatchObject({ phase: 'working', slice: 2, branch: 'focus/saved-items-2', prs: [], moving: undefined });
  });

  it('goes back to where it was after a ship that shipped nothing, and updates its pull requests shipping again', () => {
    const nothing: SliceFact[] = [started, { kind: 'shipping', title: 'x', summary: 'y' }, { kind: 'ship-ended', error: 'Commit first' }];
    expect(foldSlice(nothing).phase).toBe('working');
    expect(foldSlice([...shipped, { kind: 'shipping', title: 'Fix', summary: 'QA’s finding' }, { kind: 'ship-ended' }]).phase).toBe('in-review');
    const again = foldSlice([...shipped, { kind: 'shipping', title: 'Fix', summary: 'z' }, { ...pr('o/web', 4), sha: 'def' } as SliceFact, { kind: 'shipped' }]);
    expect(again.prs).toHaveLength(2);
    expect(again.prs.find((p) => p.number === 4)?.sha).toBe('def');
  });

  it('has landed once a ship ends with every pull request merged or closed while it was under way', () => {
    const shipping: SliceFact[] = [...shipped, { kind: 'shipping', title: 'More', summary: 'z' }];
    const both: SliceFact[] = [{ kind: 'landed', repo: 'o/web', number: 4, merged: true }, { kind: 'landed', repo: 'o/api', number: 7, merged: false }];
    expect(foldSlice([...shipping, ...both, { kind: 'shipped' }])).toMatchObject({ phase: 'landed', ship: undefined });
    expect(foldSlice([...shipping, ...both, { kind: 'ship-ended' }])).toMatchObject({ phase: 'landed', ship: undefined });
    // one still open: in review
    expect(foldSlice([...shipping, both[0], { kind: 'shipped' }]).phase).toBe('in-review');
  });

  it('moves on from a journal that began before slices had one', () => {
    expect(foldSlice([{ kind: 'moving', ...moving }, { kind: 'moved' }])).toMatchObject({ phase: 'working', slice: 2 });
  });
});
