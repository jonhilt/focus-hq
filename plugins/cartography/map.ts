// Making a repo's map from a checkout of it: its model file, its source files (as git knows them) and what each uses of
// the others, read by its language (languages.ts: TypeScript's parser, or Java's imports and packages), and its git
// history (history.ts). The rules are in graph.ts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { errorMessage, FLOWS_FILE, type FlowRecording, run } from '../../plugin-api/server';
import { isSource, mapOf, ownerOf } from './graph';
import type { OwnedCommit } from './crossRepo';
import { historyOf, LOG_ARGS, readLog } from './history';
import { readModel, readRecording } from './model';
import { sourceEdges } from './languages';
import { isSpec, repoRoutes, type RepoRoutes } from './routes';
import { type ChangedFile, readNumstat } from './slice';
import { type FileEdge, MODEL_FILE, type RepoMap } from './shared';

/** Each source file's uses of another source file in the repo, file to file, with the names they take. */
const imports = (dir: string, files: readonly string[]): Promise<FileEdge[]> => sourceEdges(files, (file) => fs.readFile(path.join(dir, file), 'utf8').catch(() => ''));

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

/**
 * The map of `repo`, checked out in `dir`: the model its file says, laid over the imports its code makes; and how its
 * parts changed in git, unless `history` is false (a lead's checkout, mapped for what its slice changes).
 */
export async function mapRepo(repo: string, dir: string, options: { history?: boolean } = {}): Promise<RepoMap> {
  return (await mapRepoAndLog(repo, dir, options)).map;
}

/**
 * The map of `repo` (mapRepo), its commits in the history's window with the parts each touched (crossRepo.ts), and the
 * routes it declares and calls (routes.ts): what ties it to the other repos of its project.
 */
export async function mapRepoAndLog(repo: string, dir: string, { history: withHistory = true } = {}): Promise<{ map: RepoMap; commits: OwnedCommit[]; routes: RepoRoutes }> {
  const none = { repo, declared: [], called: [] };
  const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir }).catch(() => '')).trim() || undefined;
  const raw = await fs.readFile(path.join(dir, MODEL_FILE), 'utf8').catch(() => undefined);
  if (raw === undefined) return { map: empty(repo, `No ${MODEL_FILE} on its default branch yet`, commit), commits: [], routes: none };
  let model;
  try {
    model = readModel(parse(raw));
  } catch (err) {
    return { map: empty(repo, `${MODEL_FILE}: ${errorMessage(err)}`, commit), commits: [], routes: none };
  }
  const recording = await recorded(dir);
  const known = (await run('git', ['ls-files'], { cwd: dir })).split('\n');
  const files = known.filter(isSource);
  const map = mapOf(repo, model, files, await imports(dir, files), recording?.ok);
  // the history's files as the map would own them: source the model has a part for, wherever it was then
  const log = withHistory ? await run('git', LOG_ARGS, { cwd: dir }).catch(() => '') : '';
  const owner = (f: string) => (isSource(f) ? ownerOf(f, model) : undefined);
  const logged = log ? readLog(log) : [];
  const history = log ? historyOf(logged, owner, map.connections, Date.now()) : undefined;
  const commits = logged.map((c) => ({ sha: c.sha, date: c.date, author: c.author ?? '', parts: [...new Set(c.files.flatMap((f) => owner(f.path) ?? []))] }));
  const read = (file: string) => fs.readFile(path.join(dir, file), 'utf8').catch(() => '');
  const routeFiles = known.filter((f) => isSource(f) || isSpec(f));
  const routes = repoRoutes(repo, new Map(await Promise.all(routeFiles.map(async (f) => [f, await read(f)] as const))), (f) => (isSource(f) ? ownerOf(f, model) : undefined));
  return { map: { ...map, commit, ...(history?.commits ? { history } : {}), problems: [...map.problems, ...(recording?.error ? [recording.error] : [])] }, commits, routes };
}

/**
 * The files a checkout in `dir` has changed since it left `baseBranch`, committed or not: against where it forked from
 * the branch on GitHub (or the local one, without a remote), with each new file not yet added counted line by line.
 */
export async function changedFiles(dir: string, baseBranch: string): Promise<ChangedFile[]> {
  const git = (args: string[]) => run('git', args, { cwd: dir });
  const base = (await git(['merge-base', 'HEAD', `origin/${baseBranch}`]).catch(() => git(['merge-base', 'HEAD', baseBranch]))).trim();
  const changed = readNumstat(await git(['diff', '--numstat', '--no-renames', base]));
  const added = (await git(['ls-files', '--others', '--exclude-standard'])).split('\n').filter(isSource);
  const counted = await Promise.all(added.map(async (file) => ({ path: file, lines: (await fs.readFile(path.join(dir, file), 'utf8').catch(() => '')).split('\n').length })));
  return [...changed, ...counted];
}
