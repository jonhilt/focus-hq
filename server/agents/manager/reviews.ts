import { Effect } from 'effect';
import { plannerFor, qaFor, qaOfficerFor } from '../../../shared/crew';
import { goneReply } from '../../../shared/mergeGate';
import { autoSendBackFor, prKey, pullUrl, sameCommit } from '../../../shared/qa';
import type { Agent, FailedCheck, FixFor, QaReport, QaReview, QaScreenshot } from '../../../shared/types';
import { QA_DESK } from '../../../shared/types';
import { GitHub, type GitHubError } from '../../github/service';
import { decodeImage, errorMessage, newId, slugify, truncate } from '../../util';
import { goalOf, goalReviewerId, reviewsToStart, sliceSiblings } from '../lead';
import { repoFolders } from '../planner';
import { checksFixPrompt, evidencePath, filesPrompt, fixPrompt, keptCaptions, parseQaReport, qaAgentModel, qaComment, qaPrompt, type QaSibling, qaSystemAppend, skimmed, unaccounted } from '../qa';
import type { QaLoopEvent } from '../qaLoop';
import { qaNextStep } from '../qaLoop';
import { carriedComment, retestStep } from '../retest';
import { Workspace } from '../services';
import { reviewCheckoutId, reviewRepoId, triageWorkspaceId } from '../worktrees';
import { STOPPED_BY_CAPTAIN } from '../types';
import { FINISHED, type ManagerServices, Part, Refused, type WorkError } from './core';

/** Each room has one QA officer; their agent record is reused from review to review. */
const qaAgentId = (projectId: string) => `qa_${projectId}`;

/** QA reviews of pull requests: the queue, seating a reviewer, their verdict, and sending a failed PR back to be fixed. */
export class Reviews extends Part {
  /** PRs back for QA whose new commits the office is looking at first, to see whether QA needs to test them again. */
  private prechecking = new Set<string>();

  /** Asks the room's QA officer to review and test a pull request. Queued if they're busy with another. */
  /**
   * `retryNote` tells QA why the operations officer sent it back to them. Unless the captain `asked` for it, or the
   * operations officer did, a PR QA already gave a verdict on is looked at first (`precheck`).
   */
  requestReview(projectId: string, repo: string, number: number, title: string, retryNote?: string, asked = false): QaReview {
    const project = this.store.project(projectId);
    if (!project.repos.includes(repo)) throw new Refused({ message: `${repo} is not connected to ${project.name}` });
    const existing = this.store.reviews.get(prKey(repo, number));
    if (existing && (existing.status === 'queued' || existing.status === 'testing')) return existing;
    // a re-test from the board overrides the operations officer
    this.core.triages.stopTriage(prKey(repo, number));
    const review: QaReview = {
      projectId,
      repo,
      number,
      title,
      status: 'queued',
      requestedAt: Date.now(),
      openedByOffice: this.core.seating.openedByOffice(repo, number),
      failedRounds: existing?.failedRounds,
      lastRound: existing?.report ? { sha: existing.sha, report: existing.report } : existing?.lastRound,
      triages: existing?.triages,
      triage: existing?.triage,
      retryNote,
      mergeRequested: existing?.mergeRequested,
    };
    this.putReview(review);
    if (existing?.sha && (existing.status === 'passed' || existing.status === 'failed') && !retryNote && !asked) {
      this.prechecking.add(prKey(repo, number));
      this.background(this.precheck(review, existing));
    } else {
      this.nextReview(projectId);
    }
    return review;
  }

  /** Remembers (or, with `on` false, forgets) that the captain wants the PR merged once QA passes it; office.ts merges it. */
  requestMerge(repo: string, number: number, on: boolean): QaReview {
    const review = this.store.reviews.get(prKey(repo, number));
    if (!review) throw new Refused({ message: `QA isn't reviewing ${repo}#${number}` });
    if (on && review.status !== 'queued' && review.status !== 'testing') throw new Refused({ message: `QA isn't testing ${repo}#${number} right now` });
    const next = { ...review, mergeRequested: on ? { at: Date.now() } : undefined };
    this.putReview(next);
    return next;
  }

  /**
   * Before QA re-tests a PR they gave a verdict on: a head they already tested goes back to that verdict, and one that
   * only merged the base branch in, cleanly, on top of a pass gets the project's checks run by the office, which carries
   * the pass over when they're green. Anything else, or anything that goes wrong on the way, goes to QA as usual.
   */
  private precheck(review: QaReview, last: QaReview): Effect.Effect<void, never, ManagerServices> {
    const key = prKey(review.repo, review.number);
    const where = `${review.repo.split('/')[1]}#${review.number}`;
    const current = () => this.store.reviews.get(key)?.requestedAt === review.requestedAt && this.store.reviews.get(key)?.status === 'queued';
    // the captain may ask for (or take back) a merge when QA passes while the office looks: keep what they asked last
    const mergeRequested = () => this.store.reviews.get(key)?.mergeRequested;
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const pr = yield* github.getPullRequest(review.repo, review.number);
      const since = last.status === 'passed' && last.sha && pr.headSha && !sameCommit(last.sha, pr.headSha)
        ? yield* workspace.sinceVerdict(review.repo, review.number, pr.baseBranch, last.sha).pipe(Effect.orElseSucceed(() => null))
        : null;
      const step = retestStep(last, pr.headSha, since);
      if (!current()) return;
      if (step.kind === 'skip') {
        console.log(`Not sending ${review.repo}#${review.number} to QA: ${step.reason}`);
        this.putReview({ ...last, mergeRequested: mergeRequested() });
        this.boardChanged(review.projectId);
        return;
      }
      if (step.kind === 'retest') return;
      this.hub.toast('info', `🧪 ${where} only merged ${pr.baseBranch} in since QA passed it: running its checks instead of a full re-test`, undefined, review.projectId);
      const run = yield* workspace.runChecks(review.repo, review.number, step.head).pipe(Effect.orElseSucceed(() => null));
      const failed = run?.results.find((r) => !r.ok);
      if (!run || failed || !current()) {
        if (failed) console.log(`${review.repo}#${review.number}: ${failed.command} failed after merging ${pr.baseBranch}, so QA re-tests it: ${failed.output ?? ''}`);
        return;
      }
      const body = carriedComment(pr.baseBranch, step.head, step.passed, run.results.map((r) => r.command));
      const commentUrl = yield* github.commentOnPullRequest(review.repo, review.number, body).pipe(Effect.map((url) => url || undefined), Effect.orElseSucceed(() => undefined));
      // the PR may have merged or closed while the comment went up
      if (!current()) return;
      this.putReview({ ...last, status: 'passed', sha: step.head, carriedFrom: last.sha, commentUrl: commentUrl ?? last.commentUrl, mergeRequested: mergeRequested(), requestedAt: review.requestedAt, finishedAt: Date.now() });
      this.hub.toast('success', `✅ ${where} stays passed: merge of ${pr.baseBranch} only, checks green at ${step.head.slice(0, 7)}`, undefined, review.projectId);
      this.boardChanged(review.projectId);
    }).pipe(
      Effect.catchCause((cause) => Effect.sync(() => console.warn(`Couldn't look at ${review.repo}#${review.number} before QA: ${String(cause)}`))),
      Effect.ensuring(Effect.sync(() => {
        this.prechecking.delete(key);
        this.nextReview(review.projectId);
      })),
    );
  }

  /**
   * Seats reviewers on queued reviews, oldest first, as they come free: a goal's pull requests go to the goal's own
   * reviewer, at its lead's table, and everyone else's to the room's QA officer, so the room's goals are reviewed side by
   * side.
   */
  nextReview(projectId: string): void {
    const leads = this.store.agentsIn(projectId).filter((a) => a.task === 'lead');
    const queued = [...this.store.reviews.values()].filter((r) => r.projectId === projectId && r.status === 'queued' && !this.prechecking.has(prKey(r.repo, r.number)));
    const reviewerOf = (r: QaReview) => {
      const goal = goalOf(r, leads);
      return goal ? goalReviewerId(goal.id) : qaAgentId(projectId);
    };
    const busy = (id: string) => {
      const reviewer = this.store.agents.get(id);
      return !!reviewer && !FINISHED.includes(reviewer.status);
    };
    for (const { review, reviewer } of reviewsToStart(queued, reviewerOf, busy)) this.seatReviewer(projectId, reviewer, review, goalOf(review, leads));
    this.core.seating.schedule();
  }

  /** Puts the room's QA officer, or `goal`'s own reviewer, on `review`: the same person every time. */
  private seatReviewer(projectId: string, id: string, review: QaReview, goal: Agent | undefined): void {
    const project = this.store.project(projectId);
    const current = this.store.agents.get(id);
    const others = this.store.agentsIn(projectId).filter((a) => a.id !== id && (a.task === 'lead' || a.reviewFor)).map((a) => a.name);
    const crew = current ?? (goal ? qaFor(projectId, goal.id, others) : qaOfficerFor(projectId));
    const url = `https://github.com/${review.repo}/pull/${review.number}`;
    const agent: Agent = {
      id,
      name: crew.name,
      avatar: crew.avatar,
      projectId,
      repo: review.repo,
      task: 'review',
      reviewFor: goal?.id,
      // GitHub numbers pull requests and issues alike; a QA officer's "issue" is the PR under test
      issue: { number: review.number, title: review.title, url },
      model: qaAgentModel(this.store.settings),
      effort: project.qaEffort,
      desk: QA_DESK,
      status: 'queued',
      activity: 'Waiting for a free slot',
      branch: `qa/pr-${review.number}`,
      baseBranch: current?.baseBranch ?? 'main',
      costUsd: 0,
      startedAt: Date.now(),
    };
    this.core.runtimes.set(id, { inbox: [], notes: [], nudged: false, busy: false });
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    const where = goal ? ` at ${goal.name}'s table, for “${goal.lead?.title ?? 'their goal'}”` : '';
    this.print(agent, [{ kind: 'system', text: `──────── ✻ ${crew.name} picks up ${review.repo}#${review.number} for QA${where}: ${review.title}` }]);
    this.putReview({ ...review, agentId: id });
  }

  launchReview(agent: Agent): Effect.Effect<void, WorkError, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const project = this.store.project(agent.projectId);
      const pr = yield* github.getPullRequest(agent.repo, agent.issue.number);
      const linked = yield* Effect.forEach(pr.linkedIssues.slice(0, 3), (n) => github.getIssue(agent.repo, n).pipe(Effect.orElseSucceed(() => null)), { concurrency: 'unbounded' });
      const issues = linked.filter((i) => i !== null);
      this.update(agent, { baseBranch: pr.baseBranch, issue: { number: pr.number, title: pr.title, url: pr.url }, activity: 'Checking out the pull request' });
      this.print(agent, [{ kind: 'system', text: `✻ Checking out PR #${pr.number} (${pr.branch} into ${pr.baseBranch})` }]);
      const sha = (yield* workspace.checkoutPullRequest(agent.repo, this.reviewDir(agent), pr.number)) || pr.headSha;
      yield* this.install(agent, workspace.dir(this.reviewDir(agent)));
      rt.qaFiles = { changed: yield* workspace.changedFiles(workspace.dir(this.reviewDir(agent)), pr.baseBranch), askedAgain: false };
      const siblings = this.siblingsOf(agent);
      if (siblings.length) {
        this.update(agent, { activity: `Checking out the slice's other pull request${siblings.length === 1 ? '' : 's'}` });
        for (const s of siblings) {
          s.sha = yield* workspace.checkoutPullRequest(s.repo, reviewRepoId(agent.id, { repo: agent.repo, number: pr.number }, s.folder), s.number).pipe(
            Effect.map((at) => at || s.sha),
            Effect.catch((err) => Effect.sync(() => {
              s.error = err.message;
              return undefined;
            })),
          );
        }
        this.print(agent, [{ kind: 'system', text: `✻ Checked out the slice's other PRs beside it: ${siblings.map((s) => `../${s.folder} (${s.repo}#${s.number}${s.error ? ', failed' : ''})`).join(', ')}` }]);
      }
      if (!this.store.agents.has(agent.id) || agent.status === 'stopped') return;
      const review = this.store.reviews.get(prKey(agent.repo, pr.number));
      if (review) this.putReview({ ...review, status: 'testing', title: pr.title, sha, agentId: agent.id, error: undefined });
      rt.qaSystem = qaSystemAppend(agent, project, pr, sha, siblings);
      rt.shots = undefined;
      let prompt = qaPrompt(agent.repo, pr, issues, review ?? {}, rt.qaFiles.changed);
      if (rt.inbox.length) prompt += `\n\nNotes from your manager:\n${rt.inbox.splice(0).map((m) => `- ${m}`).join('\n')}`;
      yield* this.core.sessions.runSession(agent, prompt);
    });
  }

  /** Which folder a repo's checkout goes in, in a review's folder: the one it has in a lead's workspace. */
  private folderOf(projectId: string, repo: string): string {
    return repoFolders(this.store.project(projectId).repos).get(repo) ?? repo.split('/')[1];
  }

  /** Where the reviewer tests their PR (in data/workspaces): the session's current directory. */
  reviewDir(agent: Agent): string {
    return reviewRepoId(agent.id, { repo: agent.repo, number: agent.issue.number }, this.folderOf(agent.projectId, agent.repo));
  }

  /** The other PRs of the slice the reviewer's PR is part of, with the folders they go in beside it. */
  private siblingsOf(agent: Agent): QaSibling[] {
    const pr = { repo: agent.repo, number: agent.issue.number };
    const project = this.store.project(agent.projectId);
    const goal = goalOf(pr, this.store.agentsIn(agent.projectId).filter((a) => a.task === 'lead'));
    return sliceSiblings(pr, goal)
      .filter((s) => project.repos.includes(s.repo))
      .map((s) => ({ repo: s.repo, number: s.number, folder: this.folderOf(agent.projectId, s.repo), sha: s.sha }));
  }

  /** The QA officer's instructions; rebuilt from GitHub if the office restarted since the review began. */
  qaSystem(agent: Agent): Effect.Effect<string, GitHubError, GitHub> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      if (!rt.qaSystem) {
        const pr = yield* (yield* GitHub).getPullRequest(agent.repo, agent.issue.number);
        const sha = this.store.reviews.get(prKey(agent.repo, agent.issue.number))?.sha ?? pr.headSha;
        rt.qaSystem = qaSystemAppend(agent, this.store.project(agent.projectId), pr, sha, this.siblingsOf(agent));
      }
      return rt.qaSystem;
    });
  }

  /** Records the QA officer's verdict, posts it on the pull request, and moves on to the next review. */
  finishReview(agent: Agent, structured: unknown, text: string): Effect.Effect<void, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const number = agent.issue.number;
      const report = parseQaReport(structured, text);
      if (!report) {
        this.core.sessions.fail(agent, 'Finished without a QA report. Send them a message to ask for one, or send the PR to QA again.');
        return;
      }
      // the PR merged or closed while they were at it: a verdict now would land on a PR that's gone
      if (agent.prGone) return;
      // a report that leaves changed files out goes back to QA once, naming them: a reviewer that skims a big diff
      // misses what's in the files it skipped (docs/qa-catch.md)
      const files = this.rt(agent.id).qaFiles;
      const missing = files && !files.askedAgain ? unaccounted(report, files.changed) : [];
      const unread = files && !files.askedAgain ? skimmed(report) : [];
      if (files && (missing.length || unread.length) && agent.sessionId) {
        files.askedAgain = true;
        const n = missing.length + unread.length;
        this.print(agent, [{ kind: 'system', text: `✻ The report leaves out or only skimmed ${n} changed file${n === 1 ? '' : 's'}: back to QA to review ${n === 1 ? 'it' : 'them'} properly` }]);
        return yield* this.core.sessions.runSession(agent, filesPrompt(missing, unread), agent.sessionId).pipe(
          Effect.catch((err) => Effect.sync(() => this.core.sessions.fail(agent, err.message))),
        );
      }
      const pass = report.verdict === 'pass';
      const review = this.store.reviews.get(prKey(agent.repo, number));
      const screenshots = yield* this.keepScreenshots(agent, report, review?.sha);
      this.update(agent, { activity: 'Posting the QA report on the PR' });
      const body = qaComment(report, { officer: agent.name, sha: review?.sha, pr: pullUrl(agent.repo, number) }, screenshots, this.store.settings.attribution);
      const commentUrl = yield* (yield* GitHub).commentOnPullRequest(agent.repo, number, body).pipe(
        Effect.tap((url) => Effect.sync(() => this.print(agent, [{ kind: 'system', text: `✻ Posted the QA report: ${url || 'done'}` }]))),
        Effect.map((url) => url || undefined),
        Effect.catch((err) => Effect.sync(() => {
          this.print(agent, [{ kind: 'error', text: `✘ Couldn't post the QA report on the PR: ${err.message}` }]);
          return undefined;
        })),
      );
      const failedRounds = (review?.failedRounds ?? 0) + (pass ? 0 : 1);
      const checks = { pass: 0, fail: 0, skip: 0 };
      for (const c of report.checks) checks[c.result]++;
      this.core.ledger.record(agent.projectId, { kind: 'qa-verdict', repo: agent.repo, pr: number, goal: this.core.leads.leadWith(agent.repo, number)?.lead?.title, verdict: report.verdict, sha: review?.sha, reviewer: agent.name, checks, failedRounds });
      const done: QaReview | undefined = review && { ...review, status: pass ? 'passed' : 'failed', report, screenshots, commentUrl, failedRounds, finishedAt: Date.now(), error: undefined };
      if (done) this.putReview(done);
      this.print(agent, [{ kind: pass ? 'success' : 'error', text: `${pass ? '✅ QA passed' : '❌ QA failed'} PR #${number} · ${report.checks.length} checks` }]);
      this.update(agent, { status: 'done', activity: `${pass ? '✅ Passed' : '❌ Failed'} PR #${number}`, finishedAt: Date.now() });
      this.hub.toast(pass ? 'success' : 'error', `${pass ? '✅' : '❌'} ${agent.name} ${pass ? 'passed' : 'failed'} ${agent.repo.split('/')[1]}#${number}: ${truncate(report.summary, 120)}`, agent.id);
      this.boardChanged(agent.projectId);
      if (done) yield* this.qaNext(done, { kind: 'verdict', verdict: report.verdict, failedRounds });
      this.core.ledger.digestSession(agent, [{ repo: agent.repo, pr: number }]);
      const lead = this.core.leads.leadWith(agent.repo, number);
      if (lead) this.core.ledger.refreshFlow(lead.id);
      yield* this.core.leads.leadShielded(agent.projectId, agent.repo, number, report, failedRounds, screenshots);
      this.core.leads.leadHearsVerdict(agent.repo, number, `QA officer ${agent.name}`, report, failedRounds);
      this.nextReview(agent.projectId);
    });
  }

  /**
   * Keeps the QA officer's screenshots for the station and uploads them to the repo's QA evidence branch. One that
   * fails to upload stays out of the PR comment, and the error goes to their terminal.
   */
  private keepScreenshots(agent: Agent, report: QaReport, sha: string | undefined): Effect.Effect<QaScreenshot[], never, GitHub> {
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const rt = this.rt(agent.id);
      const { taken, frames } = rt.shots ?? { taken: 0, frames: [] };
      rt.shots = undefined;
      const images = frames.map((f) => (f.image ? decodeImage(f.image) : null));
      const captions = keptCaptions(report.captions, taken, frames.length);
      const at = Date.now();
      const screenshots: QaScreenshot[] = [];
      if (frames.length) this.update(agent, { activity: `Uploading ${frames.length} screenshot${frames.length === 1 ? '' : 's'}` });
      for (const [i, image] of images.entries()) {
        if (!image) continue;
        const file = `${slugify(agent.repo)}-${agent.issue.number}-${at}-${i + 1}.${image.ext}`;
        this.store.saveShot(file, image.bytes);
        const shot: QaScreenshot = { caption: captions[i], file };
        shot.url = yield* github.uploadQaEvidence(agent.repo, evidencePath(agent.issue.number, sha, at, i, image.ext), image.bytes).pipe(
          Effect.catch((err) => Effect.sync(() => {
            this.print(agent, [{ kind: 'error', text: `✘ Couldn't upload screenshot ${i + 1} ("${truncate(shot.caption, 60)}"): ${err.message}` }]);
            return undefined;
          })),
        );
        screenshots.push(shot);
      }
      const uploaded = screenshots.filter((s) => s.url).length;
      if (uploaded) this.print(agent, [{ kind: 'system', text: `✻ Uploaded ${uploaded} screenshot${uploaded === 1 ? '' : 's'} to the QA evidence branch` }]);
      return screenshots;
    });
  }

  // ---------------------------------------------------------------- sending failed PRs back

  /** Acts on what qaNextStep decides for a PR after a verdict or a fix. */
  private qaNext(review: QaReview, event: QaLoopEvent): Effect.Effect<void, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const project = this.store.projects.find((p) => p.id === review.projectId);
      if (!project) return;
      const step = qaNextStep({ openedByOffice: !!review.openedByOffice, autoSendBack: autoSendBackFor(project) }, event);
      switch (step.kind) {
        case 'nothing':
          if (review.followUp) this.putReview({ ...review, followUp: undefined });
          return;
        case 'send-back':
          return yield* this.sendBack(review, { kind: 'qa' });
        case 'needs-you':
          return this.core.triages.stuck(review, step.reason);
      }
    });
  }

  /** A passed PR whose checks on GitHub keep failing goes back to be fixed, like one QA failed. */
  sendBackChecks(repo: string, number: number, checks: FailedCheck[]): Promise<void> {
    const review = this.store.reviews.get(prKey(repo, number));
    if (!review) throw new Refused({ message: `QA hasn't reviewed ${repo}#${number}` });
    return this.runtime.runPromise(this.sendBack(review, { kind: 'checks', checks }));
  }

  /**
   * Hands QA's findings, or the failing checks, to the developer who opened the PR, if they're still in the office;
   * otherwise a new agent sits down on the PR's branch to fix it.
   */
  /** `note` is the operations officer's advice, when they're the one sending it back. */
  sendBack(review: QaReview, fixes: FixFor, note?: string): Effect.Effect<void, never, GitHub> {
    return Effect.gen({ self: this }, function* () {
      const { report } = review;
      if (!report) return;
      const where = `${review.repo.split('/')[1]}#${review.number}`;
      const why = fixes.kind === 'qa' ? 'failed QA' : 'keeps failing its checks';
      if (fixes.kind === 'checks') this.core.ledger.record(review.projectId, { kind: 'checks-sent-back', repo: review.repo, pr: review.number, goal: this.core.leads.leadWith(review.repo, review.number)?.lead?.title, checks: fixes.checks.map((c) => c.name) });
      const advice = note && `${plannerFor(review.projectId).name}, the operations officer, looked at why this PR is stuck: ${note}`;
      const owner = this.core.seating.prOwner(review.repo, review.number);
      if (owner) {
        this.putReview({ ...review, followUp: { kind: 'fixing', agentId: owner.id, agentName: owner.name, fixes } });
        const prompt = this.fixPromptFor(owner, review, report, fixes);
        this.core.comms.message(owner.id, advice ? `${prompt}\n\n${advice}` : prompt);
        this.hub.toast('info', `🔧 ${where} ${why} – back to ${owner.name}`, owner.id);
        return;
      }
      const pr = yield* (yield* GitHub).getPullRequest(review.repo, review.number);
      const agent = this.core.seating.seat(review.projectId, review.repo, {
        id: newId('agent'),
        task: 'fix',
        issue: { number: pr.number, title: pr.title, url: pr.url },
        branch: pr.branch,
        baseBranch: pr.baseBranch,
        pr: { number: pr.number, url: pr.url },
      });
      if (advice) this.rt(agent.id).inbox.push(advice);
      this.putReview({ ...review, followUp: { kind: 'fixing', agentId: agent.id, agentName: agent.name, fixes } });
      this.hub.toast('info', `🔧 ${where} ${why} – ${agent.name} sits down to fix it`, agent.id);
    }).pipe(
      // a full room throws from seat(): it's the manager's call then, like any other failure to send it back
      Effect.catchDefect((defect) => Effect.sync(() => this.core.triages.needsYou(review, `it couldn't be sent back (${errorMessage(defect)})`))),
      Effect.catch((err) => Effect.sync(() => this.core.triages.needsYou(review, `it couldn't be sent back (${err.message})`))),
    );
  }

  fixPromptFor(agent: Agent, review: QaReview, report: QaReport, fixes: FixFor): string {
    const pr = { number: review.number, branch: agent.branch };
    switch (fixes.kind) {
      case 'qa':
        return fixPrompt(pr, { sha: review.sha, report }, agent.cloud);
      case 'checks':
        return checksFixPrompt(pr, review.sha, fixes.checks, agent.cloud);
    }
  }

  /** The failed review this agent was sent to fix, while it's still theirs. */
  fixing(agent: Agent): QaReview | undefined {
    if (!agent.pr) return undefined;
    const review = this.store.reviews.get(prKey(agent.repo, agent.pr.number));
    return review?.followUp?.kind === 'fixing' && review.followUp.agentId === agent.id ? review : undefined;
  }

  fixEnded(agent: Agent, outcome: Extract<QaLoopEvent, { kind: 'fix-ended' }>['outcome']): void {
    const review = this.fixing(agent);
    if (review) this.background(this.qaNext(review, { kind: 'fix-ended', by: agent.name, outcome }));
  }

  /** A review that ended without a verdict (stopped, failed, or its PR went away). */
  reviewEnded(agent: Agent, error: string): void {
    const review = this.store.reviews.get(prKey(agent.repo, agent.issue.number));
    if (review && (review.status === 'testing' || review.status === 'queued')) this.putReview({ ...review, status: 'error', error, finishedAt: Date.now() });
    // don't start the next review under the captain's nose when they stopped this one on purpose; otherwise once this
    // one's wound down
    if (error !== STOPPED_BY_CAPTAIN) this.background(Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => this.nextReview(agent.projectId)))));
  }

  /**
   * The PR is merged or closed: forget its review, and stop any QA officer on it for good, so a message can't resume
   * their session and post a verdict on a PR that's gone.
   */
  reviewGone(repo: string, number: number, merged: boolean): void {
    for (const qa of [...this.store.agents.values()]) {
      if (qa.task !== 'review' || qa.repo !== repo || qa.issue.number !== number || qa.prGone) continue;
      const gone = merged ? 'merged' : 'closed';
      this.update(qa, { prGone: gone });
      this.rt(qa.id).inbox.length = 0;
      if (!FINISHED.includes(qa.status)) {
        this.print(qa, [{ kind: 'system', text: `✻ ${goneReply(number, gone)}: stopping` }]);
        this.core.comms.stop(qa.id);
      }
    }
    const review = this.store.reviews.get(prKey(repo, number));
    if (!review) return;
    this.core.triages.stopTriage(prKey(repo, number));
    // each reviewer kept a checkout of this PR for re-tests: nobody needs them now
    const reviewers = new Set([review.agentId ?? qaAgentId(review.projectId), qaAgentId(review.projectId), triageWorkspaceId(review.projectId)]);
    this.background(Workspace.use((w) => Effect.forEach(reviewers, (id) => w.remove(repo, reviewCheckoutId(id, repo, number)), { discard: true })));
    this.store.removeReview(repo, number);
    this.hub.send({ type: 'review-removed', repo, number });
    this.nextReview(review.projectId);
  }

  putReview(review: QaReview): void {
    if (this.store.putReview(review)) this.hub.send({ type: 'review', review });
  }
}
