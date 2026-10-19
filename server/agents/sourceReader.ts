import fs from 'node:fs';
import path from 'node:path';

// What a goal lead may cite when it sends a system model (its `model` tool, docs/goals.md): the office reads a cited
// file's lines to check the model against the code, but only files inside `roots` (the lead's workspace, say), and only
// plain files of a sensible size.

const MAX_BYTES = 2_000_000;

const real = (p: string): string | undefined => {
  try {
    return fs.realpathSync(p);
  } catch {
    return undefined;
  }
};

/** Reads a cited file's lines, or undefined if it's missing, too big, not a file, or outside `roots`. */
export function sourceReader(roots: readonly string[]): (file: string) => string[] | undefined {
  return (file) => {
    if (!path.isAbsolute(file)) return undefined;
    const at = real(file);
    if (!at) return undefined;
    const inside = roots.some((root) => {
      const r = real(root);
      return r !== undefined && (at === r || at.startsWith(r + path.sep));
    });
    if (!inside) return undefined;
    const stat = fs.statSync(at);
    if (!stat.isFile() || stat.size > MAX_BYTES) return undefined;
    return fs.readFileSync(at, 'utf8').split(/\r?\n/);
  };
}
