// How a project's repos call each other over HTTP (README.md): the routes one repo declares, matched to the paths
// another calls. Read from the text alone, so it's evidence rather than proof: a route is declared by a Spring
// controller's mappings, an Express-style handler or an OpenAPI spec; a path is called by a string in a file that makes
// HTTP calls, however its URL's glued together (`REST_API_URL + 'owners'`, `` `owners/${id}/pets` ``), so a called path
// matches a route when one ends with the other. Pure: map.ts reads the files.
import type { CrossCall } from './shared';

/** A path's segments, its parameters (`{id}`, `:id`, `${id}`, `*`) as `*`, without a scheme, host or query. */
export function segments(path: string): string[] {
  const bare = path.replace(/^[a-z]+:\/\/[^/]*/i, '').replace(/[?#].*$/, '');
  return bare
    .split('/')
    .filter(Boolean)
    .map((s) => (/^\{.*\}$|^:\w+$|^\*$|^\$\{.*\}$/.test(s) ? '*' : s));
}

/** Whether a called path and a declared route are the same route: one ends with the other, which names something. */
export function sameRoute(called: string, declared: string): boolean {
  const [c, d] = [segments(called), segments(declared)];
  const [short, long] = c.length <= d.length ? [c, d] : [d, c];
  if (!short.some((s) => s !== '*')) return false;
  const tail = long.slice(long.length - short.length);
  // a parameter matches anything the other has there; a name, only the same name (`'vets'` isn't `/pets/{petId}`)
  return short.every((s, i) => s === tail[i] || s === '*');
}

/** Java's text without its comments (its strings kept: a mapping's path is one). */
const uncommented = (text: string): string => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"/g, (m) => (m.startsWith('/') ? ' ' : m));

/** The paths a Spring mapping annotation's arguments give: its first string, `value = …` or `path = …`, one or an array. */
function mappingPaths(args: string | undefined): string[] {
  if (!args?.trim()) return [''];
  const named = /\b(?:value|path)\s*=\s*(\{[^}]*\}|"[^"]*")/.exec(args)?.[1];
  const first = named ?? /^\s*(\{[^}]*\}|"[^"]*")/.exec(args)?.[1];
  if (!first) return [''];
  return [...first.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

/**
 * The routes a file declares: a Spring controller's `@GetMapping`s and the like, under its class's `@RequestMapping`;
 * or an Express-style handler (`app.get('/x', …)`, `router.post(…)`).
 */
export function declaredIn(file: string, text: string): string[] {
  if (file.endsWith('.java')) {
    const src = uncommented(text);
    const at = src.search(/\b(class|interface)\s+\w+/);
    const head = at < 0 ? '' : src.slice(0, at);
    const prefixes = /@RequestMapping\s*(?:\(([^)]*)\))?/.exec(head) ? mappingPaths(/@RequestMapping\s*(?:\(([^)]*)\))?/.exec(head)?.[1]) : [''];
    const body = at < 0 ? src : src.slice(at);
    const routes: string[] = [];
    for (const m of body.matchAll(/@(Get|Post|Put|Patch|Delete|Request)Mapping\b\s*(?:\(([^)]*)\))?/g))
      for (const prefix of prefixes) for (const p of mappingPaths(m[2])) routes.push(`/${[prefix, p].join('/').split('/').filter(Boolean).join('/')}`);
    return [...new Set(routes)];
  }
  return [...new Set([...text.matchAll(/\b(?:app|router|server|routes|fastify)\.(?:get|post|put|patch|delete|all)\(\s*(['"`])(\/[^'"`]*)\1/g)].map((m) => m[2]))];
}

/** The paths an OpenAPI or Swagger spec (YAML or JSON) declares: the keys under its `paths`. */
export function specPaths(text: string): string[] {
  const json = /^\s*\{/.test(text);
  if (json) {
    try {
      const paths = (JSON.parse(text) as { paths?: Record<string, unknown> }).paths;
      return paths ? Object.keys(paths) : [];
    } catch {
      return [];
    }
  }
  const at = /^paths:\s*$/m.exec(text);
  if (!at) return [];
  const rest = text.slice(at.index + at[0].length);
  const end = rest.search(/^\S/m);
  return [...(end < 0 ? rest : rest.slice(0, end)).matchAll(/^ {2}['"]?(\/[^'":\s]*)['"]?\s*:/gm)].map((m) => m[1]);
}

/** Whether a file is an OpenAPI or Swagger spec, by its name. */
export const isSpec = (file: string): boolean => /(^|\/)(openapi|swagger|api)[\w.-]*\.(ya?ml|json)$/i.test(file);

/** The generated API interfaces a file implements (`implements OwnersApi`), whose routes are a spec's. */
export const apisImplemented = (text: string): string[] => [...text.matchAll(/\bimplements\s+([\w\s,<>]+?)\s*\{/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/<.*$/, ''))).filter((n) => /Api$/.test(n));

/** Whether a file makes HTTP calls, so its path-like strings are what it calls. */
export const callsHttp = (text: string): boolean => /\bfetch\(|\bhttp\.(?:get|post|put|patch|delete|request)\b|\baxios\b|\bHttpClient\b|\$\.ajax\(|\bRestTemplate\b|\bWebClient\b|\bRestClient\b/.test(text);

/** The paths a file that makes HTTP calls names: its strings that look like a path, `${…}` as a parameter. */
export function calledIn(text: string): string[] {
  if (!callsHttp(text)) return [];
  const found = new Set<string>();
  for (const m of text.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const s = m[2].replace(/\$\{[^}]*\}/g, '*');
    if (s.length > 120 || !/[a-z]/i.test(s) || !/^[\w/*{}:.-]+$/.test(s) && !/^https?:\/\/[\w.:/*{}-]+$/.test(s)) continue;
    // imports, files and other things that aren't routes
    if (/^\.{1,2}\//.test(s) || /\.(ts|tsx|js|mjs|html|css|scss|png|svg|json|java)$/.test(s) || /^@/.test(s)) continue;
    if (!segments(s).length) continue;
    found.add(s);
  }
  return [...found];
}

/** What a repo declares and calls, each with the part it's in (or the spec it's in, for a spec's routes no part owns). */
export interface RepoRoutes {
  repo: string;
  declared: { path: string; part: string }[];
  called: { path: string; part: string }[];
}

/**
 * What repo `repo` declares and calls, from `files` (path to text: its source and any spec), each under the part
 * `owner` puts its file in. A spec's routes go to the part implementing the API interface named for the route's first
 * segment (`/owners/{id}` to whoever `implements OwnersApi`), else to any part implementing one, else to the spec
 * itself (its path standing in for a part).
 */
export function repoRoutes(repo: string, files: ReadonlyMap<string, string>, owner: (file: string) => string | undefined): RepoRoutes {
  const declared: RepoRoutes['declared'] = [];
  const called: RepoRoutes['called'] = [];
  const apis: { name: string; part: string }[] = [];
  for (const [file, text] of files) {
    if (isSpec(file)) continue;
    const part = owner(file);
    if (!part) continue;
    for (const path of declaredIn(file, text)) declared.push({ path, part });
    for (const path of calledIn(text)) called.push({ path, part });
    for (const name of apisImplemented(text)) apis.push({ name: name.replace(/Api$/, '').replace(/V\d+$/, '').toLowerCase(), part });
  }
  for (const [file, text] of files) {
    if (!isSpec(file)) continue;
    for (const path of specPaths(text)) {
      const first = segments(path).find((s) => s !== '*' && !/^v\d+$/.test(s))?.toLowerCase() ?? '';
      const named = apis.find((a) => a.name && (first.startsWith(a.name) || a.name.startsWith(first)));
      declared.push({ path, part: named?.part ?? apis[0]?.part ?? file });
    }
  }
  return { repo, declared, called };
}

/**
 * Each part in one repo that calls routes another repo declares: from where, to where, and which routes. A called path
 * that matches more than one route goes to the nearest, the fewest segments off (`pets` to `/pets`, not `/v2/pets`).
 */
export function crossCalls(repos: readonly RepoRoutes[]): CrossCall[] {
  const calls = new Map<string, CrossCall>();
  for (const from of repos)
    for (const c of from.called) {
      const matches = repos
        .filter((to) => to.repo !== from.repo)
        .flatMap((to) => to.declared.filter((d) => sameRoute(c.path, d.path)).map((d) => ({ to, d, off: Math.abs(segments(c.path).length - segments(d.path).length) })));
      const nearest = Math.min(...matches.map((m) => m.off));
      for (const { to, d } of matches.filter((m) => m.off === nearest)) {
        const key = `${from.repo}#${c.part} ${to.repo}#${d.part}`;
        const call = calls.get(key) ?? { from: { repo: from.repo, part: c.part }, to: { repo: to.repo, part: d.part }, routes: [] };
        if (!call.routes.includes(d.path)) call.routes.push(d.path);
        calls.set(key, call);
      }
    }
  return [...calls.values()].sort((a, b) => b.routes.length - a.routes.length || `${a.from.repo}${a.from.part}`.localeCompare(`${b.from.repo}${b.from.part}`));
}
