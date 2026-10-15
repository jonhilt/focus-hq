// The cartography plugin (README.md): each project's architecture map, from the model its repos keep in MODEL_FILE and
// the imports their code makes, made again as the office starts and whenever a pull request merges into one of them,
// for each project it's switched on for in the project's settings.
// FOCUS_PLUGINS=cartography.
import { errorMessage, type FocusPlugin, type PluginHost, type PluginState } from '../../plugin-api/server';
import { mapTool } from './leadTool';
import { mapRepo } from './map';
import { CARTOGRAPHY, type CartographyState, type RepoMap } from './shared';

/** How long after the office starts it maps every project, once it's settled in. */
const MAP_AFTER_START_MS = 20_000;

/** Where a repo is checked out to be mapped: the office's own checkout in the demo, whose projects' repos are made up. */
const checkout = (host: PluginHost, repo: string): Promise<string> => (host.demo ? Promise.resolve(host.officeDir) : host.checkout(repo));

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
    // switched off for the project: what was mapped of it goes
    if (!this.host.on(id)) return this.drop(id);
    this.state.set({ mapping: [...this.state.get().mapping, id] });
    const maps: RepoMap[] = [];
    for (const repo of project.repos) {
      maps.push(await checkout(this.host, repo).then((dir) => mapRepo(repo, dir)).catch((err: unknown) => ({ repo, files: 0, mapped: 0, sizes: {}, connections: [], problems: [], error: errorMessage(err) })));
    }
    const now = this.state.get();
    this.state.set({ maps: { ...now.maps, [id]: maps }, mapping: now.mapping.filter((p) => p !== id) });
    if (this.again.delete(id)) await this.map(id);
  }

  /** Forgets project `id`'s maps. */
  drop(id: string): void {
    const { [id]: _, ...rest } = this.state.get().maps;
    if (_) this.state.set({ maps: rest });
  }

  /** Maps every project it's switched on for. */
  mapAll(): Promise<void> {
    return Promise.all(this.host.projects().filter((p) => this.host.on(p.id)).map((p) => this.map(p.id))).then(() => undefined);
  }

  /** A pull request merged into `repo`: its projects' maps are out of date. */
  merged(repo: string): void {
    for (const p of this.host.projects()) if (p.repos.includes(repo) && this.host.on(p.id)) void this.map(p.id).catch((err: unknown) => console.error(`Cartography of ${p.name}: ${errorMessage(err)}`));
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
            if (id && !host.on(id)) throw new Error('Cartography isn’t switched on for that project: switch it on in its settings');
            void (id ? cartographer.map(id) : cartographer.mapAll()).catch((err: unknown) => console.error(`Cartography: ${errorMessage(err)}`));
            return { ok: true };
          },
        },
      ],
      // switched on for a project, it maps it; switched off, its maps go
      projectChanged: (projectId) => void cartographer.map(projectId).catch((err: unknown) => console.error(`Cartography: ${errorMessage(err)}`)),
      prClosed: (repo, _number, merged) => {
        if (merged) cartographer.merged(repo);
      },
    };
  },
};

export default cartography;
