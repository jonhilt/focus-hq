// QA's catch rate (docs/qa-catch.md): takes recently merged goal pull requests, and for each plants one known bug in
// a line it added (server/agents/qaCatch.ts), in a throwaway clone of its code, then runs the QA officer's own review
// on it (its system prompt, prompt, report schema and model) and scores whether QA failed it and pointed at the bug.
// Nothing goes to GitHub and no real pull request is touched: each clone is made from Focus's copy of the repo
// (~/.focus/repos), reviewed where it is and deleted. It saves each run in ~/.focus/qa-catch/, which `pnpm run flow`
// shows among its quality guards. Each review costs what a QA review does (about $0.60 and a few minutes).
// What a run takes by default, and the configurations of QA it compares, are in .focus/benchmarks/qa-catch.yaml.
//
//   pnpm run qa-catch                 the benchmark file's pull requests and configurations
//   pnpm run qa-catch --prs 4         fewer (or more)
//   pnpm run qa-catch --repo o/r      only one repo's
//   pnpm run qa-catch --config a,b    only those configurations, the first as the run's own
//   pnpm run qa-catch --dry           plant the bugs and say where, without running any review
//   pnpm run qa-catch --again         the same pull requests as the last run (so the same bugs), to compare
//   pnpm run qa-catch --control       each pull request reviewed again with no bug planted: does QA fail clean code?

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { paths } from '../server/config';
import type { PullRequestDetail } from '../server/github/provider';
import { checkLedger, closedGoals } from '../shared/ledger';
import type { Project, Settings } from '../shared/types';
import { loadBenchmark, pickConfigurations } from '../server/agents/benchmarkFiles';
import { addedLines, type CatchPart, type CatchResult, type CatchRun, catchLines, controlLine, type ControlResult, plant, type Planted, scoreControl, scoreReport } from '../server/agents/qaCatch';
import { latestRun, QA_CATCH_DIR } from '../server/agents/qaCatchRuns';
import { orStop, review, type Seat, seatLine, seats } from './qaReview';

const run = promisify(execFile);
const BIG = { maxBuffer: 64 * 1024 * 1024 };

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const benchmark = await orStop(() => loadBenchmark('qa-catch'));
const wanted = Number(opt('prs') ?? benchmark.sample ?? Infinity);
const onlyRepo = opt('repo');
const dry = args.includes('--dry');
const again = args.includes('--again');
const control = args.includes('--control') || benchmark.controls;
const configurations = await orStop(() => pickConfigurations(benchmark, opt('config')));

const state = JSON.parse(readFileSync(paths.state, 'utf8')) as { settings: Settings; projects: Project[] };
const ledger = checkLedger(readFileSync(paths.ledger, 'utf8')).events;
// the last run's pull requests in its order, or the goals' merged ones, newest first, in repos Focus has a copy of
const candidates = again
  ? (latestRun()?.results ?? []).map((r) => ({ repo: r.repo, pr: r.pr }))
  : closedGoals(ledger)
      .flatMap((g) => g.prs.filter((p) => p.outcome === 'merged').map((p) => ({ repo: p.repo, pr: p.number, at: g.closedAt })))
      .filter((p) => (!onlyRepo || p.repo === onlyRepo) && existsSync(path.join(paths.mirrors, p.repo.replace('/', '__'))))
      .sort((a, b) => b.at - a.at);
if (again && !candidates.length) throw new Error(`--again: no saved run in ${QA_CATCH_DIR}`);

interface Pr {
  number: number;
  title: string;
  body: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  baseRefOid: string;
  author: { login: string } | null;
}

/** A pull request ready to review: its head with one bug planted and committed on top, in a clone nobody reviews (each review gets its own of it). */
interface Prepared {
  dir: string;
  pr: PullRequestDetail;
  planted: Planted;
  /** The pull request's own head, for a control. */
  head: string;
  base: { branch: string; oid: string };
}

/** A clone of the pull request's head with one bug planted and committed on top, or why there's none. */
async function prepare(repo: string, number: number, root: string): Promise<Prepared | string> {
  const { stdout } = await run('gh', ['pr', 'view', String(number), '-R', repo, '--json', 'number,title,body,url,headRefName,baseRefName,headRefOid,baseRefOid,author'], BIG);
  const info = JSON.parse(stdout) as Pr;
  const dir = path.join(root, `${repo.replace('/', '__')}-${number}`);
  const git = async (...a: string[]) => (await run('git', ['-C', dir, ...a], BIG)).stdout;
  await run('git', ['clone', '--quiet', '--shared', '--no-checkout', path.join(paths.mirrors, repo.replace('/', '__')), dir], BIG);
  // the head and base may never have reached Focus's copy: fetch them from GitHub into the clone alone
  for (const oid of [info.headRefOid, info.baseRefOid]) {
    if (await git('cat-file', '-e', `${oid}^{commit}`).then(() => true, () => false)) continue;
    await git('fetch', '--quiet', `https://github.com/${repo}`, `pull/${number}/head`, info.baseRefName);
  }
  await git('checkout', '--quiet', '--detach', info.headRefOid);
  const planted = plant(addedLines(await git('diff', '-U0', `${info.baseRefOid}...${info.headRefOid}`)), number);
  if (!planted) return `${repo}#${number}: nothing it added could take a bug`;
  const file = path.join(dir, planted.file);
  const lines = readFileSync(file, 'utf8').split('\n');
  if (lines[planted.line - 1] !== planted.before) return `${repo}#${number}: ${planted.file}:${planted.line} isn't the line the diff said`;
  lines[planted.line - 1] = planted.after;
  writeFileSync(file, lines.join('\n'));
  await git('-c', 'user.name=Focus QA catch', '-c', 'user.email=qa-catch@focus.invalid', 'commit', '--quiet', '-am', 'Tidy up');
  const pr: PullRequestDetail = {
    number, title: info.title, body: info.body, url: info.url, branch: info.headRefName, baseBranch: info.baseRefName,
    headSha: (await git('rev-parse', 'HEAD')).trim(), author: info.author?.login, linkedIssues: [],
  };
  return { dir, pr, planted, head: info.headRefOid, base: { branch: info.baseRefName, oid: info.baseRefOid } };
}

/** A clone of the prepared one at `sha`, for one review to dirty: QA diffs against origin/<base>, the base as the pull request was opened against. */
async function cloneFor(ready: Prepared, sha: string, name: string): Promise<string> {
  const dir = `${ready.dir}-${name}`;
  await run('git', ['clone', '--quiet', '--shared', '--no-checkout', ready.dir, dir], BIG);
  await run('git', ['-C', dir, 'checkout', '--quiet', '--detach', sha], BIG);
  await run('git', ['-C', dir, 'update-ref', `refs/remotes/origin/${ready.base.branch}`, ready.base.oid], BIG);
  return dir;
}

/** The planted clone's review, scored against its bug. */
async function planted(repo: string, dir: string, pr: PullRequestDetail, bug: Planted, seat: Seat): Promise<Omit<CatchResult, 'planted'>> {
  const r = await review(repo, dir, pr, state, seat);
  const base = { repo, pr: pr.number, costUsd: r.costUsd, minutes: r.minutes };
  return r.report ? { ...base, outcome: scoreReport(r.report, bug), summary: r.report.summary } : { ...base, outcome: 'error', summary: r.error ?? 'QA finished without a report' };
}

/** The clean clone's review: QA failing it is a false alarm. */
async function controlled(repo: string, dir: string, pr: PullRequestDetail, seat: Seat): Promise<ControlResult> {
  const r = await review(repo, dir, pr, state, seat);
  const base = { repo, pr: pr.number, costUsd: r.costUsd, minutes: r.minutes };
  return r.report ? { ...base, outcome: scoreControl(r.report), summary: r.report.summary } : { ...base, outcome: 'error', summary: r.error ?? 'QA finished without a report' };
}

const root = mkdtempSync(path.join(os.tmpdir(), 'focus-qa-catch-'));
const seated = await orStop(() => seats(configurations, state.settings, root));
// each configuration's results, in the order the pull requests were prepared
const parts = new Map<string, { results: CatchResult[]; controls: ControlResult[] }>(seated.map((seat) => [seat.name, { results: [], controls: [] }]));
const partOf = (seat: Seat) => parts.get(seat.name) ?? { results: [], controls: [] };
const tag = (seat: Seat) => (seated.length > 1 ? ` [${seat.name}]` : '');
let prepared = 0;
const skipped: string[] = [];

/** Each configuration's reviews of a prepared pull request: the planted bug, and the clean code for a control. */
async function reviewed(next: { repo: string; pr: number }, ready: Prepared, seat: Seat, placeholder: CatchResult): Promise<void> {
  const dir = await cloneFor(ready, ready.pr.headSha, seat.name);
  Object.assign(placeholder, await planted(next.repo, dir, ready.pr, ready.planted, seat));
  console.log(`  ${next.repo}#${next.pr}${tag(seat)} ${placeholder.outcome} (${placeholder.minutes ?? '?'} min, $${(placeholder.costUsd ?? 0).toFixed(2)})`);
  rmSync(dir, { recursive: true, force: true });
  if (!control) return;
  // the control: the same code as the pull request merged it
  const clean = await cloneFor(ready, ready.head, `${seat.name}-control`);
  const c = await controlled(next.repo, clean, { ...ready.pr, headSha: ready.head }, seat);
  partOf(seat).controls.push(c);
  console.log(`  ${next.repo}#${next.pr}${tag(seat)} control: ${c.outcome} (${c.minutes ?? '?'} min, $${(c.costUsd ?? 0).toFixed(2)})`);
  rmSync(clean, { recursive: true, force: true });
}

try {
  if (seated.length > 1 || seated[0]?.name !== 'main') for (const seat of seated) console.log(`configuration ${seatLine(seat)}`);
  const queue = [...candidates];
  const worker = async () => {
    for (let next = queue.shift(); next && prepared < wanted; next = queue.shift()) {
      const ready = await prepare(next.repo, next.pr, root).catch((err: Error) => `${next.repo}#${next.pr}: ${err.message.split('\n')[0]}`);
      if (typeof ready === 'string') {
        skipped.push(ready);
        continue;
      }
      if (prepared >= wanted) break;
      prepared++;
      console.log(`planted in ${next.repo}#${next.pr}: ${ready.planted.file}:${ready.planted.line} ${ready.planted.bug}`);
      if (dry) continue;
      for (const seat of seated) {
        const placeholder: CatchResult = { repo: next.repo, pr: next.pr, planted: ready.planted, outcome: 'error', summary: 'under review' };
        partOf(seat).results.push(placeholder);
        await reviewed(next, ready, seat, placeholder);
      }
      // after every configuration's reviews: their clones borrow this one's objects
      rmSync(ready.dir, { recursive: true, force: true });
    }
  };
  await Promise.all(Array.from({ length: dry ? 1 : benchmark.concurrency }, worker));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!dry) for (const seat of seated) {
  const { results, controls } = partOf(seat);
  console.log(`\n${seated.length > 1 ? `${seatLine(seat)}\n` : ''}${catchLines(results).join('\n')}${controls.length ? `\n\n${controlLine(controls)}` : ''}`);
}
if (skipped.length) console.log(`\n${skipped.length} pull request${skipped.length === 1 ? '' : 's'} passed over: ${skipped.slice(0, 5).join('; ')}${skipped.length > 5 ? '; …' : ''}`);
const [own, ...others] = seated;
if (!dry && own && partOf(own).results.length) {
  mkdirSync(QA_CATCH_DIR, { recursive: true });
  const file = path.join(QA_CATCH_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const part = (seat: Seat): CatchPart => {
    const { results, controls } = partOf(seat);
    return { model: seat.model ?? 'default', crew: seat.stamp, results, ...(controls.length && { controls }) };
  };
  const saved: CatchRun = { at: Date.now(), config: own.name, ...part(own), ...(others.length && { compared: others.map((seat) => ({ config: seat.name, ...part(seat) })) }) };
  writeFileSync(file, JSON.stringify(saved, null, 2));
  console.log(`\nSaved in ${file}`);
}
