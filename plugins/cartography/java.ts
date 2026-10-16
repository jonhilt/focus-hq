// What a Java file uses of the repo's other Java files, read from its text without compiling it: its package, its
// imports (a class, a package's classes with `.*`, a static member) and the classes of its own package it names. A class
// is found by the package its file declares, wherever its source root is (src/main/java, a module's, or none), so no
// build file has to be read. Pure: map.ts reads the files.
import type { FileEdge } from './shared';

/** A Java file's text without its comments and string literals, which can mention a class without using it. */
export function code(text: string): string {
  // one pass, so whichever starts first wins: a `//` inside a string, or a quote inside a comment, is left alone
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (m) => (m.startsWith('/') ? ' ' : m[0] === "'" ? "''" : '""'));
}

/** The package a Java file declares ('' for the default package). */
export const packageOf = (src: string): string => /^\s*package\s+([\w.]+)\s*;/m.exec(src)?.[1] ?? '';

/** One import: what it names, whether it's static, and whether it ends in `.*`. */
export interface JavaImport {
  name: string;
  isStatic: boolean;
  wildcard: boolean;
}

export function javaImports(src: string): JavaImport[] {
  return [...src.matchAll(/^\s*import\s+(static\s+)?([\w.]+?)(\.\*)?\s*;/gm)].map((m) => ({ name: m[2], isStatic: !!m[1], wildcard: !!m[3] }));
}

/** The simple name of the class a file is: its name without `.java`. */
const classOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1, -'.java'.length);

/**
 * Each Java file's edges to the others among `files` (path to text): to the class each import names (or the class
 * whose member a static import takes; a nested class's import leads to the file it's in), to the classes of a
 * package imported with `.*` that the file names, and to the classes of its own package that it names. Each edge takes
 * the names it brings in: the class, or the static member.
 */
export function javaEdges(files: ReadonlyMap<string, string>): FileEdge[] {
  const sources = new Map([...files].map(([file, text]) => [file, code(text)]));
  // every class by its qualified name, and every package's classes by their simple names
  const byName = new Map<string, string>();
  const packages = new Map<string, Map<string, string>>();
  for (const [file, src] of sources) {
    const pkg = packageOf(src);
    const name = classOf(file);
    byName.set(pkg ? `${pkg}.${name}` : name, file);
    const members = packages.get(pkg) ?? new Map<string, string>();
    members.set(name, file);
    packages.set(pkg, members);
  }
  /** The file of the class `qualified` names, or of the class it's nested in. */
  const classFile = (qualified: string): string | undefined => {
    for (let at = qualified; at; at = at.includes('.') ? at.slice(0, at.lastIndexOf('.')) : '') {
      const file = byName.get(at);
      if (file) return file;
    }
    return undefined;
  };
  const edges: FileEdge[] = [];
  for (const [file, src] of sources) {
    const found = new Map<string, Set<string>>();
    const add = (to: string | undefined, name: string) => {
      if (!to || to === file) return;
      found.set(to, (found.get(to) ?? new Set()).add(name));
    };
    // the capitalised words the file uses, for the classes it names without importing them one by one
    const words = new Set(src.match(/\b[A-Z]\w*\b/g) ?? []);
    const named = (pkg: string) => {
      for (const [name, to] of packages.get(pkg) ?? []) if (words.has(name)) add(to, name);
    };
    for (const imp of javaImports(src)) {
      const last = imp.name.slice(imp.name.lastIndexOf('.') + 1);
      if (imp.isStatic) add(classFile(imp.wildcard ? imp.name : imp.name.slice(0, imp.name.lastIndexOf('.'))), imp.wildcard ? '*' : last);
      else if (imp.wildcard) {
        // a package's classes, or a class's nested ones
        if (packages.has(imp.name)) named(imp.name);
        else add(classFile(imp.name), '*');
      } else add(classFile(imp.name), last);
    }
    named(packageOf(src));
    for (const [to, names] of found) edges.push({ from: file, to, names: [...names] });
  }
  return edges;
}
