import { describe, expect, it } from 'vitest';
import type { LedgerEntry, LedgerEvent, LentJournal, ReadOnlyResult, ReviewEntry } from '../../plugin-api/server';
import { loadScorer } from '../../plugin-api/server';
import { checkAtOnce, checkRestart, type Later, type Running, type Subject } from '../../plugin-api/testing';
import { type QaScoresHost, qaScoresParts } from './server';

// The QA scores plugin under Focus's two rules (docs/invariants.md): a restart is atomic, and two sweeps at once end as
// one after the other would. What it keeps across a restart is the ledger alone: what it has graded is read back from
// its `qa-score` lines, so a grading still out when Focus stops is lost, and graded again by the next sweep.
//
// Its stand-ins: QA's review journals are arrays that QA's verdicts are added to, as Ops' are; the ledger is an array,
// written at once, as Focus's is; the diff is always there; and the model's grade comes back through `later`, so a
// restart can fall while it's out. Here the scorer grades every report (a rate of 100), so the sample doesn't hide one.
//
// Breaks seen caught: a sweep that doesn't leave out what the ledger has graded fails the reach test and the promise
// that a report is graded once (not the rules: graded twice one after the other too, it ends the same either way); a
// sweep that doesn't wait for the one under way fails the check for two at once (on a hundred runs: it's a rare draw
// in fewer) and the promise that a report is graded once.

const scorer = { ...loadScorer('qa-report'), samplingRate: 100 };
const PRS = [1, 2, 3];
const ANSWER: ReadOnlyResult = { text: '', structured: { label: 'thorough', why: 'Checked the risky path.' }, model: 'haiku', costUsd: 0.05 };

/**
 * When QA's verdicts were journaled: one moment for them all, inside the sweep's look back. A sweep grades the newest
 * first, so a clock read as each journal is lent would order them by which millisecond the lending fell in.
 */
const AT = Date.now();

/** A review journal with QA's verdicts on each of `shas`. */
const journalOf = (pr: number, shas: string[]): LentJournal<ReviewEntry> => ({
  key: `acme/shop#${pr}`,
  entries: [
    { kind: 'requested', projectId: 'shop', repo: 'acme/shop', number: pr, title: `PR ${pr}`, v: 1, seq: 1, t: AT },
    ...shas.map((sha, i) => ({
      kind: 'reported' as const, verdict: 'pass' as const, officer: 'Lt. Varga', body: '', failedRounds: 0, sha, screenshots: [],
      report: { verdict: 'pass' as const, summary: 'Fine.', checks: [], commands: [], captions: [] }, v: 1 as const, seq: i + 2, t: AT,
    })),
  ],
});

/** What must survive: every grade in the ledger, by the report it grades. */
type Kept = string[];

/** The plugin on QA's journals (each pull request's verdicts, by its commits) and the ledger, both kept through a restart. */
function life(later: Later, ledger: LedgerEvent[], verdicts: Map<number, string[]>): Running<Kept> {
  const host: QaScoresHost = {
    journals: () => ({ runs: [], reviews: [...verdicts].map(([pr, shas]) => journalOf(pr, shas)) }),
    ledger: () => [...ledger],
    record: (projectId: string, entry: LedgerEntry) => {
      ledger.push({ ...entry, projectId, at: 1000 + ledger.length, seq: ledger.length + 1 });
      return undefined;
    },
    readOnlySession: () => later('the model grades', () => Promise.resolve(ANSWER)),
    settings: () => ({}) as never,
  };
  const parts = qaScoresParts(host, scorer, () => Promise.resolve('diff --git a/a.ts b/a.ts'));
  return {
    actions: () => [
      ...PRS.map((pr) => ({ name: `QA reports on #${pr}`, run: () => verdicts.set(pr, [...(verdicts.get(pr) ?? []), `${pr}-${(verdicts.get(pr)?.length ?? 0) + 1}`]) })),
      { name: 'sweep', run: () => parts.sweep() },
    ],
    durable: () => ledger.flatMap((e) => (e.kind === 'qa-score' ? [`#${e.pr}@${e.sha} ${e.label}`] : [])),
    // a sweep grades one report after another, each a few turns of the event loop after `later` lets its answer go
    settle: async () => {
      for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
    },
    restart: (again) => life(again, ledger, verdicts),
  };
}

const qaScores: Subject<Kept> = { name: 'qa scores', start: (later) => life(later, [], new Map()) };

const take = (r: Running<Kept>, name: string) => r.actions().find((a) => a.name === name)?.run();
const nothingWaits: Later = () => new Promise<never>(() => undefined);
const answersAtOnce: Later = (_label, work) => work();

describe('the QA scores plugin, under Focus’s two rules', () => {
  it('ends a restart as if a sweep had never started, or had finished', async () => {
    await checkRestart(qaScores, { runs: 25 });
  });

  it('ends two sweeps at once as one after the other would', async () => {
    await checkAtOnce(qaScores, { runs: 100 });
  });

  it('reaches reports graded on several pull requests, and a pull request’s next round graded too', async () => {
    const r = await qaScores.start(answersAtOnce);
    take(r, 'QA reports on #1');
    take(r, 'QA reports on #2');
    take(r, 'sweep');
    await r.settle();
    take(r, 'QA reports on #1');
    take(r, 'sweep');
    await r.settle();
    expect([...r.durable()].sort()).toEqual(['#1@1-1 thorough', '#1@1-2 thorough', '#2@2-1 thorough']);
  });

  // README.md: "Each report the sample takes is graded once"
  it('grades a report once, however many sweeps there are', async () => {
    const r = await qaScores.start(answersAtOnce);
    take(r, 'QA reports on #3');
    take(r, 'sweep');
    take(r, 'sweep');
    await r.settle();
    take(r, 'sweep');
    await r.settle();
    expect(r.durable()).toEqual(['#3@3-1 thorough']);
  });

  // README.md: "a grade still out when Focus stops is lost, and the next sweep after it starts again grades the report"
  it('grades a report again after a restart lost its grade, and once', async () => {
    const out = await qaScores.start(nothingWaits);
    take(out, 'QA reports on #1');
    take(out, 'sweep');
    await out.settle();
    const after = await out.restart(answersAtOnce);
    expect(after.durable()).toEqual([]);
    take(after, 'sweep');
    await after.settle();
    expect(after.durable()).toEqual(['#1@1-1 thorough']);
  });
});
