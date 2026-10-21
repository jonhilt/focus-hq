// The cartography plugin follows the switch in each project's settings: it maps only the projects it's on for, maps one
// as it's switched on, and forgets one as it's switched off. In the demo it maps Focus's own checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Agent, PluginHost, PluginState, Project } from '../../plugin-api/server';
import cartography from './server';
import type { CartographyState } from './shared';

// mapping runs real git (ls-files, rev-parse, log), which takes longer than vitest's 5 s on a busy machine
vi.setConfig({ testTimeout: 30_000 });

/** What Ops answers a plugin asking for a model drawn afresh, or a refusal. */
let drawn: PluginHost['drawModel'] = ({ title }) =>
  Promise.resolve({ id: title, title, html: '<p>again</p>', problems: [], model: { question: 'Q?', nodes: [{ id: 'k', label: 'K', kind: 'store', layer: 'L', cite: { file: path.join(process.cwd(), 'plugins/cartography/keeper.ts'), line: 1 } }], edges: [], trace: [], simplified: [] } });

function host(projects: Pick<Project, 'id' | 'name' | 'repos' | 'plugins'>[], agents: Agent[] = [], data = fs.mkdtempSync(path.join(os.tmpdir(), 'cartography-'))) {
  let saved: CartographyState | undefined;
  const state = <S extends object>(fresh: () => S): PluginState<S> => ({
    get: () => (saved ?? fresh()) as unknown as S,
    set: (patch) => (saved = { ...((saved ?? fresh()) as unknown as CartographyState), ...(patch as Partial<CartographyState>) }),
  });
  const lent = {
    demo: true,
    state,
    projects: () => projects as Project[],
    on: (id: string) => !!projects.find((p) => p.id === id)?.plugins?.includes('cartography'),
    focusDir: process.cwd(),
    dataDir: () => data,
    // the demo's stand-in, as Ops draws it: one model of its own code
    drawModel: drawn,
    agent: (id: string) => agents.find((a) => a.id === id),
    agents: () => agents,
    leadCheckouts: (id: string) => (agents.find((a) => a.id === id)?.lead?.repos ?? []).map((r) => ({ repo: r.repo, dir: process.cwd(), baseBranch: r.baseBranch })),
  } as unknown as PluginHost;
  return {
    lent,
    maps: () => saved?.maps ?? {},
    slices: () => saved?.slices ?? {},
    diagrams: () => saved?.diagrams ?? {},
    busy: () => saved?.mapping.length ?? 0,
    seed: (patch: Partial<CartographyState>) => state<CartographyState>(() => ({ maps: {}, mapping: [], slices: {}, crossRepo: {}, crossCalls: {}, diagrams: {} })).set(patch),
  };
}

const settled = async (busy: () => number) => {
  for (let i = 0; i < 300 && busy(); i++) await new Promise((r) => setTimeout(r, 50));
};

describe('cartography, switched on per project', () => {
  it('maps a project as it\'s switched on, and forgets it as it\'s switched off', async () => {
    const shop = { id: 'shop', name: 'Shop', repos: ['o/shop'], plugins: [] as string[] };
    const { lent, maps, busy } = host([shop]);
    const parts = cartography.start(lent);

    parts.projectChanged?.('shop');
    await settled(busy);
    expect(maps()).toEqual({});

    shop.plugins = ['cartography'];
    parts.projectChanged?.('shop');
    await new Promise((r) => setTimeout(r, 10));
    await settled(busy);
    expect(Object.keys(maps())).toEqual(['shop']);
    expect(maps().shop?.[0]?.repo).toBe('o/shop');

    shop.plugins = [];
    parts.projectChanged?.('shop');
    await settled(busy);
    expect(maps()).toEqual({});
  });

  it('won\'t map again a project it\'s off for', () => {
    const { lent } = host([{ id: 'shop', name: 'Shop', repos: ['o/shop'] }]);
    const route = cartography.start(lent).routes?.find((r) => r.path === '/map');
    expect(() => route?.handle({ body: { projectId: 'shop' }, query: {} })).toThrow('isn’t switched on for that project');
  });
});

describe('what a goal\'s slice changes', () => {
  const lead = (closing = false) =>
    ({ id: 'lead_shop_1', projectId: 'shop', lead: { title: 'Wishlist', station: 0, repos: [{ repo: 'o/shop', folder: 'shop', baseBranch: 'main' }], ...(closing ? { closing: { reason: 'done', at: 1 } } : {}) } }) as unknown as Agent;

  it('works it out as a lead\'s turn ends, from their checkout against the project\'s map', async () => {
    const shop = { id: 'shop', name: 'Shop', repos: ['o/shop'], plugins: ['cartography'] };
    const agent = lead();
    const { lent, slices, busy } = host([shop], [agent]);
    const parts = cartography.start(lent);
    parts.projectChanged?.('shop');
    await new Promise((r) => setTimeout(r, 10));
    await settled(busy);
    parts.turn?.(agent, 'end');
    for (let i = 0; i < 300 && !slices().shop; i++) await new Promise((r) => setTimeout(r, 50));
    // Focus's own checkout stands in for the lead's: whatever its branch changes, it's the lead's goal that says so
    for (const s of slices().shop ?? []) {
      expect(s).toMatchObject({ leadId: 'lead_shop_1', title: 'Wishlist', station: 0 });
      for (const r of s.repos) expect(r.change.repo).toBe('o/shop');
    }
  });

  it('drops a goal that\'s closing, and leaves out other agents\' turns', async () => {
    const shop = { id: 'shop', name: 'Shop', repos: ['o/shop'], plugins: ['cartography'] };
    const closing = lead(true);
    const { lent, slices, seed } = host([shop], [closing]);
    const parts = cartography.start(lent);
    const map = { repo: 'o/shop', files: 0, mapped: 0, sizes: {}, connections: [], problems: [], model: { parts: [], views: [], ignore: [] } };
    const change = { repo: 'o/shop', touched: [{ part: 'api', files: 1, lines: 3 }], unowned: [], added: [], removed: [], gained: [], lost: [] };
    seed({ maps: { shop: [map] }, slices: { shop: [{ leadId: closing.id, title: 'Wishlist', station: 0, at: 1, repos: [{ change, branch: map }] }] } });
    parts.turn?.({ id: 'someone', projectId: 'shop' } as Agent, 'end');
    parts.turn?.(closing, 'end');
    for (let i = 0; i < 100 && slices().shop?.length; i++) await new Promise((r) => setTimeout(r, 20));
    expect(slices().shop).toEqual([]);
  });
});

describe('the diagrams leads draw', () => {
  const lead = { id: 'lead_shop_1', name: 'Lt. Okafor', projectId: 'shop', lead: { title: 'Wishlist', station: 0, repos: [{ repo: 'o/shop', folder: 'shop', baseBranch: 'main' }] } } as unknown as Agent;
  // in the demo Focus's own checkout stands in for the lead's, and for the project's default branch
  const cited = path.join(process.cwd(), 'plugins/cartography/diagrams.ts');
  const model = (change?: 'added') => ({
    question: 'How is a diagram kept?',
    nodes: [{ id: 'k', label: 'Keeper', kind: 'service' as const, layer: 'Server', cite: { file: cited, line: 1 }, ...(change ? { change } : {}) }],
    edges: [],
    trace: [],
    simplified: [],
  });

  it('keeps one of how the code works, with the files it cites, past Focus restarting; not one of a change', async () => {
    const shop = { id: 'shop', name: 'Shop', repos: ['o/shop'], plugins: ['cartography'] };
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cartography-'));
    const { lent, diagrams } = host([shop], [lead], data);
    const parts = cartography.start(lent);
    parts.modelShown?.(lead, { id: 'keep', title: 'a diagram is kept', model: model(), html: '<p>it</p>', image: new Uint8Array([1, 2]) });
    parts.modelShown?.(lead, { id: 'slice', title: 'what my change does', model: model('added'), html: '<p>x</p>' });
    const [kept] = diagrams().shop ?? [];
    expect(diagrams().shop).toHaveLength(1);
    expect(kept).toMatchObject({ id: 'lead_shop_1-keep', question: 'How is a diagram kept?', by: 'Lt. Okafor', goal: 'Wishlist', image: true });
    expect(kept.files).toEqual([{ repo: 'o/shop', path: 'plugins/cartography/diagrams.ts', hash: expect.stringMatching(/^[0-9a-f]{40}$/) }]);
    // a browser reads its page and picture through the plugin's route
    const route = parts.routes?.find((r) => r.path === '/diagram');
    expect(route?.handle({ body: { project: 'shop', id: kept.id }, query: {} })).toEqual({ html: '<p>it</p>', image: 'data:image/jpeg;base64,AQI=' });
    // and Focus starting again finds it
    const again = host([shop], [lead], data);
    cartography.start(again.lent);
    expect(again.diagrams().shop?.[0]?.id).toBe(kept.id);
  });

  it('says it is out of date once a file it cites is not as it was', async () => {
    const shop = { id: 'shop', name: 'Shop', repos: ['o/shop'], plugins: ['cartography'] };
    const { lent, diagrams, seed, busy } = host([shop], [lead]);
    const parts = cartography.start(lent);
    seed({ diagrams: { shop: [{ id: 'd', title: 't', question: 'Q?', by: 'x', goal: 'g', at: 1, image: false, files: [{ repo: 'o/shop', path: 'plugins/cartography/diagrams.ts', hash: 'not-what-it-is' }] }] } });
    parts.projectChanged?.('shop');
    await new Promise((r) => setTimeout(r, 10));
    await settled(busy);
    expect(diagrams().shop?.[0]?.stale).toEqual(['o/shop/plugins/cartography/diagrams.ts']);
  });
});

describe('drawing a kept diagram again, and forgetting it', () => {
  const shop = { id: 'shop', name: 'Shop', repos: ['o/shop'], plugins: ['cartography'] };
  const old = { id: 'd', title: 'a diagram', question: 'Q?', by: 'Lt. Okafor', goal: 'Wishlist', at: 1, image: false, files: [], stale: ['o/shop/x.ts'] };
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  };

  it('draws it again from its repos as they are, in its place, no longer out of date', async () => {
    const { lent, diagrams, seed } = host([shop]);
    const parts = cartography.start(lent);
    seed({ diagrams: { shop: [old] } });
    parts.routes?.find((r) => r.path === '/redraw')?.handle({ body: { project: 'shop', id: 'd' }, query: {} });
    await until(() => diagrams().shop?.[0]?.by === 'Ops');
    const [again] = diagrams().shop ?? [];
    expect(again).toMatchObject({ id: 'd', question: 'Q?', goal: 'Wishlist', by: 'Ops' });
    expect(again.stale).toBeUndefined();
    expect(again.redrawing).toBeUndefined();
    expect(again.files).toEqual([{ repo: 'o/shop', path: 'plugins/cartography/keeper.ts', hash: expect.any(String) }]);
    expect(parts.routes?.find((r) => r.path === '/diagram')?.handle({ body: { project: 'shop', id: 'd' }, query: {} })).toEqual({ html: '<p>again</p>' });
  });

  it('says why when it can’t, and keeps the one it had', async () => {
    const was = drawn;
    drawn = () => Promise.reject(new Error('no session to hand'));
    try {
      const { lent, diagrams, seed } = host([shop]);
      const parts = cartography.start(lent);
      seed({ diagrams: { shop: [old] } });
      parts.routes?.find((r) => r.path === '/redraw')?.handle({ body: { project: 'shop', id: 'd' }, query: {} });
      await until(() => !!diagrams().shop?.[0]?.failed);
      expect(diagrams().shop?.[0]).toMatchObject({ id: 'd', by: 'Lt. Okafor', failed: 'no session to hand' });
      expect(diagrams().shop?.[0]?.redrawing).toBeUndefined();
    } finally {
      drawn = was;
    }
  });

  it('opens one whose page has gone, so it can still be drawn again or forgotten', () => {
    const { lent, seed } = host([shop]);
    const parts = cartography.start(lent);
    seed({ diagrams: { shop: [{ ...old, id: 'gone', image: true }] } });
    const read = parts.routes?.find((r) => r.path === '/diagram')?.handle({ body: { project: 'shop', id: 'gone' }, query: {} }) as { html: string; image?: string };
    expect(read.html).toContain('Its page is gone');
    expect(read.image).toBeUndefined();
  });

  it('isn’t left being drawn again by a Focus that stopped in the middle of drawing it', async () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cartography-'));
    fs.mkdirSync(path.join(data, 'diagrams'));
    fs.writeFileSync(path.join(data, 'diagrams', 'index.json'), JSON.stringify({ shop: [{ ...old, redrawing: true }] }));
    const { lent, diagrams } = host([shop], [], data);
    const parts = cartography.start(lent);
    expect(diagrams().shop?.[0]?.redrawing).toBeUndefined();
    // so it can be drawn again
    parts.routes?.find((r) => r.path === '/redraw')?.handle({ body: { project: 'shop', id: 'd' }, query: {} });
    await until(() => diagrams().shop?.[0]?.by === 'Ops');
    expect(diagrams().shop?.[0]?.by).toBe('Ops');
  });

  it('leaves one forgotten while it was being drawn again forgotten', async () => {
    const was = drawn;
    let finish: (() => void) | undefined;
    drawn = (ask) => new Promise((resolve) => (finish = () => resolve(was(ask)))).then((p) => p as Awaited<ReturnType<typeof was>>);
    try {
      const { lent, diagrams, seed } = host([shop]);
      const parts = cartography.start(lent);
      seed({ diagrams: { shop: [old] } });
      const route = (p: string) => parts.routes?.find((r) => r.path === p)?.handle({ body: { project: 'shop', id: 'd' }, query: {} });
      route('/redraw');
      // the drawing's asked for, and not back yet
      await until(() => !!finish);
      route('/forget');
      finish?.();
      await new Promise((r) => setTimeout(r, 50));
      expect(diagrams().shop).toEqual([]);
    } finally {
      drawn = was;
    }
  });

  it('forgets one the captain doesn’t want', () => {
    const { lent, diagrams, seed } = host([shop]);
    const parts = cartography.start(lent);
    seed({ diagrams: { shop: [old] } });
    parts.routes?.find((r) => r.path === '/forget')?.handle({ body: { project: 'shop', id: 'd' }, query: {} });
    expect(diagrams().shop).toEqual([]);
  });
});
