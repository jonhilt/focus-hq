import type { SinceVerdict } from './agents/retest';
import { randomHex } from './util';

// The demo's pretend git history of pull requests: the commits pushed to them after they were opened, so the demo
// workspace can say what came onto a PR since QA's verdict. The demo GitHub records pushes here; nothing touches git.

type Pushed = { parent: string; kind: 'merge-base' | 'change' };
const pushed = new Map<string, Pushed>();

/** A new commit on top of `parent`: a clean merge of the base branch, or a change to the PR's own code. */
export function demoCommit(parent: string, kind: Pushed['kind']): string {
  const sha = randomHex(5);
  pushed.set(sha, { parent, kind });
  return sha;
}

/** What came onto a PR since `sha`, as far as the demo's pushes go: each commit pushed on top of it, up to the latest. */
export function demoSinceVerdict(sha: string): SinceVerdict {
  const commits: SinceVerdict['commits'] = [];
  for (let at = sha, next = childOf(at); next; at = next, next = childOf(at)) {
    commits.push({ sha: next, mergesBase: pushed.get(next)?.kind === 'merge-base', clean: true });
  }
  return { head: commits.at(-1)?.sha ?? sha, descends: true, commits, sameChanges: commits.every((c) => c.mergesBase) };
}

const childOf = (sha: string) => [...pushed].find(([, c]) => c.parent === sha)?.[0];
