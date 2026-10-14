// Rework after merge for `pnpm run flow` (docs/flow.md, the rules in server/agents/rework.ts): GitHub says what each
// merged pull request added (gh), and `git blame` in the office's clone of its repo (~/.focus/repos) says how much of
// that was still there REWORK_DAYS later. Reads only.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { countsFile, landedCommits, type PrRework, REWORK_MS, survivingLines } from '../server/agents/rework';

const run = promisify(execFile);
const BIG = { maxBuffer: 64 * 1024 * 1024 };

interface Pr {
  commits: { oid: string; messageHeadline: string }[];
  mergeCommit: { oid: string } | null;
  files: { path: string; additions: number }[];
  mergedAt: string | null;
  baseRefName: string;
}

/** One pull request's rework, or why it couldn't be measured. */
async function measure(repo: string, pr: number, goal: string | undefined, mirrors: string, now: number): Promise<PrRework | string> {
  const clone = path.join(mirrors, repo.replace('/', '__'));
  if (!existsSync(clone)) return `${repo}#${pr}: no clone of ${repo} in ${mirrors}`;
  const { stdout } = await run('gh', ['pr', 'view', String(pr), '-R', repo, '--json', 'commits,mergeCommit,files,mergedAt,baseRefName'], BIG);
  const info = JSON.parse(stdout) as Pr;
  if (!info.mergedAt) return `${repo}#${pr}: not merged`;
  const mergedAt = Date.parse(info.mergedAt);
  const settled = now - mergedAt >= REWORK_MS;
  const base = `origin/${info.baseRefName}`;
  const rev = settled ? (await run('git', ['-C', clone, 'rev-list', '-1', `--before=${new Date(mergedAt + REWORK_MS).toISOString()}`, base])).stdout.trim() : base;
  const merge = info.mergeCommit?.oid;
  const git = async (...a: string[]) => (await run('git', ['-C', clone, ...a], BIG)).stdout.trim();
  const parents = merge ? (await git('rev-list', '--parents', '-n1', merge)).split(/\s+/).length - 1 : 0;
  const chain = merge && parents === 1
    ? (await git('log', '--first-parent', `--max-count=${Math.max(1, info.commits.length)}`, '--format=%H %s', merge)).split('\n').map((l) => ({ oid: l.slice(0, 40), subject: l.slice(41) }))
    : [];
  const commits = landedCommits(info.commits.map((c) => ({ oid: c.oid, subject: c.messageHeadline })), merge, parents, chain);
  let added = 0;
  let survived = 0;
  for (const f of info.files.filter((f) => f.additions > 0 && countsFile(f.path))) {
    added += f.additions;
    // a file that's gone by then has had every line it gained reworked away
    const blame = await run('git', ['-C', clone, 'blame', '-w', '--porcelain', rev, '--', f.path], BIG).then((r) => r.stdout, () => '');
    survived += Math.min(f.additions, survivingLines(blame, commits));
  }
  return { repo, pr, goal, mergedAt, added, survived, settled };
}

/** Each merged pull request's rework, a few at a time; those it couldn't measure, with why. */
export async function measureRework(prs: { repo: string; pr: number; goal?: string }[], mirrors: string, now = Date.now()): Promise<{ measured: PrRework[]; skipped: string[] }> {
  const measured: PrRework[] = [];
  const skipped: string[] = [];
  const queue = [...prs];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const r = await measure(next.repo, next.pr, next.goal, mirrors, now).catch((err: Error) => `${next.repo}#${next.pr}: ${err.message.split('\n')[0]}`);
      if (typeof r === 'string') skipped.push(r);
      else measured.push(r);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { measured: measured.sort((a, b) => a.mergedAt - b.mergedAt), skipped };
}
