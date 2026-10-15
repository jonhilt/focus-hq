// How a repo's architecture changes, from its git history (README.md): which parts change most (hotspots), and which
// change together (change coupling), the way behavioural code analysis reads a log. Git is the witness here, not the
// model: two parts that keep changing together with no import between them are coupled in a way the map's arrows can't
// show. Pure: map.ts runs the git log.
import type { MapConnection } from './shared';

/** How far back the history goes. */
export const HISTORY_DAYS = 90;
/** A commit touching more source files than this is a sweep (a rename, a reformat), not a change that couples parts. */
export const SWEEP_FILES = 40;
/** A pair has to change together this often to be worth saying, and in this share of the commits that touched either. */
export const COUPLING = { together: 5, share: 0.3, kept: 8 } as const;

/** The `git log` arguments whose output `readLog` reads. */
export const LOG_ARGS = ['log', '--no-merges', '--no-renames', `--since=${HISTORY_DAYS} days ago`, '--numstat', '--format=%x1e%H%x1f%cI'];

export interface Commit {
  sha: string;
  date: string;
  /** The files it changed, and how many lines (added and removed; 0 for a binary file). */
  files: { path: string; lines: number }[];
}

/** Commits from `git log` run with LOG_ARGS, newest first. */
export function readLog(text: string): Commit[] {
  return text
    .split('\x1e')
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [head, ...rest] = chunk.split('\n');
      const [sha, date] = head.split('\x1f');
      const files = rest
        .map((line) => /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line))
        .filter((m): m is RegExpExecArray => !!m)
        .map(([, added, removed, path]) => ({ path, lines: (Number(added) || 0) + (Number(removed) || 0) }));
      return { sha, date, files };
    });
}

/** How much a part changed. */
export interface PartChange {
  id: string;
  commits: number;
  lines: number;
}

/** Two parts that keep changing together. */
export interface Coupling {
  a: string;
  b: string;
  /** Commits that changed both, and that changed either. */
  together: number;
  either: number;
  /** Whether either imports the other: when not, the coupling is one the map's arrows don't show. */
  imports: boolean;
}

export interface MapHistory {
  days: number;
  /** Commits in the window that changed any part's code. */
  commits: number;
  /** Every part that changed, the most often first. */
  parts: PartChange[];
  /** The pairs that change together most, by share of the commits touching either. */
  coupling: Coupling[];
}

/** The history of the parts `owner` puts files under, from `commits`, against the import connections the map found. */
export function historyOf(commits: readonly Commit[], owner: (file: string) => string | undefined, connections: readonly MapConnection[]): MapHistory {
  const changes = new Map<string, PartChange>();
  const pairs = new Map<string, number>();
  let counted = 0;
  for (const commit of commits) {
    const touched = new Map<string, number>();
    const owned = commit.files.map((f) => ({ id: owner(f.path), lines: f.lines })).filter((f): f is { id: string; lines: number } => !!f.id);
    for (const f of owned) touched.set(f.id, (touched.get(f.id) ?? 0) + f.lines);
    if (!touched.size) continue;
    counted++;
    for (const [id, lines] of touched) {
      const c = changes.get(id) ?? { id, commits: 0, lines: 0 };
      c.commits++;
      c.lines += lines;
      changes.set(id, c);
    }
    if (owned.length > SWEEP_FILES) continue;
    const ids = [...touched.keys()].sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.set(`${ids[i]} ${ids[j]}`, (pairs.get(`${ids[i]} ${ids[j]}`) ?? 0) + 1);
  }
  const linked = new Set(connections.flatMap((c) => [`${c.from} ${c.to}`, `${c.to} ${c.from}`]));
  const commitsOf = (id: string) => changes.get(id)?.commits ?? 0;
  const coupling = [...pairs]
    .map(([key, together]): Coupling => {
      const [a, b] = key.split(' ');
      return { a, b, together, either: commitsOf(a) + commitsOf(b) - together, imports: linked.has(key) };
    })
    .filter((c) => c.together >= COUPLING.together && c.together / c.either >= COUPLING.share)
    .sort((x, y) => y.together / y.either - x.together / x.either || y.together - x.together || x.a.localeCompare(y.a))
    .slice(0, COUPLING.kept);
  return { days: HISTORY_DAYS, commits: counted, parts: [...changes.values()].sort((x, y) => y.commits - x.commits || y.lines - x.lines || x.id.localeCompare(y.id)), coupling };
}
