// The cartography plugin follows the switch in each project's settings: it maps only the projects it's on for, maps one
// as it's switched on, and forgets one as it's switched off. In the demo it maps the office's own checkout.
import { describe, expect, it, vi } from 'vitest';
import type { PluginHost, PluginState, Project } from '../../plugin-api/server';
import cartography from './server';
import type { CartographyState } from './shared';

// mapping runs real git (ls-files, rev-parse, log), which takes longer than vitest's 5 s on a busy machine
vi.setConfig({ testTimeout: 30_000 });

function host(projects: Pick<Project, 'id' | 'name' | 'repos' | 'plugins'>[]) {
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
  } as unknown as PluginHost;
  return { lent, maps: () => saved?.maps ?? {}, busy: () => saved?.mapping.length ?? 0 };
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
