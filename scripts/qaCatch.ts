// QA's catch rate (docs/qa-catch.md): takes recently merged goal pull requests, and for each plants one known bug in
// a line it added (server/agents/qaCatch.ts), in a throwaway clone of its code, then runs the QA officer's own review
// on it (its system prompt, prompt, report schema and model) and scores whether QA failed it and pointed at the bug.
// Nothing goes to GitHub and no real pull request is touched: each clone is made from the office's copy of the repo
// (~/.focus/repos), reviewed where it is and deleted. It saves each run in ~/.focus/qa-catch/, which `pnpm run flow`
// shows among its quality guards. Each review costs what a QA review does (about $0.60 and a few minutes).
//
//   pnpm run qa-catch                 10 pull requests, two reviews at a time
//   pnpm run qa-catch --prs 4         fewer (or more)
//   pnpm run qa-catch --repo o/r      only one repo's
//   pnpm run qa-catch --dry           plant the bugs and say where, without running any review

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { paths } from '../server/config';
import { claudeConfig } from '../server/agents/claudeRunner';
import { parseQaReport, QA_SCHEMA, qaAgentModel, qaPrompt, qaSystemAppend } from '../server/agents/qa';
import { addedLines, type CatchResult, catchLines, plant, type Planted, scoreReport } from '../server/agents/qaCatch';
import type { PullRequestDetail } from '../server/github/provider';
import { checkLedger, closedGoals } from '../shared/ledger';
import type { Project, Settings } from '../shared/types';

const run = promisify(execFile);
const BIG = { maxBuffer: 64 * 1024 * 1024 };
const REVIEW_MS = 25 * 60 * 1000;

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const wanted = Number(opt('prs') ?? 10);
const onlyRepo = opt('repo');
const dry = args.includes('--dry');

const state = JSON.parse(readFileSync(paths.state, 'utf8')) as { settings: Settings; projects: Project[] };
const ledger = checkLedger(readFileSync(paths.ledger, 'utf8')).events;
// the goals' merged pull requests, newest first, in repos the office has a copy of
const candidates = closedGoals(ledger)
  .flatMap((g) => g.prs.filter((p) => p.outcome === 'merged').map((p) => ({ repo: p.repo, pr: p.number, at: g.closedAt })))
  .filter((p) => (!onlyRepo || p.repo === onlyRepo) && existsSync(path.join(paths.mirrors, p.repo.replace('/', '__'))))
  .sort((a, b) => b.at - a.at);

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

/** A clone of the pull request's head with one bug planted and committed on top, or why there's none. */
async function prepare(repo: string, number: number, root: string): Promise<{ dir: string; pr: PullRequestDetail; planted: Planted } | string> {
  const { stdout } = await run('gh', ['pr', 'view', String(number), '-R', repo, '--json', 'number,title,body,url,headRefName,baseRefName,headRefOid,baseRefOid,author'], BIG);
  const info = JSON.parse(stdout) as Pr;
  const dir = path.join(root, `${repo.replace('/', '__')}-${number}`);
  const git = async (...a: string[]) => (await run('git', ['-C', dir, ...a], BIG)).stdout;
  await run('git', ['clone', '--quiet', '--shared', '--no-checkout', path.join(paths.mirrors, repo.replace('/', '__')), dir], BIG);
  // the head and base may never have reached the office's copy: fetch them from GitHub into the clone alone
  for (const oid of [info.headRefOid, info.baseRefOid]) {
    if (await git('cat-file', '-e', `${oid}^{commit}`).then(() => true, () => false)) continue;
    await git('fetch', '--quiet', `https://github.com/${repo}`, `pull/${number}/head`, info.baseRefName);
  }
  await git('checkout', '--quiet', '--detach', info.headRefOid);
  // QA diffs against origin/<base>: the base as the pull request was opened against
  await git('update-ref', `refs/remotes/origin/${info.baseRefName}`, info.baseRefOid);
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
  return { dir, pr, planted };
}

/** The QA officer's review of the planted clone, as the office runs one, scored against the bug. */
async function review(repo: string, dir: string, pr: PullRequestDetail, planted: Planted): Promise<CatchResult> {
  const project = state.projects.find((p) => p.repos.includes(repo)) ?? { name: repo };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REVIEW_MS);
  const started = Date.now();
  try {
    let structured: unknown;
    let text = '';
    let costUsd: number | undefined;
    for await (const msg of query({
      prompt: qaPrompt(repo, pr, []),
      options: {
        cwd: dir,
        abortController: abort,
        model: qaAgentModel(state.settings),
        ...claudeConfig(state.settings.userClaudeMd, process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: qaSystemAppend({ name: 'Lt. Replay' }, project, pr, pr.headSha) },
        outputFormat: { type: 'json_schema', schema: QA_SCHEMA },
        disallowedTools: ['AskUserQuestion', 'EnterPlanMode'],
        // a throwaway clone, deleted after: nobody is there to answer a permission prompt
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    })) {
      if (msg.type !== 'result') continue;
      costUsd = msg.total_cost_usd;
      if (msg.subtype === 'success') {
        structured = msg.structured_output;
        text = msg.result;
      }
    }
    const report = parseQaReport(structured, text);
    const minutes = Math.round((Date.now() - started) / 60_000);
    if (!report) return { repo, pr: pr.number, planted, outcome: 'error', summary: 'QA finished without a report', costUsd, minutes };
    return { repo, pr: pr.number, planted, outcome: scoreReport(report, planted), summary: report.summary, costUsd, minutes };
  } catch (err) {
    return { repo, pr: pr.number, planted, outcome: 'error', summary: (err as Error).message.split('\n')[0], minutes: Math.round((Date.now() - started) / 60_000) };
  } finally {
    clearTimeout(timer);
  }
}

const root = mkdtempSync(path.join(os.tmpdir(), 'focus-qa-catch-'));
const results: CatchResult[] = [];
const skipped: string[] = [];
try {
  const queue = [...candidates];
  const worker = async () => {
    for (let next = queue.shift(); next && results.length < wanted; next = queue.shift()) {
      const ready = await prepare(next.repo, next.pr, root).catch((err: Error) => `${next.repo}#${next.pr}: ${err.message.split('\n')[0]}`);
      if (typeof ready === 'string') {
        skipped.push(ready);
        continue;
      }
      if (results.length >= wanted) break;
      const placeholder: CatchResult = { repo: next.repo, pr: next.pr, planted: ready.planted, outcome: 'error', summary: dry ? 'not reviewed (--dry)' : 'under review' };
      results.push(placeholder);
      console.log(`planted in ${next.repo}#${next.pr}: ${ready.planted.file}:${ready.planted.line} ${ready.planted.bug}`);
      if (dry) continue;
      Object.assign(placeholder, await review(next.repo, ready.dir, ready.pr, ready.planted));
      console.log(`  ${placeholder.outcome} (${placeholder.minutes ?? '?'} min, $${(placeholder.costUsd ?? 0).toFixed(2)})`);
      rmSync(ready.dir, { recursive: true, force: true });
    }
  };
  await Promise.all(Array.from({ length: dry ? 1 : 2 }, worker));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!dry) console.log(`\n${catchLines(results).join('\n')}`);
if (skipped.length) console.log(`\n${skipped.length} pull request${skipped.length === 1 ? '' : 's'} passed over: ${skipped.slice(0, 5).join('; ')}${skipped.length > 5 ? '; …' : ''}`);
if (!dry && results.length) {
  mkdirSync(paths.qaCatch, { recursive: true });
  const file = path.join(paths.qaCatch, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ at: Date.now(), model: qaAgentModel(state.settings) ?? 'default', results }, null, 2));
  console.log(`\nSaved in ${file}`);
}
