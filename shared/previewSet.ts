import type { Board, Issue, Preview, PreviewSet, PullRequest } from './types';

// Which pull requests a preview runs together. A feature spanning several repos gets an issue per repo, each labelled
// feature:<slug>; a PR belongs to the features of the issues it closes. Pure, so it's unit tested (previewSet.test.ts).

const FEATURE = /^feature:(.+)$/i;

/** The feature slugs among an issue's labels, lower-cased ("feature:Bulk-Export" → "bulk-export"). */
export function featureSlugs(labels: string[]): string[] {
  return labels.flatMap((label) => {
    const slug = FEATURE.exec(label.trim())?.[1].trim().toLowerCase();
    return slug ? [slug] : [];
  });
}

/** The features a PR belongs to: those of the issues it closes in its own repo. */
export function prFeatures(pr: Pick<PullRequest, 'repo' | 'closes'>, issues: Issue[]): Set<string> {
  return new Set(issues.filter((i) => i.repo === pr.repo && pr.closes.includes(i.number)).flatMap((i) => featureSlugs(i.labels)));
}

/** Most recently updated first; without both timestamps, the higher number (the newer PR). */
function newerFirst(a: PullRequest, b: PullRequest): number {
  const at = a.updatedAt ? Date.parse(a.updatedAt) : NaN;
  const bt = b.updatedAt ? Date.parse(b.updatedAt) : NaN;
  return at !== bt && !Number.isNaN(at) && !Number.isNaN(bt) ? bt - at : b.number - a.number;
}

/** The other open PRs that share a feature with `pr`, in any repo, most recently updated first. */
export function linkedPrs(pr: PullRequest, board: Pick<Board, 'issues' | 'prs'>): PullRequest[] {
  const features = prFeatures(pr, board.issues);
  if (!features.size) return [];
  return board.prs
    .filter((other) => !(other.repo === pr.repo && other.number === pr.number))
    .filter((other) => [...prFeatures(other, board.issues)].some((f) => features.has(f)))
    .sort(newerFirst);
}

/**
 * What ▶ Preview on `pr` runs: `pr` in its own repo and, in every other repo, the most recently updated PR linked to it,
 * or the default branch. A PR with no feature gets only itself.
 */
export function previewSet(pr: PullRequest, board: Pick<Board, 'issues' | 'prs'>, repos: string[]): PreviewSet {
  const linked = linkedPrs(pr, board);
  const set: PreviewSet = { [pr.repo]: pr.number };
  for (const repo of repos) if (repo !== pr.repo) set[repo] = linked.find((l) => l.repo === repo)?.number ?? null;
  return set;
}

/**
 * previewSet() with the manager's own picks on top. A pick for a repo outside the project, or for `pr`'s own repo, is
 * ignored; one naming a PR that's no longer open falls back to the default branch (a merged PR is on it by now).
 */
export function chosenSet(pr: PullRequest, board: Pick<Board, 'issues' | 'prs'>, repos: string[], picks: PreviewSet = {}): PreviewSet {
  const set = previewSet(pr, board, repos);
  for (const [repo, number] of Object.entries(picks)) {
    if (repo === pr.repo || !(repo in set)) continue;
    set[repo] = number !== null && board.prs.some((p) => p.repo === repo && p.number === number) ? number : null;
  }
  return set;
}

/** The PRs a preview checks out: the one it was started from, and the ones that came along with it. */
export function previewPrs(preview: Pick<Preview, 'repo' | 'number' | 'checkouts'>): { repo: string; number: number }[] {
  const others = preview.checkouts.flatMap((c) => ('pr' in c.ref && c.repo !== preview.repo ? [{ repo: c.repo, number: c.ref.pr }] : []));
  return [{ repo: preview.repo, number: preview.number }, ...others];
}

/** The PRs a preview checks out that have left the board (merged or closed), so it comes down. A repo GitHub couldn't list doesn't count. */
export function previewPrsGone(preview: Pick<Preview, 'repo' | 'number' | 'checkouts'> | undefined, board: Pick<Board, 'prs' | 'error'>): { repo: string; number: number }[] {
  return (preview ? previewPrs(preview) : []).filter(({ repo, number }) => !board.error?.includes(repo) && !board.prs.some((p) => p.repo === repo && p.number === number));
}

export function previewIncludes(preview: Pick<Preview, 'repo' | 'number' | 'checkouts'>, repo: string, number: number): boolean {
  return previewPrs(preview).some((p) => p.repo === repo && p.number === number);
}
