// The line between the core and its plugins (docs/plugins.md), as TypeScript resolves imports: a plugin reaches
// Focus only through plugin-api/ (testing.ts from its tests alone), another plugin only through that plugin's api.ts
// (what it lends the plugins that require it), and the core never reaches a plugin. Which crossing is refused is
// boundaryRules.ts'; this reads the imports. boundary.test.ts holds the repo to it.
import path from 'node:path';
import ts from 'typescript';
import { refusal } from './boundaryRules';

export interface Crossing {
  /** The importing file, from the repo's root. */
  file: string;
  line: number;
  /** What it imports, as written. */
  spec: string;
  /** Where that resolved to, from the repo's root. */
  to: string;
  why: string;
}

interface Import {
  spec: string;
  line: number;
  typeOnly: boolean;
}

/** Every module a file's source imports or re-exports from, and whether only for types (erased as it runs). */
export function importsOf(file: string, text: string): Import[] {
  // without parent pointers, which only walking up needs: setting them costs a whole-repo walk about a third again
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const found: Import[] = [];
  const add = (spec: ts.Expression, node: ts.Node, typeOnly: boolean) => {
    if (ts.isStringLiteral(spec)) found.push({ spec: spec.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, typeOnly });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const everyNameATypeOnly = !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly) && !clause.name;
      add(node.moduleSpecifier, node, !!clause && (clause.isTypeOnly || everyNameATypeOnly));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node.moduleSpecifier, node, node.isTypeOnly);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) {
      add(node.arguments[0], node, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The crossings in `files` (absolute paths) the line refuses, each import resolved as the repo's tsconfig resolves it. */
export function crossings(root: string, files: string[], read: (file: string) => string, options: ts.CompilerOptions): Crossing[] {
  const rel = (file: string) => path.relative(root, file).split(path.sep).join('/');
  // shared across the files: each folder's lookups (node_modules, package.json, tsconfig paths) are made once, not per import
  const cache = ts.createModuleResolutionCache(root, (f) => f, options);
  return files.flatMap((file) => importsOf(file, read(file)).flatMap((imp) => {
    const resolved = ts.resolveModuleName(imp.spec, file, options, ts.sys, cache).resolvedModule;
    if (!resolved || resolved.isExternalLibraryImport) return [];
    const to = rel(resolved.resolvedFileName);
    const why = refusal(rel(file), to);
    return why ? [{ file: rel(file), line: imp.line, spec: imp.spec, to, why }] : [];
  }));
}

/** The repo's own source files (its tsconfig's) and its compiler options. */
export function project(root: string): { files: string[]; options: ts.CompilerOptions } {
  const configFile = path.join(root, 'tsconfig.json');
  const { config } = ts.readConfigFile(configFile, (file) => ts.sys.readFile(file)) as { config: unknown };
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
  return { files: parsed.fileNames.filter((f) => f.endsWith('.ts')), options: parsed.options };
}

/**
 * The calls that reach a plugin by its id (its panel, its routes, its state, whether it's on) and the routes it's
 * mounted at, written out with the id: the core reaches plugins only through `Plugins`, never naming one, so a core
 * file has none.
 */
const REACHES = [
  /\b(?:openPlugin|openPluginPanel|clientPlugin|callPlugin|pluginState|pluginOn|uses)\s*(?:<[^>()]*>)?\(\s*(?:[^,()'"`]+,\s*)?(['"`])([a-z][a-z0-9-]*)\1/g,
  /\/api\/plugins\/([a-z][a-z0-9-]*)/g,
];

/** Where `text` reaches a plugin by its id written out (`REACHES`): the line, and the id. */
export function pluginsNamed(text: string): { line: number; id: string }[] {
  return text.split('\n').flatMap((line, i) =>
    REACHES.flatMap((re) => [...line.matchAll(re)].map((m) => ({ line: i + 1, id: m[2] ?? m[1] ?? '' }))));
}
