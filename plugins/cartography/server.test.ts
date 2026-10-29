// The cartography plugin follows the switch in each project's settings: it maps only the projects it's on for, maps one
// as it's switched on, and forgets one as it's switched off. In the demo it maps Focus's own checkout.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Agent, PluginHost, PluginState, Project } from '../../plugin-api/server';
import cartography from './server';
import type { CartographyState } from './shared';

// mapping runs real git (ls-files, rev-parse, log), which takes longer than vitest's 5 s on a busy machine
vi.setConfig({ testTimeout: 30_000 });

/**
 * A repo of two parts to map, whose checkout is a lead's branch off main that touches one of them. It stands in for
 * Focus's own checkout, which the demo maps: mapping all of Focus, three times over, took these tests past 30 s while
 * the rest of the gate ran beside them (map.test.ts keeps Focus's own map in step with its code).
 */
function shopRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cartography-shop-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: dir, stdio: 'pipe' });
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  write('.focus/cartography.yaml', 'parts:\n  api:\n    label: API\n    layer: Server\n    paths: [src/api/]\n  web:\n    label: Web\n    layer: Client\n    paths: [src/web/]\n');
  write('src/api/wishes.ts', 'export const wishes = () => [];\n');
  write('src/web/page.ts', "import { wishes } from '../api/wishes';\nexport const page = () => wishes();\n");
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'Shop');
  git('checkout', '-q', '-b', 'wishlist');
  write('src/api/wishes.ts', 'export const wishes = () => [];\nexport const wish = (id: string) => id;\n');
  git('commit', '-q', '-am', 'Wishlist');
  return dir;
}

function host(projects: Pick<Project, 'id' | 'name' | 'repos' | 'plugins'>[], agents: Agent[] = [], data = fs.mkdtempSync(path.join(os.tmpdir(), 'cartography-'))) {
  let saved: CartographyState | undefined;
  let repo: string | undefined;
  const state = <S extends object>(fresh: () => S): PluginState<S> => ({
    get: () => (saved ?? fresh()) as unknown as S,
    set: (patch) => (saved = { ...((saved ?? fresh()) as unknown as CartographyState), ...(patch as Partial<CartographyState>) }),
  });
  const lent = {
    demo: true,
    state,
    projects: () => projects as Project[],
    on: (id: string) => !!projects.find((p) => p.id === id)?.plugins?.includes('cartography'),
    // made only for a test that maps
    get focusDir() {
      return (repo ??= shopRepo());
    },
    dataDir: () => data,
    agent: (id: string) => agents.find((a) => a.id === id),
    agents: () => agents,
    leadCheckouts: (id: string) => (agents.find((a) => a.id === id)?.lead?.repos ?? []).map((r) => ({ repo: r.repo, dir: '/not/the/demo/checkout', baseBranch: r.baseBranch })),
  } as unknown as PluginHost;
  return {
    lent,
    maps: () => saved?.maps ?? {},
    slices: () => saved?.slices ?? {},
    busy: () => saved?.mapping.length ?? 0,
    seed: (patch: Partial<CartographyState>) => state<CartographyState>(() => ({ maps: {}, mapping: [], slices: {}, crossRepo: {}, crossCalls: {} })).set(patch),
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
    expect(() => route?.handle({ body: { projectId: 'shop' }, query: {}, params: {} })).toThrow('isn’t switched on for that project');
  });
});

describe('what a goal\'s slice changes', () => {
  const lead = (closing = false) =>
    ({ id: 'lead_shop_1', projectId: 'shop', lead: { title: 'Wishlist', repos: [{ repo: 'o/shop', folder: 'shop', baseBranch: 'main' }], ...(closing ? { closing: { reason: 'done', at: 1 } } : {}) } }) as unknown as Agent;

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
    // in the demo the checkout Focus maps stands in for the lead's, and the lead's branch touched the api
    expect(slices().shop).toMatchObject([{ leadId: 'lead_shop_1', title: 'Wishlist', repos: [{ change: { repo: 'o/shop', touched: [{ part: 'api', files: 1, lines: 1 }] } }] }]);
  });

  it('drops a goal that\'s closing, and leaves out other agents\' turns', async () => {
    const shop = { id: 'shop', name: 'Shop', repos: ['o/shop'], plugins: ['cartography'] };
    const closing = lead(true);
    const { lent, slices, seed } = host([shop], [closing]);
    const parts = cartography.start(lent);
    const map = { repo: 'o/shop', files: 0, mapped: 0, sizes: {}, connections: [], problems: [], model: { parts: [], views: [], ignore: [] } };
    const change = { repo: 'o/shop', touched: [{ part: 'api', files: 1, lines: 3 }], unowned: [], added: [], removed: [], gained: [], lost: [] };
    seed({ maps: { shop: [map] }, slices: { shop: [{ leadId: closing.id, title: 'Wishlist', at: 1, repos: [{ change, branch: map }] }] } });
    parts.turn?.({ id: 'someone', projectId: 'shop' } as Agent, 'end');
    parts.turn?.(closing, 'end');
    for (let i = 0; i < 100 && slices().shop?.length; i++) await new Promise((r) => setTimeout(r, 20));
    expect(slices().shop).toEqual([]);
  });
});
