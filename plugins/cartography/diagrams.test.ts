import { describe, expect, it } from 'vitest';
import { changedIn, citedPaths, inRepo, keep, KEPT_MAX, type KeptDiagram, keptId, standing, worthKeeping } from './diagrams';

const kept = (id: string, extra: Partial<KeptDiagram> = {}): KeptDiagram => ({ id, title: 't', question: 'Q?', by: 'Lt. Okafor', goal: 'Wishlist', at: 0, image: false, files: [], ...extra });
const model = { question: 'Q?', nodes: [{ id: 'a', label: 'A', kind: 'service' as const, layer: 'L', cite: { file: '/w/shop/a.ts', line: 3 } }], edges: [{ from: 'a', to: 'a', kind: 'calls' as const, cite: { file: '/w/shop/a.ts', line: 9 } }], trace: [], simplified: [], checks: [{ q: 'q', a: 'a', cite: { file: '/w/api/b.ts', line: 1 } }] };

describe('kept diagrams', () => {
  it('keeps one of how the code works, not one of what a change does', () => {
    expect(worthKeeping(model)).toBe(true);
    expect(worthKeeping({ ...model, edges: [{ ...model.edges[0], change: 'added' }] })).toBe(false);
  });

  it('knows each file it cites once, and which repo of the lead’s workspace it is in', () => {
    expect(citedPaths(model)).toEqual(['/w/shop/a.ts', '/w/api/b.ts']);
    const checkouts = [{ repo: 'o/shop', dir: '/w/shop' }, { repo: 'o/api', dir: '/w/api' }];
    expect(inRepo('/w/api/b.ts', checkouts)).toEqual({ repo: 'o/api', path: 'b.ts' });
    expect(inRepo('/elsewhere/c.ts', checkouts)).toBeUndefined();
  });

  it('puts the newest first, replacing one of the same id, and keeps at most KEPT_MAX', () => {
    expect(keep([kept('a'), kept('b')], kept('b', { at: 9 })).map((d) => [d.id, d.at])).toEqual([['b', 9], ['a', 0]]);
    const many = Array.from({ length: KEPT_MAX }, (_, i) => kept(`d${i}`));
    expect(keep(many, kept('new'))).toHaveLength(KEPT_MAX);
    expect(keptId('lead_1', 'how/it works')).toBe('lead_1-how_it_works');
  });

  it('is out of date where a file it cites has changed in its repo, or gone', () => {
    const d = kept('d', { files: [{ repo: 'o/shop', path: 'a.ts', hash: '1' }, { repo: 'o/shop', path: 'gone.ts', hash: '2' }, { repo: 'o/api', path: 'b.ts', hash: '3' }] });
    expect(changedIn(d, 'o/shop', (p) => (p === 'a.ts' ? '1' : undefined))).toEqual(['o/shop/gone.ts']);
    expect(changedIn(d, 'o/api', () => '3')).toEqual([]);
  });

  it('says how it stands in a line', () => {
    expect(standing(kept('d', { at: 0 }), 3 * 86_400_000)).toBe('Drawn by Lt. Okafor for “Wishlist”, 3 days ago');
    expect(standing(kept('d', { at: 0, stale: ['o/shop/a.ts'] }), 1000)).toBe('Drawn by Lt. Okafor for “Wishlist”, today · OUT OF DATE: o/shop/a.ts has changed since');
    // up close, where the warning says it at length
    expect(standing(kept('d', { at: 0, stale: ['o/shop/a.ts'] }), 1000, false)).toBe('Drawn by Lt. Okafor for “Wishlist”, today');
  });
});
