// What a source file imports, and the names it takes from each: read with TypeScript's parser, without type-checking.
import ts from 'typescript';

/** One import (or re-export) in a file: where from, and the names it brings in. */
export interface FileImport {
  spec: string;
  /** The names it takes, as the other file exports them (`default` for its default, `*` for all of it). */
  names: string[];
}

function bindings(clause: ts.ImportClause | undefined): string[] {
  if (!clause) return [];
  const names = clause.name ? ['default'] : [];
  const b = clause.namedBindings;
  if (b && ts.isNamespaceImport(b)) names.push('*');
  if (b && ts.isNamedImports(b)) for (const e of b.elements) names.push((e.propertyName ?? e.name).text);
  return names;
}

function exported(clause: ts.NamedExportBindings | undefined): string[] {
  if (!clause || ts.isNamespaceExport(clause)) return ['*'];
  return clause.elements.map((e) => (e.propertyName ?? e.name).text);
}

/** The imports in `text` (file `file`): static ones, re-exports, and `import('…')` calls. */
export function importsIn(file: string, text: string): FileImport[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const found: FileImport[] = [];
  for (const s of source.statements) {
    if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) found.push({ spec: s.moduleSpecifier.text, names: bindings(s.importClause) });
    else if (ts.isExportDeclaration(s) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) found.push({ spec: s.moduleSpecifier.text, names: exported(s.exportClause) });
  }
  if (text.includes('import(')) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
        found.push({ spec: node.arguments[0].text, names: ['*'] });
      node.forEachChild(visit);
    };
    source.forEachChild(visit);
  }
  return found;
}
