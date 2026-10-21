// The bug replay (docs/bug-corpus.md#replaying-qa): for each case in the bug corpus traced to the commit that brought
// its bug in, runs the QA officer's own review on that commit, as a pull request against the commit before it, in a
// throwaway clone of this repo, and scores whether QA failed it and pointed at the bug (server/agents/bugReplay.ts).
// Every one of those commits got past QA once. With --control it also reviews commits no listed bug came from, so a QA
// that fails everything can't look like one that catches everything. Nothing goes to GitHub. It saves each run in
// ~/.focus/bug-replay/. Each review costs what a QA review does (about $0.60 and a few minutes).
//
//   pnpm run bug-replay                 every commit a traced bug came from, two reviews at a time
//   pnpm run bug-replay --commits 3     the first few of them
//   pnpm run bug-replay --only <sha>    one commit a bug came from
//   pnpm run bug-replay --control       as many code-changing commits no listed bug came from, reviewed the same way
//   pnpm run bug-replay --dry           say what it would review, without running any review
//
// QA blocks a change only with proof that holds when it's checked (docs/qa.md#proof): tools/qaReview.ts checks it in
// the clone as Ops does in its checkout, so a review stops a change when its (checked) verdict is a fail.
// A catch counts only when a judge (a separate model, holding the fix's own diff as the answer key) says one of the
// review's findings is the very bug the fix fixed; whether the report merely named the bug's file is kept beside it.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BugCase } from '../server/agents/bugCorpus';
import { parseFixes, prNumber } from '../server/agents/bugCorpus';
import {
  changesCode,
  JUDGE_SCHEMA,
  JUDGE_SYSTEM,
  type Judged,
  judgePrompt,
  pickControls,
  pointsAt,
  type ReplayControl,
  replayLines,
  type ReplayResult,
  type ReplayRun,
  scoreReplay,
  sitesOf,
} from '../server/agents/bugReplay';
import { runReadOnly } from '../server/agents/claudeCrew';
import { qaAgentModel } from '../server/agents/qa';
import { config, paths } from '../server/config';
import type { PullRequestDetail } from '../server/github/provider';
import { errorMessage, run } from '../server/util';
import type { Project, Settings } from '../shared/types';
import { review } from './qaReview';

const ROOT = process.cwd();
const REPO = 'jonhilt/focus';
const OUT = path.join(config.dataDir, 'bug-replay');
const BASE = 'main';

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const dry = args.includes('--dry');
const control = args.includes('--control');
const arm = 'proof';
/** The judge: a different model from QA's, so it isn't grading its own kind of answer. */
const JUDGE_MODEL = 'claude-opus-5-5';

const git = (...a: string[]) => run('git', a, { cwd: ROOT });
const state = JSON.parse(readFileSync(paths.state, 'utf8')) as { settings: Settings; projects: Project[] };
// the corpus is this repo's own, written by tools/bugCorpus.ts
const corpus = JSON.parse(readFileSync(path.join(ROOT, 'tools', 'bug-corpus', 'corpus.json'), 'utf8')) as { cases: BugCase[] };
const traced = corpus.cases.filter((c) => c.introducedBy);
/** The commits to review, each with the bugs it brought in, in the corpus's order. The repo's first commit is left out:
 *  there's nothing before it to review it against. */
const grouped = new Map<string, BugCase[]>();
for (const c of traced) if (c.introducedBy) grouped.set(c.introducedBy.sha, [...(grouped.get(c.introducedBy.sha) ?? []), c]);
const rootless = await Promise.all([...grouped].map(async ([sha, bugs]) => ((await git('rev-parse', '--verify', '--quiet', `${sha}^1`).then(() => true, () => false)) ? [[sha, bugs] as const] : [])));
const roots = traced.filter((c) => !rootless.flat().some(([sha]) => sha === c.introducedBy?.sha)).length;
const only = opt('only');
const commits = rootless
  .flat()
  .filter(([sha]) => !only || sha.startsWith(only))
  .slice(0, Number(opt('commits') ?? Infinity));
const cases = commits.flatMap(([, bugs]) => bugs);

/** A clone of this repo at `sha`, with origin/main at the commit before it, so QA's diff is exactly what `sha` changed. */
async function cloneAt(sha: string, root: string): Promise<string> {
  const dir = mkdtempSync(path.join(root, `${sha.slice(0, 7)}-`));
  await run('git', ['clone', '--quiet', '--shared', '--no-checkout', ROOT, dir]);
  await run('git', ['-C', dir, 'checkout', '--quiet', '--detach', sha]);
  await run('git', ['-C', dir, 'update-ref', `refs/remotes/origin/${BASE}`, (await git('rev-parse', `${sha}^1`)).trim()]);
  return dir;
}

/** The commit as QA's pull request: its own pull request's title and body when it landed one, else its message. */
async function asPullRequest(sha: string): Promise<PullRequestDetail> {
  const [subject = '', ...body] = (await git('log', '-1', '--format=%B', sha)).split('\n');
  const number = prNumber(subject);
  const info = number
    ? await run('gh', ['pr', 'view', String(number), '-R', REPO, '--json', 'title,body,url,headRefName']).then((o) => JSON.parse(o) as { title: string; body: string; url: string; headRefName: string }, () => undefined)
    : undefined;
  return {
    number: number ?? 0,
    title: info?.title ?? subject,
    body: info?.body ?? body.join('\n').trim(),
    url: info?.url ?? '',
    branch: info?.headRefName ?? `replay/${sha.slice(0, 7)}`,
    baseBranch: BASE,
    headSha: sha,
    linkedIssues: [],
  };
}

async function reviewAt(sha: string, root: string) {
  const dir = await cloneAt(sha, root);
  try {
    const r = await review(REPO, dir, await asPullRequest(sha), state);
    // the report's verdict is already the checked one: a fail stands only with proof that held
    return { ...r, blocked: r.report?.verdict === 'fail' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The judge's call on whether a review found the bug a fix fixed, with the fix's diff (code, not its tests) as the answer key. */
async function judge(bug: BugCase, report: NonNullable<Awaited<ReturnType<typeof reviewAt>>['report']>): Promise<{ judged: Judged; costUsd: number }> {
  const diff = await git('diff', `${bug.fix}^`, bug.fix, '--', '.', ':(exclude)*.test.ts');
  const result = await runReadOnly({
    cwd: os.tmpdir(),
    system: JUDGE_SYSTEM,
    systemAppend: '',
    prompt: judgePrompt({ subject: bug.subject, diff }, report),
    settings: state.settings,
    signal: new AbortController().signal,
    activity: () => undefined,
    builtins: [],
    schema: JUDGE_SCHEMA,
    model: JUDGE_MODEL,
    maxTurns: 2,
    timeoutMs: 3 * 60_000,
  });
  const j = result.structured as Partial<Judged> | undefined;
  return { judged: { sameBug: j?.sameBug === true, finding: String(j?.finding ?? ''), why: String(j?.why ?? '') }, costUsd: result.costUsd ?? 0 };
}

/** One review of a commit that brought bugs in, scored against each of them: a review can catch one and miss another. */
async function replay(sha: string, bugs: BugCase[], root: string): Promise<ReplayResult[]> {
  const r = await reviewAt(sha, root);
  const results: ReplayResult[] = [];
  for (const bug of bugs) {
    const by = bug.introducedBy;
    const base = { fix: bug.fix, kind: bug.kind, introducedBy: sha, ...(by?.pr && { pr: by.pr }), costUsd: (r.costUsd ?? 0) / bugs.length, minutes: r.minutes };
    if (!r.report) {
      results.push({ ...base, outcome: 'error', summary: r.error ?? 'QA finished without a report' });
      continue;
    }
    const sites = sitesOf(by?.lines ?? [], [...new Set(bug.buggyLines.map((l) => l.file))]);
    // only a review that stopped the change can have caught the bug: the judge isn't asked about one that let it through
    const j = r.blocked ? await judge(bug, r.report) : undefined;
    results.push({
      ...base,
      costUsd: base.costUsd + (j?.costUsd ?? 0),
      outcome: scoreReplay(r.blocked, j?.judged.sameBug ?? false),
      summary: r.report.summary,
      pointed: pointsAt(r.report, sites),
      ...(j && { judged: j.judged }),
      report: r.report,
    });
  }
  return results;
}

async function controlled(c: { sha: string; subject: string }, root: string): Promise<ReplayControl> {
  const r = await reviewAt(c.sha, root);
  const base = { sha: c.sha, ...(prNumber(c.subject) && { pr: prNumber(c.subject) }), costUsd: r.costUsd, minutes: r.minutes };
  return r.report
    ? { ...base, outcome: r.blocked ? 'false-alarm' : 'clean', summary: r.report.summary, report: r.report }
    : { ...base, outcome: 'error', summary: r.error ?? 'QA finished without a report' };
}

/** Commits on main over the cases' span that no listed bug came from and no listed fix made: as many as there are cases. */
async function controlsFor(): Promise<{ sha: string; subject: string }[]> {
  // each commit with the files it changed: `@<sha> <subject>` then its files
  const log = await git('log', '--first-parent', '-m', '--reverse', '--name-only', '--format=@%H %s', BASE);
  const history: { sha: string; subject: string; files: string[] }[] = [];
  for (const line of log.split('\n').filter(Boolean)) {
    if (line.startsWith('@')) history.push({ sha: line.slice(1, 41), subject: line.slice(42), files: [] });
    else history.at(-1)?.files.push(line);
  }
  const fixes = parseFixes(readFileSync(path.join(ROOT, 'tools', 'bug-corpus', 'fixes.txt'), 'utf8')).map((f) => f.sha);
  const introducers = corpus.cases.flatMap((c) => (c.introducedBy ? [c.introducedBy.sha] : []));
  const shas = history.map((h) => h.sha);
  const from = Math.min(...introducers.map((s) => shas.indexOf(s)).filter((i) => i >= 0));
  const code = history.slice(Math.max(0, from)).filter((h) => prNumber(h.subject) !== undefined && changesCode(h.files));
  return pickControls(code, new Set([...fixes, ...introducers]), commits.length);
}

async function main() {
  const picked = control ? await controlsFor() : [];
  console.log(`${cases.length} real bugs to replay in ${commits.length} commits that brought them in (of ${corpus.cases.length} cases, ${traced.length} traced, ${roots} to the repo's first commit)${picked.length ? `, ${picked.length} controls` : ''}`);
  for (const [sha, bugs] of commits) console.log(`  ${bugs.map((b) => b.kind).join(',').padEnd(24)} ${sha.slice(0, 7)} ${bugs[0]?.introducedBy?.subject.slice(0, 80)}`);
  for (const c of picked) console.log(`  control   ${c.sha.slice(0, 7)} ${c.subject.slice(0, 80)}`);
  if (dry) return;

  const root = mkdtempSync(path.join(os.tmpdir(), 'focus-bug-replay-'));
  const results: ReplayResult[] = [];
  const controls: ReplayControl[] = [];
  const jobs: (() => Promise<void>)[] = [
    ...commits.map(([sha, bugs]) => async () => {
      const rs = await replay(sha, bugs, root).catch((err: unknown) => bugs.map((bug): ReplayResult => ({ fix: bug.fix, kind: bug.kind, introducedBy: sha, outcome: 'error', summary: errorMessage(err) })));
      results.push(...rs);
      for (const r of rs) console.log(`  ${r.outcome.padEnd(16)} ${sha.slice(0, 7)} → ${r.fix.slice(0, 7)} (${r.minutes ?? '?'} min)`);
    }),
    ...picked.map((c) => async () => {
      const r = await controlled(c, root).catch((err: unknown): ReplayControl => ({ sha: c.sha, outcome: 'error', summary: errorMessage(err) }));
      controls.push(r);
      console.log(`  control ${r.outcome.padEnd(11)} ${r.sha.slice(0, 7)} (${r.minutes ?? '?'} min, $${(r.costUsd ?? 0).toFixed(2)})`);
    }),
  ];
  try {
    await Promise.all(
      Array.from({ length: 2 }, async () => {
        for (let job = jobs.shift(); job; job = jobs.shift()) await job();
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log(`\n${replayLines(arm, results, controls).join('\n')}`);
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${new Date().toISOString().replace(/[:.]/g, '-')}-${arm}.json`);
  const saved: ReplayRun = { at: Date.now(), arm, model: qaAgentModel(state.settings) ?? 'default', results, ...(controls.length && { controls }) };
  writeFileSync(file, JSON.stringify(saved, null, 2));
  console.log(`\nSaved in ${file}`);
}

await main();
