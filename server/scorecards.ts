import fs from 'node:fs';
import path from 'node:path';
import { Option, Schema } from 'effect';
import type { Scorecard, Scorecards } from '../shared/types';
import type { Hub } from './hub';
import { run } from './util';

/** How many of the latest scorecards main engineering shows: enough for a trend at a glance. */
export const SHOWN = 10;

const Metric = Schema.Struct({
  section: Schema.Literals(['gate', 'fence', 'effect', 'tests', 'office']),
  key: Schema.String,
  label: Schema.String,
  value: Schema.Number,
  better: Schema.Literals(['lower', 'higher', 'none']),
  format: Schema.Literals(['pass', 'count', 'seconds', 'percent', 'usd', 'ratio']),
});

const ScorecardFile = Schema.Struct({
  v: Schema.Literal(1),
  at: Schema.Number,
  commit: Schema.String,
  branch: Schema.String,
  dirty: Schema.Boolean,
  metrics: Schema.Array(Metric),
  frictions: Schema.Array(Schema.Struct({ key: Schema.String, sessions: Schema.Number })),
  notes: Schema.Array(Schema.String),
});

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(ScorecardFile));

/** A saved scorecard, or nothing for a file that isn't one (cut short, or from a format this office doesn't know). */
export function readScorecard(text: string): Scorecard | undefined {
  return Option.getOrUndefined(Option.map(decode(text), (card) => ({
    ...card,
    metrics: [...card.metrics],
    frictions: [...card.frictions],
    notes: [...card.notes],
  })));
}

/** The commit the office runs from, and whether it has uncommitted changes. */
export interface Head {
  commit: string;
  dirty: boolean;
}

/**
 * Whether the office should measure the commit it runs from by itself: it's clean (a captain's work in progress isn't
 * measured behind their back) and has no scorecard yet. Auto update restarts the office on each merge to main, so
 * this puts a scorecard on every one.
 */
export const measureNewCommit = (history: Pick<Scorecard, 'commit'>[], head: Head) => !head.dirty && history.at(-1)?.commit !== head.commit;

/** Where scorecards come from: the saved ones, and a way to measure another. */
export interface ScorecardSource {
  history(limit: number): Scorecard[];
  measure(): Promise<void>;
}

/** The scorecards `pnpm run scorecard` saves in `dir`, measured on the office's own checkout at `root`. */
export class SavedScorecards implements ScorecardSource {
  constructor(private readonly dir: string, private readonly root: string) {}

  history(limit: number): Scorecard[] {
    if (!fs.existsSync(this.dir)) return [];
    // file names start with the time measured, so they sort oldest first
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort().slice(-limit);
    return files.flatMap((f) => readScorecard(fs.readFileSync(path.join(this.dir, f), 'utf8')) ?? []);
  }

  async measure(): Promise<void> {
    await run('pnpm', ['run', '-s', 'scorecard'], { cwd: this.root, timeoutMs: 15 * 60_000 });
  }
}

/** The commit a checkout is at, and whether it has uncommitted changes to tracked files (untracked ones aren't measured). */
export async function checkoutHead(root: string): Promise<Head> {
  const [commit, status] = await Promise.all([run('git', ['rev-parse', 'HEAD'], { cwd: root }), run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root })]);
  return { commit: commit.trim(), dirty: status.trim().length > 0 };
}

/**
 * Main engineering's scorecards: the latest few, and measuring another on the captain's word, one at a time. It's
 * advisory, so a measurement that fails says why and leaves the history as it was.
 */
export class ScorecardDesk {
  private state: Scorecards = { status: 'idle', history: [] };

  constructor(private readonly hub: Hub, private readonly source: ScorecardSource) {
    this.state.history = source.history(SHOWN);
  }

  current(): Scorecards {
    return this.state;
  }

  /** Measures the commit the office runs from, unless it has a scorecard already or has uncommitted changes. */
  measureIfNew(head: Head): void {
    if (this.state.status !== 'measuring' && measureNewCommit(this.state.history, head)) this.measure('new-commit');
  }

  measure(trigger: Scorecards['trigger'] = 'captain'): Scorecards {
    if (this.state.status === 'measuring') throw new Error('A scorecard is already being measured');
    this.set({ status: 'measuring', startedAt: Date.now(), trigger });
    void this.source.measure().then(
      () => this.set({ status: 'idle', history: this.source.history(SHOWN), startedAt: undefined, error: undefined }),
      (err: unknown) => this.set({ status: 'failed', error: err instanceof Error ? err.message : String(err) }),
    );
    return this.state;
  }

  private set(change: Partial<Scorecards>): void {
    this.state = { ...this.state, ...change };
    this.hub.send({ type: 'scorecards', scorecards: this.state });
  }
}
