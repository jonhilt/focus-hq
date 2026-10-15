// The map's pure rules: which files it looks at, where an import leads, which part owns a file, and the connections
// between parts that the imports make. Nothing here reads a disk (map.ts does).
import path from 'node:path';
import type { ArchitectureModel, FileEdge, MapConnection, RepoMap } from './shared';

/** How many of a connection's names it keeps, the most imported first. */
export const NAMES_KEPT = 8;

/** Source the map reads imports from: TypeScript and JavaScript, but not tests, which import everything they test. */
export const isSource = (file: string): boolean => /\.(ts|tsx|mts|js|jsx|mjs)$/.test(file) && !/\.d\.ts$/.test(file) && !/\.(test|spec)\.[a-z]+$/.test(file);

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs'];

/** The file a relative import in `from` leads to, among `files`; undefined for a package or one the map doesn't have. */
export function resolveImport(from: string, spec: string, files: ReadonlySet<string>): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  // `./x.js` in TypeScript means `./x.ts`
  const bare = base.replace(/\.(js|jsx|mjs)$/, '');
  const tries = [base, ...EXTENSIONS.map((e) => bare + e), ...EXTENSIONS.map((e) => `${base}/index${e}`)];
  return tries.find((f) => files.has(f));
}

/** Whether `file` is under `p`: a folder (ending in `/`) or the file itself. */
const under = (file: string, p: string): boolean => (p.endsWith('/') ? file.startsWith(p) : file === p);

/**
 * The part that owns `file`: the one with the longest path it's under, so a part can claim a file out of a folder
 * another part has. Undefined for a file no part has, or one the model ignores.
 */
export function ownerOf(file: string, model: ArchitectureModel): string | undefined {
  if (model.ignore.some((p) => under(file, p))) return undefined;
  let owner: { id: string; length: number } | undefined;
  for (const part of model.parts)
    for (const p of part.paths) if (under(file, p) && (!owner || p.length > owner.length)) owner = { id: part.id, length: p.length };
  return owner?.id;
}

/**
 * File-to-file imports gathered into part-to-part connections, the busiest first, each with the names it brings (the
 * most imported first); a part's imports of itself drop out.
 */
export function connections(imports: readonly FileEdge[], owner: (file: string) => string | undefined): MapConnection[] {
  const found = new Map<string, { from: string; to: string; imports: number; names: Map<string, number> }>();
  for (const edge of imports) {
    const from = owner(edge.from);
    const to = owner(edge.to);
    if (!from || !to || from === to) continue;
    const key = `${from} ${to}`;
    const c = found.get(key) ?? { from, to, imports: 0, names: new Map<string, number>() };
    c.imports++;
    for (const n of edge.names) c.names.set(n, (c.names.get(n) ?? 0) + 1);
    found.set(key, c);
  }
  return [...found.values()]
    .map(({ names, ...c }) => ({ ...c, names: [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, NAMES_KEPT).map(([n]) => n) }))
    .sort((x, y) => y.imports - x.imports || x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
}

/** Where the model and the code disagree: a path that names nothing, a part that owns no code. */
export function problems(model: ArchitectureModel, files: readonly string[], sizes: Readonly<Record<string, number>>): string[] {
  const found: string[] = [];
  for (const part of model.parts) {
    const gone = part.paths.filter((p) => !files.some((f) => under(f, p)));
    if (gone.length) found.push(`${part.id}: ${gone.join(', ')} ${gone.length === 1 ? "isn't" : "aren't"} in the code`);
    else if (!sizes[part.id]) found.push(`${part.id} owns no code: other parts claim all of it`);
  }
  return found;
}

/** The map of a repo's code (its source files, and their imports file to file) by its model. */
export function mapOf(repo: string, model: ArchitectureModel, files: readonly string[], imports: readonly FileEdge[]): RepoMap {
  const owners = new Map(files.map((f) => [f, ownerOf(f, model)]));
  const sizes: Record<string, number> = {};
  for (const id of owners.values()) if (id) sizes[id] = (sizes[id] ?? 0) + 1;
  const ignored = files.filter((f) => model.ignore.some((p) => under(f, p))).length;
  return {
    repo,
    model,
    files: files.length - ignored,
    mapped: Object.values(sizes).reduce((a, b) => a + b, 0),
    sizes,
    connections: connections(imports, (f) => owners.get(f)),
    problems: problems(model, files, sizes),
  };
}
