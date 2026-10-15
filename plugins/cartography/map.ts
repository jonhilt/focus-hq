// Making a repo's map from a checkout of it: its model file, its source files (as git knows them) and their imports,
// read with TypeScript's own scanner. The rules are in graph.ts.
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { parse } from 'yaml';
import { errorMessage, run } from '../../server/util';
import { isSource, mapOf, resolveImport } from './graph';
import { readModel } from './model';
import { MODEL_FILE, type RepoMap } from './shared';

/** Each source file's imports that lead to another source file in the repo, file to file. */
async function imports(dir: string, files: readonly string[]): Promise<[string, string][]> {
  const known = new Set(files);
  const found: [string, string][] = [];
  for (const file of files) {
    const text = await fs.readFile(path.join(dir, file), 'utf8').catch(() => '');
    for (const spec of ts.preProcessFile(text, true, true).importedFiles) {
      const to = resolveImport(file, spec.fileName, known);
      if (to) found.push([file, to]);
    }
  }
  return found;
}

const empty = (repo: string, error: string, commit?: string): RepoMap => ({ repo, commit, files: 0, mapped: 0, sizes: {}, connections: [], problems: [], error });

/** The map of `repo`, checked out in `dir`: the model its file says, laid over the imports its code makes. */
export async function mapRepo(repo: string, dir: string): Promise<RepoMap> {
  const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir }).catch(() => '')).trim() || undefined;
  const raw = await fs.readFile(path.join(dir, MODEL_FILE), 'utf8').catch(() => undefined);
  if (raw === undefined) return empty(repo, `No ${MODEL_FILE} on its default branch yet`, commit);
  let model;
  try {
    model = readModel(parse(raw));
  } catch (err) {
    return empty(repo, `${MODEL_FILE}: ${errorMessage(err)}`, commit);
  }
  const files = (await run('git', ['ls-files'], { cwd: dir })).split('\n').filter(isSource);
  return { ...mapOf(repo, model, files, await imports(dir, files)), commit };
}
