// The map's pure rules: which files it looks at, where an import leads, which part owns a file, and the connections
// between parts that the imports make. Nothing here reads a disk (map.ts does).
import path from 'node:path';
import type { Flow, FlowRecording } from '../../plugin-api/shared';
import type { ArchitectureModel, FileEdge, MapConnection, MapFlow, RepoMap } from './shared';

/** How many of a connection's names it keeps, the most imported first. */
export const NAMES_KEPT = 8;

/** TypeScript and JavaScript the map reads imports from, but not tests, which import everything they test. */
export const isTypeScript = (file: string): boolean => /\.(ts|tsx|mts|js|jsx|mjs)$/.test(file) && !/\.d\.ts$/.test(file) && !/\.(test|spec)\.[a-z]+$/.test(file);

/** Java the map reads (not `package-info` or `module-info`, which declare no class), but not tests: neither a Maven or Gradle test tree (`src/test/`) nor a `…Test`, `…Tests` or `…IT` class. */
export const isJava = (file: string): boolean => file.endsWith('.java') && !/(^|\/)(package|module)-info\.java$/.test(file) && !/(^|\/)src\/test\//.test(file) && !/(Test|Tests|IT)\.java$/.test(file);

/** Source the map reads, in any language it knows (languages.ts). */
export const isSource = (file: string): boolean => isTypeScript(file) || isJava(file);

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

/** A recorded run's file-to-file flows gathered part to part and by how they went, the busiest first; a part's to itself drop out. */
export function partFlows(flows: readonly Flow[], owner: (file: string) => string | undefined): MapFlow[] {
  const found = new Map<string, { from: string; to: string; via: Flow['via']; count: number; names: Map<string, number> }>();
  for (const flow of flows) {
    const from = owner(flow.from);
    const to = owner(flow.to);
    if (!from || !to || from === to) continue;
    const key = `${from} ${to} ${flow.via}`;
    const f = found.get(key) ?? { from, to, via: flow.via, count: 0, names: new Map<string, number>() };
    f.count += flow.count;
    f.names.set(flow.name, (f.names.get(flow.name) ?? 0) + flow.count);
    found.set(key, f);
  }
  return [...found.values()]
    .map(({ names, ...f }) => ({ ...f, names: [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n) }))
    .sort((x, y) => y.count - x.count || x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
}

/** Files a recording names that are gone from the code since: it's time to record again. */
export function flowsGone(recording: FlowRecording, files: readonly string[]): string[] {
  const known = new Set(files);
  const gone = [...new Set(recording.flows.flatMap((f) => [f.from, f.to]))].filter((f) => !known.has(f)).sort();
  return gone.length ? [`the recorded flows name ${gone.join(', ')}, gone from the code since: record them again (pnpm run record-flows)`] : [];
}

/** The map of a repo's code (its source files, and their imports file to file) by its model, with its recorded run's flows if it has one. */
export function mapOf(repo: string, model: ArchitectureModel, files: readonly string[], imports: readonly FileEdge[], recording?: FlowRecording): RepoMap {
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
    ...(recording ? { flows: partFlows(recording.flows, (f) => owners.get(f)), flowsRun: { run: recording.run, commit: recording.commit } } : {}),
    problems: [...problems(model, files, sizes), ...(recording ? flowsGone(recording, files) : [])],
  };
}
