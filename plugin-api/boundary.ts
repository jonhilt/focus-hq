// The line between the core and its plugins (docs/plugins.md), as TypeScript resolves imports: a plugin reaches the
// office only through plugin-api/ (testing.ts from its tests alone), another plugin only through that plugin's api.ts
// (what it lends the plugins that require it), and the core never reaches a plugin. boundary.test.ts holds the repo to it.
import path from 'node:path';
import ts from 'typescript';

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

/** Which plugin a file belongs to (its folder under plugins/), or undefined for the core's files. */
export const pluginOf = (file: string): string | undefined => /^plugins\/([^/]+)\//.exec(file)?.[1];

const isTest = (file: string) => file.endsWith('.test.ts');

/** Whether `from` may import `to` (both from the repo's root): undefined if it may, else why not. */
export function refusal(from: string, to: string): string | undefined {
  const plugin = pluginOf(from);
  const target = pluginOf(to);
  if (!plugin) return target ? 'the core reaches into a plugin' : undefined;
  if (target === plugin) return undefined;
  if (target) return to === `plugins/${target}/api.ts` ? undefined : `${plugin} reaches into ${target} past its api.ts`;
  if (to === 'plugin-api/testing.ts') return isTest(from) ? undefined : 'the test kit is for tests only';
  if (to.startsWith('plugin-api/')) return undefined;
  return `${plugin} reaches into the core past plugin-api/`;
}

interface Import {
  spec: string;
  line: number;
  typeOnly: boolean;
}

/** Every module a file's source imports or re-exports from, and whether only for types (erased as it runs). */
export function importsOf(file: string, text: string): Import[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Import[] = [];
  const add = (spec: ts.Expression, node: ts.Node, typeOnly: boolean) => {
    if (ts.isStringLiteral(spec)) found.push({ spec: spec.text, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, typeOnly });
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
  return files.flatMap((file) => importsOf(file, read(file)).flatMap((imp) => {
    const resolved = ts.resolveModuleName(imp.spec, file, options, ts.sys).resolvedModule;
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
