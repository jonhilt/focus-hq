// Keeping the diagrams leads draw (diagrams.ts): each one's page and picture as files in the plugin's data folder, with
// an index of them by project beside them that outlives the office restarting, unlike the maps, which are made again.
// How each stands against its repos' default branches is worked out again as the project's maps are.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { type Agent, errorMessage, type ModelShown, type PluginHost, type PluginState } from '../../plugin-api/server';
import { changedIn, citedPaths, type CitedFile, inRepo, keep, type KeptDiagram, keptId, worthKeeping } from './diagrams';
import type { CartographyState } from './shared';

/** A file's content's hash, as a diagram remembers it; undefined when there's no such file. */
export const hashOf = (file: string): string | undefined => {
  try {
    return createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return undefined;
  }
};

export class DiagramKeeper {
  private readonly dir: string;

  constructor(
    host: PluginHost,
    private state: PluginState<CartographyState>,
  ) {
    this.dir = path.join(host.dataDir(), 'diagrams');
  }

  private get index(): string {
    return path.join(this.dir, 'index.json');
  }

  /** The kept diagrams as the office last saved them. */
  load(): Record<string, KeptDiagram[]> {
    try {
      return JSON.parse(fs.readFileSync(this.index, 'utf8')) as Record<string, KeptDiagram[]>;
    } catch {
      return {};
    }
  }

  private save(diagrams: Record<string, KeptDiagram[]>): void {
    this.state.set({ diagrams });
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.index, JSON.stringify(diagrams));
    } catch (err) {
      console.error(`Cartography couldn't keep its diagrams: ${errorMessage(err)}`);
    }
  }

  /**
   * Keeps what lead `agent` drew, with the files it cites as they are in `checkouts` (their workspace's), unless it's
   * of a change rather than of how the code works.
   */
  keep(agent: Agent, shown: ModelShown, checkouts: readonly { repo: string; dir: string }[]): void {
    if (!agent.lead || !worthKeeping(shown.model)) return;
    const files = citedPaths(shown.model).flatMap((file): CitedFile[] => {
      const at = inRepo(file, checkouts);
      const hash = at && hashOf(file);
      return at && hash ? [{ ...at, hash }] : [];
    });
    const id = keptId(agent.id, shown.id);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, `${id}.html`), shown.html);
    if (shown.image) fs.writeFileSync(path.join(this.dir, `${id}.jpg`), shown.image);
    const diagram: KeptDiagram = { id, title: shown.title, question: shown.model.question, by: agent.name, goal: agent.lead.title, at: Date.now(), image: !!shown.image, files };
    const all = this.state.get().diagrams;
    this.save({ ...all, [agent.projectId]: keep(all[agent.projectId] ?? [], diagram) });
  }

  /** Project `projectId`'s diagrams against its repos' default branches, checked out in `dirs` (by repo): which are out of date. */
  restale(projectId: string, dirs: ReadonlyMap<string, string>): void {
    const all = this.state.get().diagrams;
    const kept = all[projectId];
    if (!kept?.length) return;
    const now = kept.map((d) => {
      const stale = [...dirs].flatMap(([repo, dir]) => changedIn(d, repo, (p) => hashOf(path.join(dir, p))));
      return { ...d, stale: stale.length ? stale : undefined };
    });
    if (JSON.stringify(now) !== JSON.stringify(kept)) this.save({ ...all, [projectId]: now });
  }

  /** A kept diagram's page, and its picture as a data URL, for a browser to show up close. */
  read(projectId: string, id: string): { html: string; image?: string } {
    const d = this.state.get().diagrams[projectId]?.find((k) => k.id === id);
    if (!d) throw new Error('There’s no such diagram kept');
    const html = fs.readFileSync(path.join(this.dir, `${d.id}.html`), 'utf8');
    const jpg = d.image ? fs.readFileSync(path.join(this.dir, `${d.id}.jpg`)).toString('base64') : undefined;
    return { html, ...(jpg ? { image: `data:image/jpeg;base64,${jpg}` } : {}) };
  }
}
