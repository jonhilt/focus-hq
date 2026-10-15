// Making a repo's map from a checkout of it: its model file, its source files (as git knows them) and their imports,
// read with TypeScript's parser (scan.ts), and its git history (history.ts). The rules are in graph.ts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { errorMessage, run } from '../../server/util';
import { isSource, mapOf, ownerOf, resolveImport } from './graph';
import { historyOf, LOG_ARGS, readLog } from './history';
import { FLOWS_FILE, type FlowRecording } from '../../shared/flows';
import { readModel, readRecording } from './model';
import { importsIn } from './scan';
import { type FileEdge, MODEL_FILE, type RepoMap } from './shared';

/** Each source file's imports that lead to another source file in the repo, file to file, with the names they take. */
async function imports(dir: string, files: readonly string[]): Promise<FileEdge[]> {
  const known = new Set(files);
  const found: FileEdge[] = [];
  for (const file of files) {
    const text = await fs.readFile(path.join(dir, file), 'utf8').catch(() => '');
    for (const { spec, names } of importsIn(file, text)) {
      const to = resolveImport(file, spec, known);
      if (to) found.push({ from: file, to, names });
    }
  }
  return found;
}

/** The repo's recorded run, if it has one: or why it doesn't read. */
async function recorded(dir: string): Promise<{ ok?: FlowRecording; error?: string } | undefined> {
  const raw = await fs.readFile(path.join(dir, FLOWS_FILE), 'utf8').catch(() => undefined);
  if (raw === undefined) return undefined;
  try {
    return { ok: readRecording(JSON.parse(raw)) };
  } catch (err) {
    return { error: `${FLOWS_FILE}: ${errorMessage(err)}` };
  }
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
  const recording = await recorded(dir);
  const files = (await run('git', ['ls-files'], { cwd: dir })).split('\n').filter(isSource);
  const map = mapOf(repo, model, files, await imports(dir, files), recording?.ok);
  // the history's files as the map would own them: source the model has a part for, wherever it was then
  const log = await run('git', LOG_ARGS, { cwd: dir }).catch(() => '');
  const history = log ? historyOf(readLog(log), (f) => (isSource(f) ? ownerOf(f, model) : undefined), map.connections) : undefined;
  return { ...map, commit, ...(history?.commits ? { history } : {}), problems: [...map.problems, ...(recording?.error ? [recording.error] : [])] };
}
