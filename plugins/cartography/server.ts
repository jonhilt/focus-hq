// The cartography plugin (README.md): each project's architecture map, from the model its repos keep in MODEL_FILE and
// the imports their code makes, made again as the office starts and whenever a pull request merges into one of them,
// for each project it's switched on for in the project's settings; and what each goal's slice does to it, from its
// lead's checkout, worked out again as the lead's turn ends.
// FOCUS_PLUGINS=cartography.
import { type Agent, errorMessage, type FocusPlugin, type PluginHost, type PluginState } from '../../plugin-api/server';
import { mapTool } from './leadTool';
import { crossCoupling, type OwnedCommit } from './crossRepo';
import { changedFiles, mapRepo, mapRepoAndLog } from './map';
import { crossCalls as callsAcross, type RepoRoutes } from './routes';
import { CARTOGRAPHY, type CartographyState, type GoalSlice, type RepoMap } from './shared';
import { changesAnything, sliceChange } from './slice';

/** How long after the office starts it maps every project, once it's settled in. */
const MAP_AFTER_START_MS = 20_000;

/** Where a repo is checked out to be mapped: the office's own checkout in the demo, whose projects' repos are made up. */
const checkout = (host: PluginHost, repo: string): Promise<string> => (host.demo ? Promise.resolve(host.officeDir) : host.checkout(repo));

/**
 * A lead's checkouts: in the demo, whose leads have none, the office's own checkout stands in for each, so the demo
 * shows what the office's branch does to it.
 */
const leadCheckouts = (host: PluginHost, agentId: string) =>
  host.demo ? host.leadCheckouts(agentId).map((c) => ({ ...c, dir: host.officeDir, baseBranch: 'main' })) : host.leadCheckouts(agentId);

/** A goal still under way: its lead's still here, and the goal isn't closing. */
const underWay = (agent: Agent | undefined): boolean => !!agent?.lead && !agent.lead.closing;

class Cartographer {
  /** Projects asked to be mapped again while they were being mapped. */
  private again = new Set<string>();
  /** Leads whose slices are being worked out, and those asked again meanwhile. */
  private slicing = new Set<string>();
  private sliceAgain = new Set<string>();

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
    const logs: { repo: string; commits: OwnedCommit[] }[] = [];
    const routes: RepoRoutes[] = [];
    for (const repo of project.repos) {
      const mapped = await checkout(this.host, repo)
        .then((dir) => mapRepoAndLog(repo, dir))
        .catch((err: unknown) => ({ map: { repo, files: 0, mapped: 0, sizes: {}, connections: [], problems: [], error: errorMessage(err) }, commits: [], routes: { repo, declared: [], called: [] } }));
      maps.push(mapped.map);
      logs.push({ repo, commits: mapped.commits });
      routes.push(mapped.routes);
    }
    const now = this.state.get();
    // a project of more than one repo: what ties them, from their histories, and the routes one calls on another
    const many = project.repos.length > 1;
    const { [id]: _, ...otherTies } = now.crossRepo;
    const { [id]: __, ...otherCalls } = now.crossCalls;
    const crossRepo = many ? { ...otherTies, [id]: crossCoupling(logs) } : otherTies;
    const crossCalls = many ? { ...otherCalls, [id]: callsAcross(routes) } : otherCalls;
    this.state.set({ maps: { ...now.maps, [id]: maps }, crossRepo, crossCalls, mapping: now.mapping.filter((p) => p !== id) });
    if (this.again.delete(id)) return this.map(id);
    // against the new maps, what each goal under way does to them
    await this.sliceAll(id);
  }

  /** Forgets project `id`'s maps, its goals' slices and what ties its repos. */
  drop(id: string): void {
    const { maps, slices, crossRepo, crossCalls } = this.state.get();
    const { [id]: dropped, ...rest } = maps;
    const { [id]: _, ...others } = slices;
    const { [id]: __, ...otherTies } = crossRepo;
    const { [id]: ___, ...otherCalls } = crossCalls;
    if (dropped || _ || __ || ___) this.state.set({ maps: rest, slices: others, crossRepo: otherTies, crossCalls: otherCalls });
  }

  /**
   * Works out what lead `agentId`'s slice does to their project's architecture, from their checkouts against the
   * project's maps; asked while it's under way, it goes again once it's done. A slice that changes nothing a map shows
   * (or a goal that's closing) drops off.
   */
  async slice(agentId: string): Promise<void> {
    if (this.slicing.has(agentId)) return void this.sliceAgain.add(agentId);
    const agent = this.host.agent(agentId);
    const lead = agent?.lead;
    if (!agent || !lead || !this.host.on(agent.projectId)) return;
    const mains = this.state.get().maps[agent.projectId];
    if (!mains) return;
    this.slicing.add(agentId);
    try {
      const repos: GoalSlice['repos'] = [];
      if (underWay(agent)) {
        for (const c of leadCheckouts(this.host, agentId)) {
          const main = mains.find((m) => m.repo === c.repo);
          if (!main?.model || main.error) continue;
          const files = await changedFiles(c.dir, c.baseBranch).catch(() => undefined);
          if (!files) continue;
          const branch = await mapRepo(c.repo, c.dir, { history: false });
          if (!branch.model || branch.error) continue;
          const change = sliceChange(main, branch, files);
          // what goes to every browser: the branch's map without its recorded run, which the slice's view doesn't draw
          if (changesAnything(change)) repos.push({ change, branch: { ...branch, flows: undefined, flowsRun: undefined } });
        }
      }
      const now = this.state.get().slices;
      const kept = (now[agent.projectId] ?? []).filter((s) => s.leadId !== agentId && underWay(this.host.agent(s.leadId)));
      const mine: GoalSlice[] = repos.length ? [{ leadId: agentId, title: lead.title, heading: lead.waypoints?.at(-1)?.heading ?? lead.waypoints?.at(-1)?.title, station: lead.station, at: Date.now(), repos }] : [];
      this.state.set({ slices: { ...now, [agent.projectId]: [...kept, ...mine].sort((a, b) => a.station - b.station) } });
    } finally {
      this.slicing.delete(agentId);
    }
    if (this.sliceAgain.delete(agentId)) await this.slice(agentId);
  }

  /** Works out every goal under way's slice in project `id`. */
  async sliceAll(id: string): Promise<void> {
    for (const agent of this.host.agents()) if (agent.projectId === id && underWay(agent)) await this.slice(agent.id);
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
    const state = host.state<CartographyState>(() => ({ maps: {}, mapping: [], slices: {}, crossRepo: {}, crossCalls: {} }), { saved: false });
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
      // as a goal's lead finishes a turn, what their slice does to the architecture so far
      turn: (agent, phase) => {
        if (phase === 'end' && agent.lead) void cartographer.slice(agent.id).catch((err: unknown) => console.error(`Cartography of ${agent.id}'s slice: ${errorMessage(err)}`));
      },
    };
  },
};

export default cartography;
