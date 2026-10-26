import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { importsOf, project } from '../plugin-api/boundary';
import { ioChain, type Edge } from './decisionFilesRules';

// A decision lives in a *Rules.ts file with its test beside it (docs/architecture.md#decisions). ESLint holds what such
// a file does itself; this holds that each one is tested where the next reader looks for it, and that nothing it
// imports, however far down, does I/O for it.
const ROOT = path.resolve(import.meta.dirname, '..');
const DIRS = ['server', 'shared', 'client/src', 'tools', 'plugins', 'plugin-api'];

const rulesFiles = DIRS.flatMap((dir) =>
  readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('Rules.ts') && !f.includes('node_modules'))
    .map((f) => path.join(dir, f).split(path.sep).join('/')),
);

const { options } = project(ROOT);
const cache = ts.createModuleResolutionCache(ROOT, (f) => f, options);
const edges = new Map<string, Edge[]>();
/** A repo file's value imports, each resolved as the repo's tsconfig resolves it. */
function valueImports(file: string): Edge[] {
  const known = edges.get(file);
  if (known) return known;
  const abs = path.join(ROOT, file);
  const found = importsOf(abs, readFileSync(abs, 'utf8')).filter((imp) => !imp.typeOnly).flatMap((imp): Edge[] => {
    const resolved = ts.resolveModuleName(imp.spec, abs, options, ts.sys, cache).resolvedModule;
    if (!resolved || resolved.isExternalLibraryImport) return [{ kind: 'package', to: imp.spec }];
    return [{ kind: 'file', to: path.relative(ROOT, resolved.resolvedFileName).split(path.sep).join('/') }];
  });
  edges.set(file, found);
  return found;
}

describe('decision files', () => {
  it('finds some', () => {
    expect(rulesFiles.length).toBeGreaterThan(0);
  });

  it('each has a *Rules.test.ts beside it', () => {
    expect(rulesFiles.filter((f) => !existsSync(path.join(ROOT, f.replace(/\.ts$/, '.test.ts'))))).toEqual([]);
  });

  it('none reaches I/O through what it imports', () => {
    const reached = rulesFiles.flatMap((f) => {
      const chain = ioChain(f, valueImports);
      return chain ? [chain.join(' → ')] : [];
    });
    expect(reached, 'Import the pure part from a file that does no I/O (shared/, plugin-api/shared.ts), or take it as a parameter').toEqual([]);
  });
});
