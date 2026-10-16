// How a project's repos are tied together, from their git histories (README.md): repos don't import each other, and a
// commit never spans two, so a change that needs both shows as one person's commits to each, close together. Those
// make a change set; two parts in different repos that keep turning up in the same change sets are coupled, whatever
// language each is written in. Pure: map.ts reads the logs.
import type { CrossCoupling } from './shared';

/** A commit of a repo, with the parts of its model it touched. */
export interface OwnedCommit {
  sha: string;
  /** Its committer's ISO date, and its author's email. */
  date: string;
  author: string;
  parts: string[];
}

/**
 * Commits by the same author no further apart than `windowMs` are one change set; a pair has to turn up in `together`
 * change sets, and in `share` of those that touched either, to be worth saying, and the `kept` most coupled are kept.
 * Two is enough across repos, where changes are rarer than within one: the PetClinic REST API and its Angular front
 * end, over 90 days, tie its pets and visits screens to the API's DTO mappers in 2 of 6 change sets, and three finds
 * nothing at all.
 */
export const CROSS = { windowMs: 2 * 60 * 60 * 1000, together: 2, share: 0.25, kept: 10 } as const;

/** A part of one of the project's repos: `repo#part`. */
const node = (repo: string, part: string) => `${repo}#${part}`;

/** The parts in different repos that change together, from each repo's commits, the most coupled first. */
export function crossCoupling(logs: readonly { repo: string; commits: readonly OwnedCommit[] }[]): CrossCoupling[] {
  // every commit that touched a part, by its author, in time order
  const byAuthor = new Map<string, { at: number; sha: string; nodes: string[] }[]>();
  for (const { repo, commits } of logs)
    for (const c of commits) {
      if (!c.parts.length) continue;
      const list = byAuthor.get(c.author) ?? [];
      list.push({ at: Date.parse(c.date), sha: c.sha, nodes: c.parts.map((p) => node(repo, p)) });
      byAuthor.set(c.author, list);
    }
  // change sets: an author's commits each within the window of the one before
  const sets: Set<string>[] = [];
  for (const commits of byAuthor.values()) {
    commits.sort((a, b) => a.at - b.at);
    let set: Set<string> | undefined;
    let last = -Infinity;
    const seen = new Set<string>();
    for (const c of commits) {
      // the same commit in two repos (a mirror, or the demo's) is one repo, not a tie between two
      if (seen.has(c.sha)) continue;
      seen.add(c.sha);
      if (!set || c.at - last > CROSS.windowMs) sets.push((set = new Set()));
      for (const n of c.nodes) set.add(n);
      last = c.at;
    }
  }
  const repoOf = (n: string) => n.slice(0, n.indexOf('#'));
  const touched = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const set of sets) {
    const nodes = [...set].sort();
    for (const n of nodes) touched.set(n, (touched.get(n) ?? 0) + 1);
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        if (repoOf(nodes[i]) === repoOf(nodes[j])) continue;
        const key = `${nodes[i]} ${nodes[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
  }
  const split = (n: string) => ({ repo: repoOf(n), part: n.slice(n.indexOf('#') + 1) });
  return [...pairs]
    .map(([key, together]): CrossCoupling => {
      const [a, b] = key.split(' ');
      return { a: split(a), b: split(b), together, either: (touched.get(a) ?? 0) + (touched.get(b) ?? 0) - together };
    })
    .filter((c) => c.together >= CROSS.together && c.together / c.either >= CROSS.share)
    .sort((x, y) => y.together / y.either - x.together / x.either || y.together - x.together || `${x.a.repo}${x.a.part}`.localeCompare(`${y.a.repo}${y.a.part}`))
    .slice(0, CROSS.kept);
}
