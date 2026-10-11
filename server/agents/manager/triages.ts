import { Effect, Exit, Fiber, FiberMap, PartitionedSemaphore, Scope } from 'effect';
import { plannerFor } from '../../../shared/crew';
import { prKey } from '../../../shared/qa';
import { afterTriage, triageLabel, type TriageResult, type TriageStep, whenStuck } from '../../../shared/triage';
import type { FailedCheck, QaReview } from '../../../shared/types';
import type { PullRequestDetail } from '../../github/provider';
import { GitHub, type GitHubError } from '../../github/service';
import { errorMessage, truncate } from '../../util';
import { Triage, Workspace } from '../services';
import { reviewCheckoutId, triageWorkspaceId } from '../worktrees';
import { type Core, type ManagerServices, Part } from './core';

/** Stuck pull requests: the room's operations officer looks at one and does one thing about it. */
export class Triages extends Part {
  /** The operations officer's look at a stuck PR, by prKey: stopped when the PR goes or the manager re-tests it. */
  private readonly triageRuns: FiberMap.FiberMap<string, TriageResult, never>;
  /** One triage at a time per room. */
  private readonly triageLock: PartitionedSemaphore.PartitionedSemaphore<string>;

  constructor(core: Core) {
    super(core);
    this.triageRuns = this.runtime.runSync(FiberMap.make<string, TriageResult, never>().pipe(Scope.provide(core.scope)));
    this.triageLock = this.runtime.runSync(PartitionedSemaphore.make<string>({ permits: 1 }));
  }

  /** The PR is stuck: the room's operations officer looks at it first, unless they've had their tries. */
  stuck(review: QaReview, reason: string): void {
    const officer = plannerFor(review.projectId).name;
    const step = whenStuck(review, officer, reason);
    if (step.kind === 'needs-you') return this.needsYou(review, step.reason);
    const triaging: QaReview = { ...review, triages: (review.triages ?? 0) + 1, followUp: { kind: 'triaging', officer, activity: 'Coming over to look' } };
    this.core.reviews.putReview(triaging);
    // one at a time per room, in the order they got stuck
    this.background(this.triageLock.withPermit(review.projectId)(this.triage(triaging, reason)));
  }

  /** Stops the operations officer looking at the PR, if they are: the manager stepped in, or the PR went. */
  stopTriage(key: string): void {
    if (FiberMap.hasUnsafe(this.triageRuns, key)) this.runtime.runFork(FiberMap.remove(this.triageRuns, key));
  }

  /** The operations officer reads QA's reports, the checks, the diff and the issue, then does one thing about it. */
  private triage(review: QaReview, reason: string): Effect.Effect<void, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const officer = plannerFor(review.projectId);
      const key = prKey(review.repo, review.number);
      // the manager may have stepped in meanwhile (a re-test, a merge), and then it's not the officer's any more
      const current = () => {
        const now = this.store.reviews.get(key);
        return now?.followUp?.kind === 'triaging' ? now : undefined;
      };
      const activity = (text: string) => {
        const now = current();
        if (now && text) this.core.reviews.putReview({ ...now, followUp: { kind: 'triaging', officer: officer.name, activity: truncate(text, 120) } });
      };
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const triager = yield* Triage;
      let pr: PullRequestDetail | undefined;
      // the look itself, which a re-test or the PR going stops (stopTriage)
      const look: Effect.Effect<TriageResult, never> = Effect.gen({ self: this }, function* () {
        const project = this.store.project(review.projectId);
        activity('Reading the pull request');
        pr = yield* github.getPullRequest(review.repo, review.number);
        const checks = this.failingChecks(review);
        const [diff, linked] = yield* Effect.all([
          github.pullRequestDiff(review.repo, review.number).pipe(Effect.catch((err) => Effect.succeed(`(couldn't get the diff: ${err.message})`))),
          Effect.forEach(pr.linkedIssues.slice(0, 3), (n) => github.getIssue(review.repo, n).pipe(Effect.orElseSucceed(() => null)), { concurrency: 'unbounded' }),
        ], { concurrency: 'unbounded' });
        activity('Checking out the pull request');
        const id = triageWorkspaceId(review.projectId);
        yield* workspace.checkoutPullRequest(review.repo, id, review.number);
        if (!current()) return { error: 'The manager stepped in' };
        const decision = yield* triager.triage(
          {
            projectId: project.id,
            projectName: project.name,
            officer,
            repo: review.repo,
            pr,
            cwd: workspace.dir(reviewCheckoutId(id, review.repo, review.number)),
            reason,
            review,
            checks,
            diff,
            issues: linked.filter((i) => i !== null),
            settings: this.store.settings,
          },
          activity,
        );
        return { decision };
      }).pipe(
        Effect.catch((err) => Effect.succeed<TriageResult>({ error: err.message })),
        Effect.catchDefect((defect) => Effect.succeed<TriageResult>({ error: errorMessage(defect) })),
      );
      const exit = yield* Fiber.await(yield* FiberMap.run(this.triageRuns, key, look));
      const now = current();
      if (!now || !Exit.isSuccess(exit)) return;
      const result = exit.value;
      const decided = 'decision' in result ? { ...now, triage: { officer: officer.name, ...result.decision, at: Date.now() } } : now;
      if ('decision' in result) this.core.ledger.record(review.projectId, { kind: 'triage', repo: review.repo, pr: review.number, goal: this.core.leads.leadWith(review.repo, review.number)?.lead?.title, officer: officer.name, ...result.decision });
      yield* this.afterTriage(decided, afterTriage(officer.name, result, { closes: pr?.linkedIssues ?? [] }));
    });
  }

  /** Does what the operations officer decided. `review.triage` is their decision, if they came to one. */
  private afterTriage(review: QaReview, step: TriageStep): Effect.Effect<void, never, ManagerServices> {
    if (step.kind === 'needs-you') return Effect.sync(() => this.needsYou(review, step.reason));
    const officer = plannerFor(review.projectId).name;
    const where = `${review.repo.split('/')[1]}#${review.number}`;
    const backToQa = (why: string) => {
      this.core.reviews.putReview({ ...review, followUp: undefined });
      this.core.reviews.requestReview(review.projectId, review.repo, review.number, review.title, `${officer}, the room's operations officer, ${why} because it was stuck: ${step.note}`);
    };
    return Effect.gen({ self: this }, function* () {
      switch (step.kind) {
        case 'retry-qa':
          backToQa('sent it back to you');
          break;
        case 'send-back':
          yield* this.core.reviews.sendBack(review, { kind: 'qa' }, step.note);
          break;
        case 'rerun-checks': {
          const runIds = [...new Set(this.failingChecks(review).flatMap((c) => (c.runId ? [c.runId] : [])))];
          yield* (yield* GitHub).rerunFailedRuns(review.repo, runIds);
          const runs = runIds.length;
          backToQa(`re-ran ${runs} failed GitHub Actions run${runs === 1 ? '' : 's'} and sent it back to you`);
          break;
        }
        case 'close':
          yield* this.closeStuck(review, step.note);
          break;
      }
      this.hub.toast('info', `${triageLabel({ officer, action: step.kind })} (${where}): ${truncate(step.note, 120)}`, undefined, review.projectId);
    }).pipe(
      Effect.catch((err) => Effect.sync(() => this.needsYou(review, `${officer} chose ${step.kind} but it failed (${err.message})`))),
      Effect.catchDefect((defect) => Effect.sync(() => this.needsYou(review, `${officer} chose ${step.kind} but it failed (${errorMessage(defect)})`))),
    );
  }

  /** The PR's failing checks, as of the board's last look at GitHub: fresh enough for which checks are red. */
  private failingChecks(review: QaReview): FailedCheck[] {
    return this.store.boards.get(review.projectId)?.prs.find((p) => p.repo === review.repo && p.number === review.number)?.failedChecks ?? [];
  }

  /** Closes a PR whose approach can't work. Its issues stay open, marked on the board, for a fresh attempt. */
  private closeStuck(review: QaReview, note: string): Effect.Effect<void, GitHubError, GitHub> {
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const officer = plannerFor(review.projectId).name;
      const pr = yield* github.getPullRequest(review.repo, review.number);
      const comment = `🧭 ${officer}, the Focus office's operations officer, closed this pull request: ${note}\n\n${pr.linkedIssues.map((n) => `#${n}`).join(', ')} stays open, so it gets built again.`;
      yield* github.closePullRequest(review.repo, review.number, comment);
      for (const issue of pr.linkedIssues) this.store.putClosedPr({ repo: review.repo, issue, pr: review.number, officer, note, at: Date.now() });
      this.core.seating.prClosed(review.repo, review.number, false, 'officer');
      this.boardChanged(review.projectId);
    });
  }

  /** The office stops sending the PR back: it's the manager's call now. */
  needsYou(review: QaReview, reason: string): void {
    this.core.reviews.putReview({ ...review, followUp: { kind: 'needs-you', reason } });
    this.hub.toast('error', `🙋 ${review.repo.split('/')[1]}#${review.number} needs you: ${reason}`, undefined, review.projectId);
  }
}
