// Rework after merge for `pnpm run flow` (../README.md, the rules in ../rework.ts): GitHub says what each
// merged pull request added (gh), and `git blame` in the clone Ops keeps of its repo (~/.focus/repos) says how much of
// that was still there REWORK_DAYS later. Reads only.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { commitLines, countedFiles, landedCommits, parentCount, type PrRework, settledAt, survivalOf, survivingLines } from '../rework';

const run = promisify(execFile);
const BIG = { maxBuffer: 64 * 1024 * 1024 };

interface Pr {
  commits: { oid: string; messageHeadline: string }[];
  mergeCommit: { oid: string } | null;
  files: { path: string; additions: number }[];
  mergedAt: string | null;
  baseRefName: string;
}

type Git = (...args: string[]) => Promise<string>;

/** One pull request's rework, or why it couldn't be measured. */
async function measure(repo: string, pr: number, goal: string | undefined, mirrorOf: (repo: string) => string, now: number): Promise<PrRework | string> {
  const clone = mirrorOf(repo);
  if (!existsSync(clone)) return `${repo}#${pr}: no clone of ${repo} at ${clone}`;
  const { stdout } = await run('gh', ['pr', 'view', String(pr), '-R', repo, '--json', 'commits,mergeCommit,files,mergedAt,baseRefName'], BIG);
  const info = JSON.parse(stdout) as Pr;
  if (!info.mergedAt) return `${repo}#${pr}: not merged`;
  const git: Git = async (...a) => (await run('git', ['-C', clone, ...a], BIG)).stdout.trim();
  const mergedAt = Date.parse(info.mergedAt);
  const settled = settledAt(mergedAt, now);
  const base = `origin/${info.baseRefName}`;
  // a settled count reads the base as it was REWORK_DAYS on; one still counting, as it is now
  const rev = settled ? await git('rev-list', '-1', `--before=${new Date(settled).toISOString()}`, base) : base;
  const { added, survived } = await blamed(git, rev, countedFiles(info.files), await landed(git, info));
  return { repo, pr, goal, mergedAt, added, survived, settled: settled !== undefined };
}

/** The commits the pull request's lines can come from on its base (`landedCommits`). */
async function landed(git: Git, info: Pr): Promise<Set<string>> {
  const merge = info.mergeCommit?.oid;
  const parents = merge ? parentCount(await git('rev-list', '--parents', '-n1', merge)) : 0;
  const chain = merge && parents === 1 ? commitLines(await git('log', '--first-parent', `--max-count=${Math.max(1, info.commits.length)}`, '--format=%H %s', merge)) : [];
  return landedCommits(info.commits.map((c) => ({ oid: c.oid, subject: c.messageHeadline })), merge, parents, chain);
}

/** Each file's added lines still there at `rev`, one `git blame` at a time. */
async function blamed(git: Git, rev: string, files: Pr['files'], commits: Set<string>): Promise<{ added: number; survived: number }> {
  const counted: { additions: number; surviving: number }[] = [];
  for (const f of files) {
    // a file that's gone by then has had every line it gained reworked away
    const blame = await git('blame', '-w', '--porcelain', rev, '--', f.path).catch(() => '');
    counted.push({ additions: f.additions, surviving: survivingLines(blame, commits) });
  }
  return survivalOf(counted);
}

/** Each merged pull request's rework, a few at a time; those it couldn't measure, with why. */
export async function measureRework(prs: { repo: string; pr: number; goal?: string }[], mirrorOf: (repo: string) => string, now = Date.now()): Promise<{ measured: PrRework[]; skipped: string[] }> {
  const measured: PrRework[] = [];
  const skipped: string[] = [];
  const queue = [...prs];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const r = await measure(next.repo, next.pr, next.goal, mirrorOf, now).catch((err: Error) => `${next.repo}#${next.pr}: ${err.message.split('\n')[0]}`);
      if (typeof r === 'string') skipped.push(r);
      else measured.push(r);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { measured: measured.sort((a, b) => a.mergedAt - b.mergedAt), skipped };
}
