// Diagrams a lead drew when asked how the code works (their model tool), kept with the project past their goal and put up
// in the architecture space (README.md). Each keeps the files it cites, as they were when it was drawn, so it can say
// when the code under it has changed since: it's out of date, not wrong, and asks to be drawn again. Pure.
import type { ModelCite, SystemModel } from '../../plugin-api/shared';

/** How many a project keeps, the newest first. */
export const KEPT_MAX = 24;

/** A file a diagram cites, in one of its project's repos, and its content's hash when the diagram was drawn. */
export interface CitedFile {
  repo: string;
  path: string;
  hash: string;
}

/** A diagram kept with its project. Its page and picture are files beside the plugin's index of them (server.ts). */
export interface KeptDiagram {
  /** The lead's id and theirs for it: the same lead drawing the same id again replaces it. */
  id: string;
  title: string;
  question: string;
  /** Who drew it, in which goal, and when. */
  by: string;
  goal: string;
  at: number;
  /** There's a picture of it. */
  image: boolean;
  files: CitedFile[];
  /** The files it cites that have changed on their repo's default branch since it was drawn (or gone): out of date. */
  stale?: string[];
  /** It's being drawn again (`PluginHost.drawModel`), or drawing it again failed, and why. */
  redrawing?: boolean;
  failed?: string;
}

/** A kept diagram's id: its lead's and theirs for it, safe as a file name. */
export const keptId = (leadId: string, id: string): string => `${leadId}-${id}`.replace(/[^\w-]/g, '_');

/**
 * Whether a model is worth keeping: one of how the code works. One of what a change does (its parts and connections
 * marked added, changed or removed) is about a slice, and stale the moment it merges.
 */
export const worthKeeping = (model: SystemModel): boolean => ![...model.nodes, ...model.edges].some((x) => x.change);

/** The files a model cites, each once: its parts', its connections' and its checks'. */
export function citedPaths(model: SystemModel): string[] {
  const cites = [...model.nodes.map((n) => n.cite), ...model.edges.map((e) => e.cite), ...(model.checks ?? []).map((c) => c.cite)];
  return [...new Set(cites.filter((c): c is ModelCite => !!c).map((c) => c.file))];
}

/** A cited file (an absolute path in the lead's workspace) as a repo's file: the checkout it's under, and its path in it. */
export function inRepo(file: string, checkouts: readonly { repo: string; dir: string }[]): { repo: string; path: string } | undefined {
  const c = checkouts.filter((c) => file.startsWith(`${c.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];
  return c && { repo: c.repo, path: file.slice(c.dir.length + 1) };
}

/** `kept` with `diagram` in it: first, in place of one of the same id, the oldest beyond KEPT_MAX dropped. */
export const keep = (kept: readonly KeptDiagram[], diagram: KeptDiagram): KeptDiagram[] => [diagram, ...kept.filter((d) => d.id !== diagram.id)].slice(0, KEPT_MAX);

/**
 * The files of `diagram` in `repo` whose content isn't what it was when it was drawn: `hashOf` gives a file's hash on
 * the repo's default branch now, or undefined when it's gone.
 */
export const changedIn = (diagram: KeptDiagram, repo: string, hashOf: (path: string) => string | undefined): string[] =>
  diagram.files.filter((f) => f.repo === repo && hashOf(f.path) !== f.hash).map((f) => `${f.repo}/${f.path}`);

/** The repos a diagram's cited files are in, or else all of its project's: what drawing it again reads. */
export const reposOf = (d: KeptDiagram, projectRepos: readonly string[]): string[] => {
  const cited = [...new Set(d.files.map((f) => f.repo))].filter((r) => projectRepos.includes(r));
  return cited.length ? cited : [...projectRepos];
};

/** `kept` without the diagram `id`. */
export const forget = (kept: readonly KeptDiagram[], id: string): KeptDiagram[] => kept.filter((d) => d.id !== id);

/**
 * How a kept diagram stands, in a line: when and by whom it was drawn, and (unless `stale` is false, where it's said
 * at more length) whether the code under it has moved on.
 */
export function standing(d: KeptDiagram, now: number, stale = true): string {
  const days = Math.floor((now - d.at) / 86_400_000);
  const when = days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  if (d.redrawing) return `Being drawn again from the code as it stands, for “${d.goal}”`;
  const failed = d.failed ? ` · drawing it again failed: ${d.failed}` : '';
  const out = stale && d.stale?.length ? ` · OUT OF DATE: ${d.stale.length === 1 ? `${d.stale[0]} has` : `${d.stale.length} of the files it cites have`} changed since` : '';
  return `Drawn by ${d.by} for “${d.goal}”, ${when}${out}${failed}`;
}
