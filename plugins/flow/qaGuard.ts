// QA's catch rate (docs/qa-catch.md) as one of `pnpm run flow`'s quality guards: Focus's latest run, read through
// the plugin API.
import { type CatchRun, catchTotals } from '../../plugin-api/server';

/** The latest run as a quality guard in `pnpm run flow`: how many planted bugs QA caught, when, and on which model. */
export function catchGuard(run: CatchRun | undefined): string {
  if (!run) return '  QA catch rate: not measured yet (pnpm run qa-catch plants bugs in merged pull requests and runs QA on them)';
  const t = catchTotals(run.results);
  const day = new Date(run.at).toISOString().slice(0, 10);
  const controls = run.controls?.filter((c) => c.outcome !== 'error') ?? [];
  const alarms = controls.length ? `, ${controls.filter((c) => c.outcome === 'false-alarm').length} of ${controls.length} clean ones failed` : '';
  return `  QA catch rate: caught ${t.caught} of ${t.runs - t.errors} planted bugs (${Math.round(t.rate * 100)}%), ${t.failedElsewhere} failed for something else, ${t.missed} missed${alarms} · ${day}, ${run.model}`;
}
