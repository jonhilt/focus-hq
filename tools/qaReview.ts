// The QA officer's own review of a throwaway clone, as the office runs one (its system prompt, prompt, report schema,
// model and Claude Code settings), for the scripts that replay QA on code it has seen or should have: QA's catch rate
// (tools/qaCatch.ts, planted bugs) and the bug replay (tools/bugReplay.ts, real ones). The clone is the caller's.

import { execFile } from 'node:child_process';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Effect } from 'effect';
import { claudeConfig } from '../server/agents/claudeRunner';
import { filesPrompt, filesToRevisit, openedFiles, parseQaReport, QA_SCHEMA, qaAgentModel, qaPrompt, qaSystemAppend, type ToolCall } from '../server/agents/qa';
import type { PullRequestDetail } from '../server/github/provider';
import { qaProofFor } from '../shared/qa';
import type { Project, QaReport, Settings } from '../shared/types';
import { PROOF_MS, prove, type ProofRig } from '../server/agents/qaProof';
import { readIn, runIn } from '../server/agents/workspace';
import { freePort } from './demoOffice';
import { processesIn, reviewEnv } from './replayRules';

/** QA's proofs checked in the clone, as the office checks them in its checkout: with this checkout's packages when the clone has none. No browser, so no screenshots. */
function proofRig(dir: string, changed: string[]): ProofRig {
  if (!existsSync(path.join(dir, 'node_modules')) && existsSync(path.join(process.cwd(), 'node_modules'))) symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(dir, 'node_modules'));
  return {
    run: (args) => Effect.promise(() => runIn(dir, args, PROOF_MS)),
    read: (file) => Effect.promise(() => readIn(dir, file)),
    changed,
    shots: { taken: 0, kept: 0 },
  };
}

const run = promisify(execFile);
const BIG = { maxBuffer: 64 * 1024 * 1024 };
const REVIEW_MS = 25 * 60 * 1000;

/** Stops what QA left running in the clone (an old build's demo office, a dev server): asked first, then made to. */
export async function stopLeftovers(dir: string): Promise<void> {
  // a clone already gone has nothing left running in it
  if (!existsSync(dir)) return;
  const real = realpathSync(dir);
  const left = async () => processesIn((await run('lsof', ['-d', 'cwd', '-Fpn'], BIG).catch((err: { stdout?: string }) => ({ stdout: err.stdout ?? '' }))).stdout, real, process.pid);
  const signal = (pids: number[], sig: NodeJS.Signals) => pids.forEach((pid) => { try { process.kill(pid, sig); } catch { /* gone already */ } });
  const pids = await left();
  if (!pids.length) return;
  console.log(`  stopping ${pids.length} process${pids.length === 1 ? '' : 'es'} QA left running in ${path.basename(dir)}`);
  signal(pids, 'SIGTERM');
  await new Promise((r) => setTimeout(r, 3000));
  signal(await left(), 'SIGKILL');
}

/** What a review came to: QA's report (none if it didn't finish, and why), and what it cost. */
export interface Reviewed {
  report: QaReport | null;
  costUsd?: number;
  minutes: number;
  error?: string;
}

/** The QA officer's review of a clone, as the office runs one: a report that leaves changed files out goes back once, naming
 *  them, and a fail stands only with proof that holds when it's checked in the clone. */
export async function review(repo: string, dir: string, pr: PullRequestDetail, state: { settings: Settings; projects: Project[] }): Promise<Reviewed> {
  const project: Pick<Project, 'name' | 'qaBrief' | 'qaProof'> = state.projects.find((p) => p.repos.includes(repo)) ?? { name: repo };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REVIEW_MS);
  const started = Date.now();
  const minutes = () => Math.round((Date.now() - started) / 60_000);
  // the old build runs on a port and data folder of its own, never the live office's 4477 and ~/.focus
  const env = reviewEnv(process.env, await freePort(), path.join(dir, '.replay-data'));
  let costUsd = 0;
  let sessionId: string | undefined;
  // what QA's session did: which files it actually opened, as the office reads from its transcript
  const calls: ToolCall[] = [];
  const turn = async (prompt: string) => {
    let structured: unknown;
    let text = '';
    for await (const msg of query({
      prompt,
      options: {
        cwd: dir,
        env,
        abortController: abort,
        resume: sessionId,
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
      sessionId = msg.session_id;
      if (msg.type === 'assistant') for (const b of msg.message.content) if (b.type === 'tool_use') calls.push({ name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
      if (msg.type !== 'result') continue;
      costUsd += msg.total_cost_usd;
      if (msg.subtype === 'success') {
        structured = msg.structured_output;
        text = msg.result;
      }
    }
    return parseQaReport(structured, text);
  };
  try {
    const changed = (await run('git', ['-C', dir, 'diff', '--name-only', `origin/${pr.baseBranch}...HEAD`], BIG)).stdout.split('\n').filter(Boolean);
    let report = await turn(qaPrompt(repo, pr, [], {}, changed));
    const revisit = report && filesToRevisit(report, { changed, askedAgain: false }, openedFiles(calls, changed));
    if (revisit) {
      console.log(`  ${repo}#${pr.number}: of ${changed.length} changed files the report left out ${revisit.missing.length}, only skimmed ${revisit.unread.length}, never opened ${revisit.unopened.length}: sent back once`);
      report = (await turn(filesPrompt(revisit))) ?? report;
    }
    // as the office does: the verdict blocks only with proof that holds when it's checked here (docs/qa.md#proof)
    if (report && qaProofFor(project)) report = await Effect.runPromise(prove(report, proofRig(dir, changed)));
    return { report, costUsd, minutes: minutes() };
  } catch (err) {
    return { report: null, costUsd, minutes: minutes(), error: (err as Error).message.split('\n')[0] };
  } finally {
    clearTimeout(timer);
    await stopLeftovers(dir);
  }
}
