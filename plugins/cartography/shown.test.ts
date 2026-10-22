import { describe, expect, it } from 'vitest';
import type { CartographyState, GoalSlice, RepoMap } from './shared';
import { offNote, projectCard, spaceShows, spaceStands } from './shown';
import { MAX_PANELS } from './spaceLayout';
import { MAP } from './views.test';

const web: RepoMap = { ...MAP, repo: 'o/web' };
const api: RepoMap = { ...MAP, repo: 'o/api' };
const tie = { a: { repo: 'o/api', part: 'core' }, b: { repo: 'o/web', part: 'api' }, together: 4, either: 6 };
const slice: GoalSlice = {
  leadId: 'lead-1', title: 'Wishlist', station: 2, at: 5,
  repos: [{ change: { repo: 'o/r', touched: [{ part: 'api', files: 1, lines: 3 }], unowned: [], added: [], removed: [], gained: [], lost: [] }, branch: MAP }],
};
const state = (patch: Partial<CartographyState> = {}): CartographyState => ({ maps: {}, mapping: [], slices: {}, crossRepo: {}, crossCalls: {}, ...patch });

describe('projectCard', () => {
  const shop = { id: 'shop', repos: ['o/r'] };
  const both = { id: 'shop', repos: ['o/web', 'o/api'] };

  it('says a project not mapped yet is, and offers to map it again unless it is being mapped', () => {
    expect(projectCard(shop, undefined)).toEqual({ remap: 'Map again', repos: undefined, ties: { kind: 'none' }, slices: [] });
    expect(projectCard(shop, state({ mapping: ['shop'] })).remap).toBe('Mapping…');
    expect(projectCard(shop, state({ mapping: ['other'] })).remap).toBe('Map again');
  });

  it('says nothing of ties for one repo, or before its repos are mapped', () => {
    expect(projectCard(shop, state({ maps: { shop: [MAP] } })).ties).toEqual({ kind: 'none' });
    expect(projectCard(both, state({ crossRepo: { shop: [tie] } })).ties).toEqual({ kind: 'none' });
  });

  it('says when nothing ties its repos, and draws what does', () => {
    expect(projectCard(both, state({ maps: { shop: [web, api] } })).ties).toEqual({ kind: 'unfound' });
    const ties = projectCard(both, state({ maps: { shop: [web, api] }, crossRepo: { shop: [tie] } })).ties;
    expect(ties.kind === 'drawn' && ties.drawing.sentences).toEqual(['Core (o/api) and API (o/web): of the 6 change sets that touched either, both changed in 4']);
  });

  it('shows what each goal under way does to its maps', () => {
    const card = projectCard(shop, state({ maps: { shop: [MAP] }, slices: { shop: [slice] } }));
    expect(card.repos).toEqual([MAP]);
    expect(card.slices.map((s) => s.key)).toEqual(['lead-1|o/r|5']);
  });
});

describe('offNote', () => {
  it('counts the projects it is switched off for, and says nothing when there are none', () => {
    expect(offNote(0)).toBeUndefined();
    expect(offNote(1)).toMatch(/^Switched off for 1 project: /);
    expect(offNote(3)).toMatch(/^Switched off for 3 projects: /);
  });
});

describe('spaceShows', () => {
  it('puts up the whole map, then the ties and the slices, then the other views', () => {
    const shows = spaceShows([web, api], state({ crossRepo: { shop: [tie] }, slices: { shop: [{ ...slice, repos: [{ ...slice.repos[0], change: { ...slice.repos[0].change, repo: 'o/web' }, branch: web }] }] } }), 'shop');
    expect(shows.map((s) => [s.kind, s.title])).toEqual([
      ['view', "o/web's whole map"],
      ['view', "o/api's whole map"],
      ['ties', 'how its repos connect'],
      ['slice', 'what Wishlist changes'],
      ['view', 'the map: What does the API reach?'],
      ['view', 'the map: What does the API reach?'],
    ]);
    const sliced = shows.find((s) => s.kind === 'slice');
    expect(sliced?.kind === 'slice' && sliced.caption).toBe("Wishlist · TS-3 · o/web, its lead's checkout against the default branch");
  });

  it('puts up no more than fit', () => {
    const many = Array.from({ length: MAX_PANELS + 3 }, (_, i) => ({ ...MAP, repo: `o/r${i}` }));
    expect(spaceShows(many, state(), 'shop')).toHaveLength(MAX_PANELS);
  });
});

describe('spaceStands', () => {
  it('says a project not mapped yet will be, under a key of its own', () => {
    expect(spaceStands(undefined, 'shop', 'Shop')).toEqual({ shows: [], key: 'unmapped', note: { title: 'Shop has no map yet', why: 'It hasn’t been mapped yet: it will be in a moment.' } });
  });

  it('says when none of its repos has a model', () => {
    const stands = spaceStands(state({ maps: { shop: [{ ...MAP, model: undefined }] } }), 'shop', 'Shop');
    expect(stands.key).toBe('');
    expect(stands.note?.why).toBe('None of its repos has a model yet: each keeps one in .focus/cartography.yaml.');
  });

  it('keys what it puts up, so it is drawn again only when something changes', () => {
    const stands = spaceStands(state({ maps: { shop: [MAP] } }), 'shop', 'Shop');
    expect(stands.note).toBeUndefined();
    expect(stands.key).toBe(stands.shows.map((s) => s.key).join('\n'));
    expect(spaceStands(state({ maps: { shop: [MAP] }, slices: { shop: [slice] } }), 'shop', 'Shop').key).not.toBe(stands.key);
  });
});
