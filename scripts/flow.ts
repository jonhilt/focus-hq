// Where goals' time goes (docs/flow.md): every goal the ledger saw close, each split from opening to closing into the
// lead at work, reworking after QA failed, waiting on its own background work, on QA, on a merge, or on the captain,
// from its lead's Claude Code transcript and the ledger. It prints lead time p50 and p85, where the time went, the
// biggest wait, and the quality guards that must hold while lead time comes down. It reads; it never writes.
//
//   pnpm run flow                        every closed goal
//   pnpm run flow --since 2026-10-10     goals closed since a date (and --until one)
//   pnpm run flow --project proj_…       one room's
//   pnpm run flow --json                 the report as JSON

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { paths } from '../server/config';
import { flowLines, flowReport, goalFlow, transcriptMoments } from '../server/agents/flow';
import { checkLedger, closedGoals } from '../shared/ledger';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const date = (name: string) => {
  const v = opt(name);
  const t = v ? Date.parse(v) : NaN;
  if (v && Number.isNaN(t)) throw new Error(`--${name} ${v}: not a date`);
  return Number.isNaN(t) ? undefined : t;
};
const since = date('since');
const until = date('until');

if (!existsSync(paths.ledger)) {
  console.error(`No ledger at ${paths.ledger}.`);
  process.exit(1);
}
const ledger = checkLedger(readFileSync(paths.ledger, 'utf8')).events;
const goals = closedGoals(ledger, opt('project')).filter((g) => (since === undefined || g.closedAt >= since) && (until === undefined || g.closedAt < until));

/** Every transcript on this machine by its session id. */
const transcripts = new Map<string, string>();
if (existsSync(paths.transcripts))
  for (const dir of readdirSync(paths.transcripts, { withFileTypes: true }))
    if (dir.isDirectory())
      for (const f of readdirSync(path.join(paths.transcripts, dir.name))) if (f.endsWith('.jsonl')) transcripts.set(f.slice(0, -'.jsonl'.length), path.join(paths.transcripts, dir.name, f));

const missing: string[] = [];
const flows = goals.flatMap((g) => {
  const file = g.sessionId && transcripts.get(g.sessionId);
  if (!file) {
    missing.push(g.title);
    return [];
  }
  return [goalFlow(g, transcriptMoments(readFileSync(file, 'utf8')), ledger)];
});
const report = flowReport(flows, goals, ledger);

if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(flowLines(report).join('\n'));
  if (missing.length) console.log(`\n${missing.length} goal${missing.length === 1 ? '' : 's'} left out, their lead's transcript gone: ${missing.join('; ')}`);
}
