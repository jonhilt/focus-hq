// The languages the map reads (README.md), each behind the one interface: which files are its source, and what each
// of them uses of the others. Git history and recorded runs don't care what a file's written in; only imports do.
import { isJava, isTypeScript, resolveImport } from './graph';
import { javaEdges } from './java';
import { importsIn } from './scan';
import type { FileEdge } from './shared';

export interface Language {
  id: string;
  /** Whether a file is source in this language the map reads (not a test). */
  source: (file: string) => boolean;
  /** Each of `files` (path to text, every source file of the language in the repo) to the others it uses, with the names it takes. */
  edges: (files: ReadonlyMap<string, string>) => FileEdge[];
}

const typescript: Language = {
  id: 'typescript',
  source: isTypeScript,
  edges: (files) => {
    const known = new Set(files.keys());
    const found: FileEdge[] = [];
    for (const [file, text] of files)
      for (const { spec, names } of importsIn(file, text)) {
        const to = resolveImport(file, spec, known);
        if (to) found.push({ from: file, to, names });
      }
    return found;
  },
};

const java: Language = { id: 'java', source: isJava, edges: javaEdges };

export const LANGUAGES: readonly Language[] = [typescript, java];

/** Every source file's edges to the others, each language reading its own files (`text` reads one). */
export async function sourceEdges(files: readonly string[], text: (file: string) => Promise<string>): Promise<FileEdge[]> {
  const edges: FileEdge[] = [];
  for (const language of LANGUAGES) {
    const mine = files.filter(language.source);
    if (!mine.length) continue;
    const texts = new Map(await Promise.all(mine.map(async (f) => [f, await text(f)] as const)));
    edges.push(...language.edges(texts));
  }
  return edges;
}
