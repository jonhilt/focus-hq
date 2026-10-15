// The demo office's scorecards: a made-up history that climbs a little each time, kept in memory so the demo never
// writes to ~/.focus/scorecards/.
import { sleep } from '../../server/util';
import type { Metric, Scorecard } from './types';
import type { ScorecardSource } from './desk';

type Row = [Metric['section'], string, string, number, Metric['better'], Metric['format'], number];

/** Each number as the demo starts, and how much it moves per measurement (towards better, but for one that slips). */
const ROWS: Row[] = [
  ['gate', 'gate.pass', 'Gate passes', 1, 'higher', 'pass', 0],
  ['gate', 'gate.seconds', 'Gate time', 112, 'lower', 'seconds', -1.5],
  ['gate', 'typecheck.seconds', 'Typecheck time', 60, 'lower', 'seconds', -0.8],
  ['gate', 'typecheck.errors', 'Typecheck errors', 0, 'lower', 'count', 0],
  ['gate', 'lint.seconds', 'Lint time', 17, 'lower', 'seconds', -0.1],
  ['gate', 'lint.errors', 'Lint errors', 0, 'lower', 'count', 0],
  ['gate', 'lint.warnings', 'Lint warnings', 0, 'lower', 'count', 0],
  ['gate', 'test.seconds', 'Test time (with coverage)', 34, 'lower', 'seconds', -0.6],
  ['gate', 'test.failed', 'Tests failing', 0, 'lower', 'count', 0],
  ['gate', 'build.seconds', 'Build time', 0.6, 'lower', 'seconds', 0],
  ['fence', 'fence.typeAssertions', 'Type assertions (as T)', 241, 'lower', 'count', -3],
  ['fence', 'fence.nonNull', 'Non-null assertions (x!)', 140, 'lower', 'count', -2],
  ['fence', 'fence.explicitAny', 'Explicit any', 0, 'lower', 'count', 0],
  ['fence', 'fence.lintDisables', 'eslint-disable comments', 0, 'lower', 'count', 0],
  ['fence', 'fence.tsSuppressions', '@ts-ignore / expect-error', 0, 'lower', 'count', 0],
  ['effect', 'effect.files', 'Server files on Effect', 20, 'higher', 'count', 1],
  ['effect', 'effect.share', 'Share of server files on Effect', 0.24, 'higher', 'percent', 0.01],
  ['effect', 'effect.runs', 'Effect.run* calls (edges)', 33, 'lower', 'count', -1],
  ['effect', 'effect.runFiles', 'Files that run Effects', 12, 'lower', 'count', 0],
  ['effect', 'effect.machines', 'XState machines', 1, 'none', 'count', 0],
  ['tests', 'tests.total', 'Tests', 1090, 'higher', 'count', 12],
  ['tests', 'tests.files', 'Test files', 110, 'higher', 'count', 1],
  ['tests', 'tests.propertyFiles', 'Test files with property tests', 0, 'higher', 'count', 0],
  ['tests', 'crap.over', 'Functions over CRAP 30 (server, shared, plugins)', 71, 'lower', 'count', -1],
  ['tests', 'crap.total', 'Total CRAP (server, shared, plugins)', 19200, 'lower', 'count', -140],
  ['office', 'office.merged', 'PRs merged (30 days)', 120, 'none', 'count', 4],
  ['office', 'office.firstTime', 'QA passed first time', 0.6, 'higher', 'percent', 0.01],
  ['office', 'office.roundsPerMerge', 'Failed QA rounds per merge', 0.14, 'lower', 'ratio', -0.01],
  ['office', 'office.mergedUnpassed', 'Merged without a QA pass', 46, 'lower', 'count', -1],
  // the one that slips, so the overview has something worse to show
  ['office', 'office.conflictsForAgent', 'Conflicts that needed an agent', 28, 'lower', 'count', 1],
  ['office', 'office.checksSentBack', 'Checks sent back', 0, 'lower', 'count', 0],
  ['office', 'office.costPerMerge', 'Cost per merge', 11.8, 'lower', 'usd', -0.1],
  ['office', 'office.wastedPerMerge', 'Wasted tool calls per merge', 5.6, 'lower', 'ratio', -0.05],
  ['office', 'office.fixesStopped', 'Retro fixes that stopped their friction', 0, 'higher', 'count', 0],
  ['office', 'office.patterns', 'Open friction patterns (3+ of 535 sessions, 14 days)', 24, 'lower', 'count', -1],
];

const HOUR = 60 * 60 * 1000;

function demoCard(step: number, at: number): Scorecard {
  const metrics = ROWS.map(([section, key, label, start, better, format, per]): Metric => ({
    section, key, label, better, format,
    value: Math.max(0, Math.round((start + per * step) * 100) / 100),
  }));
  return {
    v: 1, at, commit: (0xf6f4c667 + step * 7919).toString(16).padStart(8, '0') + 'demo', branch: 'main', dirty: false, metrics, notes: [],
    frictions: [{ key: 'shell: bash exit code 1', sessions: 41 - step }, { key: 'other: browser evaluation failure', sessions: 23 - step }, { key: 'demo-env: demo port in use', sessions: 9 }],
  };
}

export class DemoScorecards implements ScorecardSource {
  private cards: Scorecard[] = Array.from({ length: 6 }, (_, i) => demoCard(i, Date.now() - (6 - i) * 20 * HOUR));
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  history(limit: number): Scorecard[] {
    return this.cards.slice(-limit);
  }

  noise(): undefined {
    return undefined;
  }

  async measure(): Promise<void> {
    await sleep(6000 / this.speed);
    this.cards.push(demoCard(this.cards.length, Date.now()));
  }
}
