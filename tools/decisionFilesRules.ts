// Whether a decision file reaches I/O through what it imports (tools/decisionFiles.test.ts walks the repo's imports).
// ESLint sees only a file's own imports; a pure-looking helper that imports a barrel which loads node:fs brings the
// file system in with it, so the walk follows value imports all the way down. Pure, so it's unit tested
// (decisionFilesRules.test.ts).

/** One value import: a repo file (from the root, `server/util.ts`) or a package (`node:fs`, `effect`). */
export type Edge = { kind: 'file'; to: string } | { kind: 'package'; to: string };

const IO_BUILTINS = ['fs', 'fs/promises', 'child_process', 'net', 'http', 'https', 'os', 'worker_threads', 'dgram', 'tls'];
const IO_PACKAGES = new Set([...IO_BUILTINS, ...IO_BUILTINS.map((m) => `node:${m}`), 'express', 'ws', 'playwright', '@anthropic-ai/claude-agent-sdk']);
/** Repo files a decision never reaches, though they import nothing above: the store holds the ship's state. */
const IO_FILES = new Set(['server/store.ts']);

const doesIo = (edge: Edge) => (edge.kind === 'package' ? IO_PACKAGES.has(edge.to) : IO_FILES.has(edge.to));

/**
 * The shortest chain of value imports from `file` to one that does I/O (`file`, then each import, the last the I/O),
 * or undefined when there's none. `importsOf` gives a repo file's value imports.
 */
export function ioChain(file: string, importsOf: (file: string) => Edge[]): string[] | undefined {
  const cameFrom = new Map<string, string | null>([[file, null]]);
  const chain = (to: string, from: string) => {
    const back = [to];
    for (let at: string | null = from; at !== null; at = cameFrom.get(at) ?? null) back.push(at);
    return back.reverse();
  };
  const queue = [file];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    for (const edge of importsOf(at)) {
      if (doesIo(edge)) return chain(edge.to, at);
      if (edge.kind === 'file' && !cameFrom.has(edge.to)) {
        cameFrom.set(edge.to, at);
        queue.push(edge.to);
      }
    }
  }
  return undefined;
}
