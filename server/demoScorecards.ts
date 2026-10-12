// The demo office's scorecards: a made-up history that climbs a little each time, kept in memory so the demo never
// writes to ~/.focus/scorecards/.
import type { Metric, Scorecard } from '../shared/types';
import type { ScorecardSource } from './scorecards';
import { sleep } from './util';

type Row = [Metric['section'], string, string, number, Metric['better'], Metric['format'], number];

/** Each number as the demo starts, and how much it moves per measurement (towards better). */
const ROWS: Row[] = [
  ['gate', 'gate.pass', 'Gate passes', 1, 'higher', 'pass', 0],
  ['gate', 'gate.seconds', 'Gate time', 81, 'lower', 'seconds', -1.5],
  ['fence', 'fence.typeAssertions', 'Type assertions (as T)', 241, 'lower', 'count', -3],
  ['fence', 'fence.nonNull', 'Non-null assertions (x!)', 140, 'lower', 'count', -2],
  ['fence', 'fence.explicitAny', 'Explicit any', 0, 'lower', 'count', 0],
  ['effect', 'effect.share', 'Share of server files on Effect', 0.24, 'higher', 'percent', 0.01],
  ['effect', 'effect.runs', 'Effect.run* calls (edges)', 33, 'lower', 'count', -1],
  ['tests', 'tests.total', 'Tests', 1090, 'higher', 'count', 12],
  ['tests', 'tests.propertyFiles', 'Test files with property tests', 0, 'higher', 'count', 0],
  ['tests', 'crap.over', 'Functions over CRAP 30 (server, shared)', 71, 'lower', 'count', -1],
  ['office', 'office.firstTime', 'QA passed first time', 0.6, 'higher', 'percent', 0.01],
  ['office', 'office.mergedUnpassed', 'Merged without a QA pass', 46, 'lower', 'count', -1],
  ['office', 'office.patterns', 'Open friction patterns (3+ sessions, 14 days)', 24, 'lower', 'count', -1],
];

const HOUR = 60 * 60 * 1000;

function demoCard(step: number, at: number): Scorecard {
  const metrics = ROWS.map(([section, key, label, start, better, format, per]): Metric => ({
    section, key, label, better, format,
    value: format === 'percent' ? Math.round((start + per * step) * 100) / 100 : Math.max(0, start + per * step),
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

  async measure(): Promise<void> {
    await sleep(6000 / this.speed);
    this.cards.push(demoCard(this.cards.length, Date.now()));
  }
}
