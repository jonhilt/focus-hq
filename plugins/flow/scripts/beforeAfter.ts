// What agents did in the days before a change against the days after it (../README.md#before-and-after), per session,
// from the ledger. By default the change is the last commit to CLAUDE.md here. It reads; it never writes.
//
//   pnpm run before-after                          either side of the last CLAUDE.md change, 7 days each
//   pnpm run before-after --at 2026-10-15T14:00    either side of a moment you choose (--days 14 for a wider window)
//   pnpm run before-after --project proj_…         one room's (--task lead for one kind of session)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { paths } from '../../../server/config';
import { checkLedger } from '../../../shared/ledger';
import type { AgentTask } from '../../../shared/types';
import { beforeAfter, beforeAfterLines } from '../beforeAfter';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const atArg = opt('at') ?? execFileSync('git', ['log', '-1', '--format=%cI', '--', 'CLAUDE.md'], { encoding: 'utf8' }).trim();
const at = Date.parse(atArg);
if (Number.isNaN(at)) throw new Error(`--at ${atArg}: not a date`);
const days = Number(opt('days') ?? 7);
if (!existsSync(paths.ledger)) {
  console.error(`No ledger at ${paths.ledger}.`);
  process.exit(1);
}

const ledger = checkLedger(readFileSync(paths.ledger, 'utf8')).events;
const report = beforeAfter(ledger, at, days, Date.now(), { projectId: opt('project'), task: opt('task') as AgentTask | undefined });
console.log(`Before and after ${new Date(at).toISOString()}${opt('at') ? '' : ' (the last change to CLAUDE.md)'}, ${days} days each side\n`);
for (const line of beforeAfterLines(report)) console.log(line);
