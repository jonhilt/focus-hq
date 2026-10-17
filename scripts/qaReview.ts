// The QA officer's own review of a throwaway clone, as the office runs one (its system prompt, prompt, report schema,
// model and Claude Code settings), for the scripts that replay QA on code it has seen or should have: QA's catch rate
// (scripts/qaCatch.ts, planted bugs) and the bug replay (scripts/bugReplay.ts, real ones). The clone is the caller's.

import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { claudeConfig } from '../server/agents/claudeRunner';
import { filesPrompt, filesToRevisit, openedFiles, parseQaReport, QA_SCHEMA, qaAgentModel, qaPrompt, qaSystemAppend, type ToolCall } from '../server/agents/qa';
import type { PullRequestDetail } from '../server/github/provider';
import type { Project, QaReport, Settings } from '../shared/types';

const run = promisify(execFile);
const BIG = { maxBuffer: 64 * 1024 * 1024 };
const REVIEW_MS = 25 * 60 * 1000;

/** What a review came to: QA's report (none if it didn't finish, and why), and what it cost. */
export interface Reviewed {
  report: QaReport | null;
  costUsd?: number;
  minutes: number;
  error?: string;
}

/** The QA officer's review of a clone, as the office runs one: a report that leaves changed files out goes back once, naming them.
 *  A `brief` goes after QA's own instructions in its system prompt, for a replay trying a change to how QA reviews. */
export async function review(repo: string, dir: string, pr: PullRequestDetail, state: { settings: Settings; projects: Project[] }, brief = ''): Promise<Reviewed> {
  const project = state.projects.find((p) => p.repos.includes(repo)) ?? { name: repo };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REVIEW_MS);
  const started = Date.now();
  const minutes = () => Math.round((Date.now() - started) / 60_000);
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
        abortController: abort,
        resume: sessionId,
        model: qaAgentModel(state.settings),
        ...claudeConfig(state.settings.userClaudeMd, process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: `${qaSystemAppend({ name: 'Lt. Replay' }, project, pr, pr.headSha)}${brief}` },
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
    return { report, costUsd, minutes: minutes() };
  } catch (err) {
    return { report: null, costUsd, minutes: minutes(), error: (err as Error).message.split('\n')[0] };
  } finally {
    clearTimeout(timer);
  }
}
