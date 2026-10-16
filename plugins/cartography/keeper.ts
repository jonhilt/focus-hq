// Keeping the diagrams leads draw (diagrams.ts): each one's page and picture as files in the plugin's data folder, with
// an index of them by project beside them that outlives the office restarting, unlike the maps, which are made again.
// How each stands against its repos' default branches is worked out again as the project's maps are.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { type Agent, errorMessage, type ModelShown, type PluginHost, type PluginState } from '../../plugin-api/server';
import { changedIn, citedPaths, type CitedFile, forget, inRepo, keep, type KeptDiagram, keptId, reposOf, worthKeeping } from './diagrams';
import type { CartographyState } from './shared';

/** A file's content's hash, as a diagram remembers it; undefined when there's no such file. */
export const hashOf = (file: string): string | undefined => {
  try {
    return createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return undefined;
  }
};

/** What a diagram whose page has gone from the plugin's folder opens on. */
export const MISSING_PAGE = '<!doctype html><body style="background:#0b1020;color:#e8ecf5;font:18px system-ui;padding:32px">Its page is gone from the office\'s files: draw it again, or forget it.</body>';

export class DiagramKeeper {
  private readonly dir: string;

  constructor(
    private host: PluginHost,
    private state: PluginState<CartographyState>,
    /** Where a repo's default branch is checked out to be read (the office's own checkout in the demo). */
    private checkout: (repo: string) => Promise<string>,
  ) {
    this.dir = path.join(host.dataDir(), 'diagrams');
  }

  private get index(): string {
    return path.join(this.dir, 'index.json');
  }

  /** The kept diagrams as the office last saved them. */
  load(): Record<string, KeptDiagram[]> {
    let saved: Record<string, KeptDiagram[]>;
    try {
      saved = JSON.parse(fs.readFileSync(this.index, 'utf8')) as Record<string, KeptDiagram[]>;
    } catch {
      return {};
    }
    // no drawing can be under way as the office starts: one the office stopped in the middle of can be drawn again
    return Object.fromEntries(Object.entries(saved).map(([project, kept]) => [project, kept.map(({ redrawing: _, ...d }) => d)]));
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

  /** The files a model cites as repos' files, each with its content's hash now, from `checkouts` (absolute paths under them). */
  private hashed(model: ModelShown['model'], checkouts: readonly { repo: string; dir: string }[]): CitedFile[] {
    return citedPaths(model).flatMap((file): CitedFile[] => {
      const at = inRepo(file, checkouts);
      const hash = at && hashOf(file);
      return at && hash ? [{ ...at, hash }] : [];
    });
  }

  /** Writes `diagram`'s page and picture, and puts it first in project `projectId`'s. */
  private store(projectId: string, diagram: KeptDiagram, shown: Pick<ModelShown, 'html' | 'image'>): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, `${diagram.id}.html`), shown.html);
    if (shown.image) fs.writeFileSync(path.join(this.dir, `${diagram.id}.jpg`), shown.image);
    else fs.rmSync(path.join(this.dir, `${diagram.id}.jpg`), { force: true });
    const all = this.state.get().diagrams;
    this.save({ ...all, [projectId]: keep(all[projectId] ?? [], diagram) });
  }

  /** Sets what's said of diagram `id` of project `projectId` (being drawn again, or why that failed). */
  private mark(projectId: string, id: string, patch: Pick<KeptDiagram, 'redrawing' | 'failed'>): void {
    const all = this.state.get().diagrams;
    this.save({ ...all, [projectId]: (all[projectId] ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  }

  /**
   * Keeps what lead `agent` drew, with the files it cites as they are in `checkouts` (their workspace's), unless it's
   * of a change rather than of how the code works.
   */
  keep(agent: Agent, shown: ModelShown, checkouts: readonly { repo: string; dir: string }[]): void {
    if (!agent.lead || !worthKeeping(shown.model)) return;
    const id = keptId(agent.id, shown.id);
    this.store(agent.projectId, { id, title: shown.title, question: shown.model.question, by: agent.name, goal: agent.lead.title, at: Date.now(), image: !!shown.image, files: this.hashed(shown.model, checkouts) }, shown);
  }

  /**
   * Draws diagram `id` of project `projectId` again, from its repos' default branches as they are now (a read-only
   * session's, `PluginHost.drawModel`), in its place; it says it's being drawn meanwhile, and why if that fails.
   */
  async redraw(projectId: string, id: string): Promise<void> {
    const d = this.state.get().diagrams[projectId]?.find((k) => k.id === id);
    const project = this.host.projects().find((p) => p.id === projectId);
    if (!d || !project) throw new Error('There’s no such diagram kept');
    if (d.redrawing) return;
    this.mark(projectId, id, { redrawing: true, failed: undefined });
    try {
      const checkouts = await Promise.all(reposOf(d, project.repos).map(async (repo) => ({ repo, dir: await this.checkout(repo) })));
      const drawn = await this.host.drawModel({ question: d.question, title: d.title, dirs: [...new Set(checkouts.map((c) => c.dir))] });
      this.store(projectId, { ...d, by: 'the office', at: Date.now(), image: !!drawn.image, files: this.hashed(drawn.model, checkouts), stale: undefined, redrawing: undefined, failed: undefined }, drawn);
    } catch (err) {
      this.mark(projectId, id, { redrawing: undefined, failed: errorMessage(err) });
    }
  }

  /** Forgets diagram `id` of project `projectId`: the captain prunes what's kept. */
  forget(projectId: string, id: string): void {
    const all = this.state.get().diagrams;
    if (!all[projectId]?.some((d) => d.id === id)) return;
    // the id is one the index has (keptId's), so it's safe as a file name
    for (const ext of ['html', 'jpg']) fs.rmSync(path.join(this.dir, `${id}.${ext}`), { force: true });
    this.save({ ...all, [projectId]: forget(all[projectId], id) });
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
    // a page or picture gone from the folder still leaves the diagram to draw again, or forget
    const file = (ext: string) => {
      try {
        return fs.readFileSync(path.join(this.dir, `${d.id}.${ext}`));
      } catch {
        return undefined;
      }
    };
    const html = file('html')?.toString('utf8') ?? MISSING_PAGE;
    const jpg = d.image ? file('jpg')?.toString('base64') : undefined;
    return { html, ...(jpg ? { image: `data:image/jpeg;base64,${jpg}` } : {}) };
  }
}
