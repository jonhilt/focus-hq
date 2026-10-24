// The QA scores plugin: some of QA's reports (as many in every hundred as .focus/scorers/qa-report.md says), each
// graded by a model against the diff it reviewed, as a `qa-score` line in the ledger stamped with what QA worked to.
// It sweeps QA's review journals every hour, so a report is graded within an hour or so of its verdict, and what it
// has graded is the ledger's: there's nothing of its own to save. FOCUS_PLUGINS=qa-scores.
import os from 'node:os';
import path from 'node:path';
import { errorMessage, type FocusPlugin, focusMirror, loadScorer, type PluginHost, type PluginParts, run, type Scorer } from '../../plugin-api/server';
import { type Due, goalOf, LOOK_BACK_MS, MOST_PER_SWEEP, reportsDue, scoreEntry, scorePrompt, scoreSchema } from './scoring';

export const QA_SCORES = 'qa-scores';

const SWEEP_EVERY = 3_600_000;
/** After Focus starts, before the first sweep: what was reported while it was down is graded then, not at once. */
const FIRST_SWEEP_AFTER = 5 * 60_000;
/** How many times grading a report may fail (no diff to be had, no answer) before sweeps pass it over until Focus starts again. */
const TRIES = 2;

/** What the QA scores plugin asks of Focus: QA's review journals and the ledger to read, a line to write, and a model. */
export type QaScoresHost = Pick<PluginHost, 'journals' | 'ledger' | 'record' | 'readOnlySession' | 'settings'>;

/** The diff QA reviewed for a report: undefined when it can't be had (its commit gone, its repo's clone missing). */
export type DiffOf = (d: Due) => Promise<string | undefined>;

/** The plugin's parts on what Focus lends it, with `sweep`: grades what's due now, one sweep at a time, and says how many it graded. */
export function qaScoresParts(host: QaScoresHost, scorer: Scorer, diffOf: DiffOf): PluginParts & { sweep(): Promise<number> } {
  const failed = new Map<string, number>();
  let sweeping: Promise<number> | undefined;

  /** The model's grade of `d`, written as its line: false when there's no diff to grade it by, or no label in the answer. */
  async function grade(d: Due): Promise<boolean> {
    const diff = await diffOf(d);
    if (diff === undefined) return false;
    const answer = await host.readOnlySession({
      cwd: os.tmpdir(),
      system: scorer.rubric,
      systemAppend: '',
      prompt: scorePrompt(d, diff),
      settings: host.settings(),
      signal: new AbortController().signal,
      activity: () => undefined,
      builtins: [],
      schema: scoreSchema(scorer),
      model: scorer.model,
      maxTurns: scorer.maxTurns,
      timeoutMs: scorer.timeoutMs,
    });
    const entry = scoreEntry(d, scorer, answer, goalOf(host.ledger(), d.repo, d.pr));
    if (!entry) return false;
    host.record(d.projectId, entry);
    return true;
  }

  async function sweepNow(): Promise<number> {
    const since = Date.now() - LOOK_BACK_MS;
    const due = reportsDue(host.journals(since).reviews, host.ledger(), scorer.samplingRate, since).filter((d) => (failed.get(d.key) ?? 0) < TRIES);
    let graded = 0;
    for (const d of due.slice(0, MOST_PER_SWEEP)) {
      const ok = await grade(d).catch((err: unknown) => {
        console.error(`QA scores: grading ${d.key}: ${errorMessage(err)}`);
        return false;
      });
      if (ok) graded++;
      else failed.set(d.key, (failed.get(d.key) ?? 0) + 1);
    }
    return graded;
  }

  // one sweep at a time: two would grade the same report twice, so a sweep asked for while one runs is that one
  const sweep = (): Promise<number> => (sweeping ??= sweepNow().finally(() => (sweeping = undefined)));
  return { sweep, routes: [{ method: 'post', path: '/sweep', handle: async () => ({ graded: await sweep() }) }] };
}

/** QA's diff for `d` again, from Focus's clone of its repo: from the pull request's base to the commit QA tested. */
export async function mirrorDiff(d: Due): Promise<string | undefined> {
  const git = (...args: string[]) => run('git', ['-C', focusMirror(d.repo), ...args]);
  const has = () => git('cat-file', '-e', `${d.sha}^{commit}`).then(() => true, () => false);
  if (!(await has())) await git('fetch', '--quiet', 'origin', `+refs/pull/${d.pr}/head:refs/focus/qa-score`).catch(() => undefined);
  if (!(await has())) return undefined;
  const base = await run('gh', ['pr', 'view', String(d.pr), '-R', d.repo, '--json', 'baseRefName', '-q', '.baseRefName']).then((b) => b.trim(), () => '');
  return git('diff', `${base ? `origin/${base}` : 'origin/HEAD'}...${d.sha}`).catch(() => undefined);
}

const qaScores: FocusPlugin = {
  id: QA_SCORES,
  start(host) {
    // the demo's reviews are scripted, with no diff to grade them by
    if (host.demo) return {};
    // a broken scorer file leaves the plugin out, its file and line in Focus's log
    const parts = qaScoresParts(host, loadScorer('qa-report', path.join(host.focusDir, '.focus', 'scorers')), mirrorDiff);
    const sweep = () => void parts.sweep().catch((err: unknown) => console.error(`QA scores: ${errorMessage(err)}`));
    setTimeout(sweep, FIRST_SWEEP_AFTER).unref();
    setInterval(sweep, SWEEP_EVERY).unref();
    return parts;
  },
};

export default qaScores;
