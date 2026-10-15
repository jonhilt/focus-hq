// The cartography plugin (README.md): each project's architecture map, from the model its repos keep in MODEL_FILE and
// the imports their code makes, made again as the office starts and whenever a pull request merges into one of them.
// FOCUS_PLUGINS=cartography.
import path from 'node:path';
import { config } from '../../server/config';
import { checkoutLatest } from '../../server/agents/workspace';
import type { FocusPlugin, PluginHost, PluginState } from '../../server/plugins/contract';
import { errorMessage } from '../../server/util';
import { mapTool } from './leadTool';
import { mapRepo } from './map';
import { CARTOGRAPHY, type CartographyState, type RepoMap } from './shared';

/** How long after the office starts it maps every project, once it's settled in. */
const MAP_AFTER_START_MS = 20_000;

/** Where a repo is checked out to be mapped: the office's own checkout in the demo, whose projects' repos are made up. */
async function checkout(repo: string, demo: boolean): Promise<string> {
  if (demo) return config.root;
  const dir = path.join(config.dataDir, 'cartography', repo.replace('/', '__'));
  await checkoutLatest(repo, dir);
  return dir;
}

class Cartographer {
  /** Projects asked to be mapped again while they were being mapped. */
  private again = new Set<string>();

  constructor(
    private host: PluginHost,
    private state: PluginState<CartographyState>,
  ) {}

  /** Maps project `id`'s repos again, one at a time; asked while it's under way, it goes again once it's done. */
  async map(id: string): Promise<void> {
    if (this.state.get().mapping.includes(id)) {
      this.again.add(id);
      return;
    }
    const project = this.host.projects().find((p) => p.id === id);
    if (!project) return;
    this.state.set({ mapping: [...this.state.get().mapping, id] });
    const maps: RepoMap[] = [];
    for (const repo of project.repos) {
      maps.push(await checkout(repo, this.host.demo).then((dir) => mapRepo(repo, dir)).catch((err: unknown) => ({ repo, files: 0, mapped: 0, sizes: {}, connections: [], problems: [], error: errorMessage(err) })));
    }
    const now = this.state.get();
    this.state.set({ maps: { ...now.maps, [id]: maps }, mapping: now.mapping.filter((p) => p !== id) });
    if (this.again.delete(id)) await this.map(id);
  }

  mapAll(): Promise<void> {
    return Promise.all(this.host.projects().map((p) => this.map(p.id))).then(() => undefined);
  }

  /** A pull request merged into `repo`: its projects' maps are out of date. */
  merged(repo: string): void {
    for (const p of this.host.projects()) if (p.repos.includes(repo)) void this.map(p.id).catch((err: unknown) => console.error(`Cartography of ${p.name}: ${errorMessage(err)}`));
  }
}

const cartography: FocusPlugin = {
  id: CARTOGRAPHY,
  start(host) {
    // made again from the code as the office starts, so never saved in state.json
    const state = host.state<CartographyState>(() => ({ maps: {}, mapping: [] }), { saved: false });
    const cartographer = new Cartographer(host, state);
    setTimeout(() => void cartographer.mapAll().catch((err: unknown) => console.error(`Cartography: ${errorMessage(err)}`)), MAP_AFTER_START_MS).unref();
    return {
      leadTools: [mapTool],
      routes: [
        {
          method: 'post',
          path: '/map',
          handle: ({ body }) => {
            const id = typeof body.projectId === 'string' ? body.projectId : undefined;
            void (id ? cartographer.map(id) : cartographer.mapAll()).catch((err: unknown) => console.error(`Cartography: ${errorMessage(err)}`));
            return { ok: true };
          },
        },
      ],
      prClosed: (repo, _number, merged) => {
        if (merged) cartographer.merged(repo);
      },
    };
  },
};

export default cartography;
