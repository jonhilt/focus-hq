// Watching Route with Jev live (README.md#how-it-judges-a-turn): each day's verdicts by who routed them, and how many
// interrupted the captain, from the ledger. Its rule is in ../jevWatch.ts. Read-only, free.
//
//   pnpm run jev-watch                         the last 7 days, every project
//   pnpm run jev-watch --days 3 --project <id>

import { focusLedger } from '../../../plugin-api/server';
import { verdictVolume } from '../jevWatch';

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const days = Number(flag('--days') ?? '7');
const project = flag('--project');
const rows = verdictVolume(focusLedger().events ?? [], Date.now() - days * 86_400_000, (id) => !project || id === project);

console.log(['day'.padEnd(12), 'jev turns', 'jev int', 'haiku turns', 'haiku int', 'jev failed'].map((h, i) => (i ? h.padStart(12) : h)).join(''));
for (const r of rows) {
  const cells = [r.jev.turns, r.jev.interrupts, r.haiku.turns, r.haiku.interrupts, r.haiku.jevFailed].map((n) => String(n).padStart(12));
  console.log([r.day.padEnd(12), ...cells].join(''));
}
