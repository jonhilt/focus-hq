// Rework after merge (docs/flow.md): of the lines a goal's pull request added, how many were changed or deleted again
// on its base branch within REWORK_DAYS of it merging. GitHub says what the pull request added (its commits, its merge
// commit, the lines each file gained); `git blame` on the base branch REWORK_DAYS later says which of those lines are
// still there. Lead time that comes down while rework goes up hasn't really come down. The I/O is in scripts/flow.ts.

/** How long after a merge a line changed again counts as rework. */
export const REWORK_DAYS = 7;
export const REWORK_MS = REWORK_DAYS * 24 * 60 * 60 * 1000;

/** One merged pull request: the lines it added that count, and how many of them were still there `REWORK_DAYS` on. */
export interface PrRework {
  repo: string;
  pr: number;
  goal?: string;
  mergedAt: number;
  added: number;
  survived: number;
  /** Merged `REWORK_DAYS` or more ago: its count is final. A newer one's is so far. */
  settled: boolean;
}

/** Lock files, pictures, models, builds and minified code: lines no one writes by hand, so they don't count. */
const NOT_WRITTEN = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|packages\.lock\.json)$|\.(glb|gltf|png|jpe?g|gif|webp|svg|ico|mp3|wav|ogg|mp4|blend|lock|min\.js|map)$|(^|\/)(dist|build|node_modules)\//i;

/** Whether a file's added lines count towards rework. */
export const countsFile = (path: string) => !NOT_WRITTEN.test(path);

/**
 * How many lines of a file, as `git blame --porcelain` gives it, still come from one of `commits`: each line of the
 * file has a header line starting with the commit it came from.
 */
export function survivingLines(porcelain: string, commits: Set<string>): number {
  let n = 0;
  for (const m of porcelain.matchAll(/^([0-9a-f]{40}) \d+ \d+/gm)) if (commits.has(m[1])) n++;
  return n;
}

/** A commit and the first line of its message. */
export interface CommitLine {
  oid: string;
  subject: string;
}

/**
 * The commits a merged pull request's lines can come from on its base branch: its own, its merge commit, and, when the
 * merge commit has one parent, the commits leading up to it on the base (`chain`, newest first) that carry one of its
 * own commits' messages: rebased onto the base under new hashes. A squash is its merge commit; a true merge commit
 * keeps the pull request's own.
 */
export function landedCommits(own: CommitLine[], merge: string | undefined, mergeParents: number, chain: CommitLine[]): Set<string> {
  const subjects = new Set(own.map((c) => c.subject));
  const rebased = merge && mergeParents === 1 ? chain.slice(0, own.length).filter((c) => subjects.has(c.subject)) : [];
  return new Set([...own.map((c) => c.oid), ...(merge ? [merge] : []), ...rebased.map((c) => c.oid)]);
}

export interface ReworkTotals {
  prs: number;
  settled: number;
  added: number;
  reworked: number;
  /** Reworked lines over added ones: 0 to 1. */
  rate: number;
  /** The pull requests with the most lines reworked, most first. */
  worst: (PrRework & { reworked: number })[];
}

/** The pull requests' rework summed up, with those that had the most. */
export function reworkTotals(prs: PrRework[], worst = 5): ReworkTotals {
  const each = prs.map((p) => ({ ...p, reworked: Math.max(0, p.added - Math.min(p.survived, p.added)) }));
  const added = each.reduce((n, p) => n + p.added, 0);
  const reworked = each.reduce((n, p) => n + p.reworked, 0);
  return {
    prs: prs.length,
    settled: prs.filter((p) => p.settled).length,
    added,
    reworked,
    rate: added ? reworked / added : 0,
    worst: each.filter((p) => p.reworked > 0).sort((a, b) => b.reworked - a.reworked || a.pr - b.pr).slice(0, worst),
  };
}

/** The guard as the report prints it. */
export function reworkLines(t: ReworkTotals): string[] {
  if (!t.prs) return ['  rework after merge: no merged pull requests to measure'];
  const pct = Math.round(t.rate * 100);
  return [
    `  rework after merge: ${t.reworked} of ${t.added} lines added were changed or deleted within ${REWORK_DAYS} days (${pct}%) · ${t.prs} pull requests, ${t.settled} past ${REWORK_DAYS} days (the rest so far)`,
    ...t.worst.map((p) => `    ${String(p.reworked).padStart(5)} of ${String(p.added).padEnd(5)} ${p.repo.split('/')[1] ?? p.repo}#${p.pr}${p.goal ? `  ${p.goal}` : ''}`),
  ];
}
