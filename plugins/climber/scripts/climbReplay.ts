// The climber's memory, put to the test (README.md#replay): fresh read-only sessions write the climb brief's
// scored shortlist, a control with the log of past climbs as it is and a treatment with the control's first pick
// planted in it as a climb the captain closed. A judge (a cheaper model) finds the rejected gap on each shortlist;
// climbReplayRules.ts has the rules. It costs real sessions, so it's run by hand, not in the gate.
//
//   pnpm run climb:replay                         3 sessions each side, on the latest saved scorecard
//   pnpm run climb:replay --runs 5 --card x.json  more sessions, on a scorecard you choose (`scorecard --json`)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { climbBrief, climbLog } from '../climb';
import { config } from '../../../server/config';
import type { PastPullRequest } from '../../../server/github/provider';
import { SavedScorecards, SCORECARDS_DIR } from '../../scorecard/desk';
import { direction, formatValue } from '../../scorecard/scorecard';
import type { Scorecard } from '../../scorecard/types';
import { CLIMB_BRANCH } from '../shared';
import { FIND_SCHEMA, findGapQuestion, followsRule, PICK_SCHEMA, pickedGap, plantRejection, rankOnly, replayVerdict, sighting, type ClimbPick } from './climbReplayRules';
import { render } from '../../scorecard/scripts/scorecardRules';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const RUNS = Number(arg('--runs') ?? 3);
const JUDGE = arg('--judge') ?? 'claude-haiku-4-5-20251001';
const REASON = 'Not this one: it isn’t where the office hurts right now, and it would take the next climb off what matters. Pick another gap.';

const gh = (...args: string[]) => execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const repo = gh('repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner').trim();

function pastClimbs(): PastPullRequest[] {
  const raw = JSON.parse(gh('pr', 'list', '-R', repo, '--state', 'all', '--search', `head:${CLIMB_BRANCH}`, '--limit', '100', '--json', 'number,title,body,url,headRefName,state,createdAt,closedAt,comments')) as {
    number: number; title: string; body: string; url: string; headRefName: string; state: PastPullRequest['state']; createdAt: string; closedAt?: string; comments: { author?: { login: string }; body: string }[];
  }[];
  return raw.filter((p) => p.headRefName.startsWith(CLIMB_BRANCH)).map((p) => ({
    ...p, branch: p.headRefName, closedAt: p.closedAt ?? undefined, comments: p.comments.map((c) => ({ author: c.author?.login ?? '', body: c.body })),
  }));
}

function scorecard(): Scorecard {
  const file = arg('--card') ?? (existsSync(SCORECARDS_DIR) ? readdirSync(SCORECARDS_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(SCORECARDS_DIR, f)).at(-1) : undefined);
  if (!file) throw new Error('No scorecard to rank from: run `pnpm run scorecard` first, or pass --card');
  return JSON.parse(readFileSync(file, 'utf8')) as Scorecard;
}

/** One read-only session to its structured answer. */
async function ask<T>(prompt: string, schema: object, opts: Partial<Options> = {}): Promise<{ answer: T; costUsd: number }> {
  const options: Options = {
    cwd: ROOT, tools: ['Read', 'Glob', 'Grep'], allowedTools: ['Read', 'Glob', 'Grep'], permissionMode: 'dontAsk', settingSources: [],
    outputFormat: { type: 'json_schema', schema: schema as Record<string, unknown> }, maxTurns: 40, ...opts,
  };
  for await (const msg of query({ prompt, options })) {
    if (msg.type === 'result') {
      if (msg.subtype !== 'success' || msg.is_error) throw new Error(msg.subtype === 'success' ? msg.result : msg.subtype);
      return { answer: msg.structured_output as T, costUsd: msg.total_cost_usd };
    }
  }
  throw new Error('The session stopped without a result');
}

async function main() {
  const login = gh('api', 'user', '-q', '.login').trim();
  // the brief as a climb gets it: main's scorecards for whether gains held, and the noise floor
  const saved = new SavedScorecards(SCORECARDS_DIR, ROOT);
  const noise = saved.noise();
  const log = climbLog(pastClimbs(), [], login, { history: saved.history(30), direction: (m, before) => direction(m, before, noise), formatValue });
  const card = render(scorecard());
  const agent = { repo, baseBranch: 'main', branch: `${CLIMB_BRANCH}replay` };
  let cost = 0;
  const picks = async (side: string, prompt: string) => Promise.all(Array.from({ length: RUNS }, async (_, i) => {
    const { answer, costUsd } = await ask<ClimbPick>(prompt, PICK_SCHEMA);
    cost += costUsd;
    process.stderr.write(`${side} ${i + 1}: ${pickedGap(answer)}${followsRule(answer) ? '' : ' (not the top by its own scores)'}\n${answer.shortlist.map((e, j) => `  ${j === answer.chosen ? '→' : ' '} ${2 * e.harm + e.distance} ${e.size} ${e.gap.slice(0, 110)}`).join('\n')}\n`);
    return answer;
  }));
  const find = async (rejected: string, pick: ClimbPick) => {
    const { answer, costUsd } = await ask<{ index: number; why: string }>(findGapQuestion(rejected, pick.shortlist), FIND_SCHEMA, { model: JUDGE, tools: [], allowedTools: [], maxTurns: 3 });
    cost += costUsd;
    return { ...answer, ...sighting(pick, answer.index) };
  };

  process.stderr.write(`Replaying the climb brief: ${log.length} past climbs, ${RUNS} sessions each side\n`);
  const control = await picks('control', rankOnly(climbBrief(agent, [], Date.now(), log, noise), card));
  const rejected = control[0];
  const treatment = await picks('treatment', rankOnly(climbBrief(agent, [], Date.now(), plantRejection(log, rejected, REASON, Date.now()), noise), card));
  const controlSeen = await Promise.all(control.slice(1).map((p) => find(pickedGap(rejected), p)));
  const treatmentSeen = await Promise.all(treatment.map((p) => find(pickedGap(rejected), p)));
  const result = replayVerdict(controlSeen, treatmentSeen, [...control, ...treatment]);

  const out = { at: Date.now(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), runs: RUNS, judge: JUDGE, rejected, control, treatment, controlSeen, treatmentSeen, result, costUsd: cost };
  const dir = path.join(config.dataDir, 'climb-replays');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date(out.at).toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log([
    `Rejected (the control's first pick): ${pickedGap(rejected)}`,
    `Control: ${result.control.listed} of ${result.control.of} other sessions listed it, ${result.control.taken} took it`,
    `Treatment, told the captain closed it: ${result.treatment.listed} of ${result.treatment.of} listed it, ${result.treatment.taken} took it`,
    `Took the top of their own shortlist: ${result.followedRule.yes} of ${result.followedRule.of}`,
    `Verdict: ${result.verdict} · $${cost.toFixed(2)} · saved ${file}`,
  ].join('\n'));
}

await main();
