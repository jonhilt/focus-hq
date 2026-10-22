import path from 'node:path';
import { covers, type RecapPrimitive, type RecapStep } from './recap';

// Whether a recap's map arrows stand on the code (docs/goals.md#the-system-recap): an arrow between two primitives is
// backed when a file of one imports a file of the other, either way round (a caller imports what it calls; a
// callback runs the other way). An arrow can be true with no import (the browser calling the server over HTTP, an
// event), so one that isn't backed is drawn dashed, not refused. Only relative imports are read: JavaScript and
// TypeScript's. Pure, so it's tested (recapImports.test.ts); the ship reads the files.

/** The files whose imports are read: JavaScript and TypeScript. */
export const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

/** The most files of a primitive's that are read, so a recap naming a whole repo doesn't read all of it. */
export const MAX_FILES = 400;

/** What a source file imports, as written: `import … from`, `export … from`, bare `import`, `import()` and `require()`. */
export function importSpecifiers(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g)) out.add(m[1]);
  return [...out];
}

/** Where a relative import from `file` lands, as the workspace's paths have it (no extension guessed); none for a package's. */
export function resolveImport(file: string, spec: string): string | undefined {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return undefined;
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
}

/** The files an import's target could be: itself, with each extension, a `.js` written for a `.ts`, or a folder's index. */
function candidates(target: string): string[] {
  const bare = target.replace(/\.[cm]?js$/, '');
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
  return [target, ...exts.map((e) => bare + e), ...exts.map((e) => `${target}/index${e}`)];
}

/** Whether a file under `from`'s paths imports one under `to`'s. */
function imports(from: RecapPrimitive, to: RecapPrimitive, sources: ReadonlyMap<string, string>): boolean {
  for (const [file, source] of sources) {
    if (!from.paths.some((p) => covers(p, file))) continue;
    for (const spec of importSpecifiers(source)) {
      const target = resolveImport(file, spec);
      if (target && candidates(target).some((c) => to.paths.some((p) => covers(p, c)))) return true;
    }
  }
  return false;
}

/**
 * The map's arrows, each between two primitives marked whether an import backs it (`sources`: the files read, by the
 * workspace's paths). An arrow to or from anything else (the captain, GitHub) is left as it is: nothing to check.
 */
export function backedMap(primitives: readonly RecapPrimitive[], map: readonly RecapStep[], sources: ReadonlyMap<string, string>): RecapStep[] {
  const byId = new Map(primitives.map((p) => [p.id, p]));
  return map.map((step) => {
    const from = byId.get(step.from);
    const to = byId.get(step.to);
    if (!from || !to) return step;
    return { ...step, backed: imports(from, to, sources) || imports(to, from, sources) };
  });
}

/** The primitives whose files the map's arrows need read: those at both ends of an arrow. */
export function primitivesToRead(primitives: readonly RecapPrimitive[], map: readonly RecapStep[]): RecapPrimitive[] {
  const ids = new Set(primitives.map((p) => p.id));
  const ends = new Set(map.filter((s) => ids.has(s.from) && ids.has(s.to)).flatMap((s) => [s.from, s.to]));
  return primitives.filter((p) => ends.has(p.id));
}
