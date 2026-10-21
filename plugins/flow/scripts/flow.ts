// Where goals' time goes (../README.md): every goal the ledger saw close, each split from opening to closing into the
// lead at work, reworking after QA failed, waiting on its own background work, on QA, on a merge, or on the captain,
// from its lead's Claude Code transcript and the ledger. It prints lead time p50 and p85, where the time went, the
// biggest wait, and the quality guards that must hold while lead time comes down. It reads; it never writes.
//
//   pnpm run flow                        every closed goal
//   pnpm run flow --since 2026-10-10     goals closed since a date (and --until one)
//   pnpm run flow --project proj_…       one room's
//   pnpm run flow --json                 the report as JSON
//   pnpm run flow --no-rework            leave out rework after merge (it asks GitHub about each merged pull request)

import { closedGoals, latestQaCatch, focusLedger, focusMirror, focusTranscript } from '../../../plugin-api/server';
import { flowLines, flowReport, goalFlow, transcriptMoments } from '../flow';
import { catchGuard } from '../qaGuard';
import { reworkLines, reworkTotals } from '../rework';
import { measureRework } from './flowRework';

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

const { file, events: ledger } = focusLedger();
if (!ledger) {
  console.error(`No ledger at ${file}.`);
  process.exit(1);
}
const goals = closedGoals(ledger, opt('project')).filter((g) => (since === undefined || g.closedAt >= since) && (until === undefined || g.closedAt < until));

const missing: string[] = [];
const flows = (await Promise.all(goals.map(async (g) => {
  const transcript = g.sessionId ? await focusTranscript(g.sessionId) : undefined;
  if (!transcript) {
    missing.push(g.title);
    return [];
  }
  return [goalFlow(g, transcriptMoments(transcript), ledger)];
}))).flat();
const report = flowReport(flows, goals, ledger);

const merged = flows.flatMap((f) => (goals.find((g) => g.id === f.id)?.prs ?? []).filter((p) => p.outcome === 'merged').map((p) => ({ repo: p.repo, pr: p.number, goal: f.title })));
const rework = args.includes('--no-rework') ? undefined : await measureRework(merged, focusMirror);
const totals = rework && reworkTotals(rework.measured);
// the latest of `pnpm run qa-catch`'s runs, if there's been one
const caught = latestQaCatch();

if (args.includes('--json')) console.log(JSON.stringify({ ...report, rework: rework && { ...totals, measured: rework.measured, skipped: rework.skipped }, qaCatch: caught }, null, 2));
else {
  const skipped = rework?.skipped.length ? [`  (${rework.skipped.length} merged pull request${rework.skipped.length === 1 ? '' : 's'} not measured: ${rework.skipped.slice(0, 3).join('; ')}${rework.skipped.length > 3 ? '; …' : ''})`] : [];
  console.log(flowLines(report, 5, [...(totals ? reworkLines(totals) : []), ...skipped, catchGuard(caught)]).join('\n'));
  if (missing.length) console.log(`\n${missing.length} goal${missing.length === 1 ? '' : 's'} left out, their lead's transcript gone: ${missing.join('; ')}`);
}
