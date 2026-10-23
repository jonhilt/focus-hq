import { Effect } from 'effect';
import { plannerFor, qaFor, qaOfficerFor } from '../../../shared/crew';
import { goneReply } from '../../../shared/mergeGate';
import { autoSendBackFor, prKey, pullUrl, qaProofFor, qaVideoFor, sameCommit } from '../../../shared/qa';
import { qaChatChange, qaChatTurns, qaSettingsNow } from '../../../shared/qaChat';
import { qaWhoLine } from '../../../shared/qaPlaybook';
import type { Agent, FailedCheck, FixFor, Project, QaChatReply, QaPlaybook, QaRecording, QaReport, QaReview, QaScreenshot, TermLine } from '../../../shared/types';
import { QA_DESK } from '../../../shared/types';
import { GitHub, type GitHubError } from '../../github/service';
import { decodeImage, errorMessage, newId, slugify, truncate } from '../../util';
import { goalOf, goalReviewerId, reviewsToStart, sliceSiblings } from '../lead';
import { repoFolders } from '../planner';
import { checksFixPrompt, evidencePath, filesPrompt, filesToRevisit, fixPrompt, openedFiles, postedAlready, type Revisit, toolCalls, keptCaptions, parseQaReport, qaAgentModel, qaComment, qaPlaybook, qaPrompt, type QaSibling, qaSystemAppend, recordingPath, repoChecks, verdictMark } from '../qa';
import { clock } from '../recording';
import type { QaLoopEvent } from '../qaLoop';
import { qaNextStep } from '../qaLoop';
import { PROOF_MS, prove } from '../qaProof';
import { carriedComment, retestStep, shippedSinceTested } from '../retest';
import { leftWithoutVerdict, type Reported, type ReviewFact, type ReviewRecovery, resumedFacts, reviewRecovery } from '../reviewJournal';
import { recovery } from '../runJournal';
import { QaChat, Recordings, Workspace } from '../services';
import { reviewCheckoutId, reviewRepoId, triageWorkspaceId } from '../worktrees';
import { STOPPED_BY_CAPTAIN } from '../types';
import { FINISHED, type ManagerServices, Part, Refused, type WorkError } from './core';

/** Each room has one QA officer; their agent record is reused from review to review. */
const qaAgentId = (projectId: string) => `qa_${projectId}`;

/** QA reviews of pull requests: the queue, seating a reviewer, their verdict, and sending a failed PR back to be fixed. */
export class Reviews extends Part {
  /** PRs back for QA whose new commits Ops is looking at first, to see whether QA needs to test them again. */
  private prechecking = new Set<string>();

  /** Asks the room's QA officer to review and test a pull request. Queued if they're busy with another. */
  /**
   * `retryNote` tells QA why the operations officer sent it back to them. Unless the captain `asked` for it, or the
   * operations officer did, a PR QA already gave a verdict on is looked at first (`precheck`). `shippedHead` is the
   * commit a lead's ship just pushed: one that lands while QA is already at the PR goes back to them once they finish.
   */
  requestReview(projectId: string, repo: string, number: number, title: string, retryNote?: string, asked = false, shippedHead?: string): QaReview {
    const project = this.store.project(projectId);
    if (!project.repos.includes(repo)) throw new Refused({ message: `${repo} is not connected to ${project.name}` });
    const key = prKey(repo, number);
    const existing = this.store.reviews.get(key);
    if (existing && (existing.status === 'queued' || existing.status === 'testing')) {
      if (!shippedHead) return existing;
      return this.record(key, { kind: 'head-shipped', sha: shippedHead }) ?? existing;
    }
    // a re-test from the board overrides the operations officer
    this.core.triages.stopTriage(key);
    // what the last round left (failed rounds, its report, a merge asked for) carries over in the journal
    const review = this.record(key, { kind: 'requested', projectId, repo, number, title, openedByOffice: this.core.seating.openedByOffice(repo, number), ...(shippedHead && { head: shippedHead }), ...(retryNote && { retryNote }) });
    if (!review) throw new Refused({ message: `${repo}#${number} can't be sent to QA` });
    if (existing?.sha && (existing.status === 'passed' || existing.status === 'failed') && !retryNote && !asked) {
      this.prechecking.add(key);
      this.record(key, { kind: 'prechecking' });
      this.background(this.precheck(review, existing));
    } else {
      this.nextReview(projectId);
    }
    return review;
  }

  /** Remembers (or, with `on` false, forgets) that the captain wants the PR merged once QA passes it; Ops merges it (focus.ts). */
  requestMerge(repo: string, number: number, on: boolean): QaReview {
    const review = this.store.reviews.get(prKey(repo, number));
    if (!review) throw new Refused({ message: `QA isn't reviewing ${repo}#${number}` });
    if (on && review.status !== 'queued' && review.status !== 'testing') throw new Refused({ message: `QA isn't testing ${repo}#${number} right now` });
    return this.record(prKey(repo, number), { kind: 'merge-requested', on }) ?? review;
  }

  /**
   * Before QA re-tests a PR they gave a verdict on: a head they already tested goes back to that verdict, and one that
   * only merged the base branch in, cleanly, on top of a pass gets the project's checks run by Ops, which carries
   * the pass over when they're green. Anything else, or anything that goes wrong on the way, goes to QA as usual.
   */
  private precheck(review: QaReview, last: QaReview): Effect.Effect<void, never, ManagerServices> {
    const key = prKey(review.repo, review.number);
    const where = `${review.repo.split('/')[1]}#${review.number}`;
    const current = () => this.store.reviews.get(key)?.requestedAt === review.requestedAt && this.store.review(key).phase === 'precheck';
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const pr = yield* github.getPullRequest(review.repo, review.number);
      // GitHub can still answer with the commit before a push for a few seconds: the one the ship pushed is the head
      const head = this.store.reviews.get(key)?.shippedHead || pr.headSha;
      const since = last.status === 'passed' && last.sha && head && !sameCommit(last.sha, head)
        ? yield* workspace.sinceVerdict(review.repo, review.number, pr.baseBranch, last.sha).pipe(Effect.orElseSucceed(() => null))
        : null;
      const step = retestStep(last, head, since);
      if (!current()) return;
      if (step.kind === 'skip') {
        console.log(`Not sending ${review.repo}#${review.number} to QA: ${step.reason}`);
        // the last verdict stands, with any merge the captain asked for meanwhile
        this.record(key, { kind: 'precheck-skipped' });
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
      this.record(key, { kind: 'precheck-carried', sha: step.head, ...(commentUrl && { commentUrl }) });
      this.hub.toast('success', `✅ ${where} stays passed: merge of ${pr.baseBranch} only, checks green at ${step.head.slice(0, 7)}`, undefined, review.projectId);
      this.boardChanged(review.projectId);
    }).pipe(
      Effect.catchCause((cause) => Effect.sync(() => console.warn(`Couldn't look at ${review.repo}#${review.number} before QA: ${String(cause)}`))),
      Effect.ensuring(Effect.sync(() => {
        this.prechecking.delete(key);
        // anything but a verdict that stands or carries over goes to QA
        if (this.store.review(key).phase === 'precheck') this.record(key, { kind: 'precheck-retest' });
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
    this.core.freshRuntime(id);
    this.store.putAgent(agent);
    this.hub.send({ type: 'agent', agent });
    const where = goal ? ` at ${goal.name}'s table, for “${goal.lead?.title ?? 'their goal'}”` : '';
    this.print(agent, [{ kind: 'system', text: `──────── ✻ ${crew.name} picks up ${review.repo}#${review.number} for QA${where}: ${review.title}` }]);
    this.record(prKey(review.repo, review.number), { kind: 'seated', agent: id });
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
      if (review) this.record(prKey(agent.repo, pr.number), { kind: 'testing', sha, title: pr.title });
      rt.qaSystem = qaSystemAppend(agent, project, pr, sha, siblings, yield* this.checksIn(agent));
      rt.shots = undefined;
      if (qaVideoFor(project)) yield* (yield* Recordings).start(agent.id);
      let prompt = qaPrompt(agent.repo, pr, issues, review ?? {}, rt.qaFiles.changed);
      if (rt.inbox.length) prompt += `\n\nNotes from your manager:\n${rt.inbox.take().map((m) => `- ${m}`).join('\n')}`;
      yield* this.core.sessions.runSession(agent, prompt);
    });
  }

  /** The captain's message picked the reviewer's conversation back up: their PR's review is under test by them again (`resumedFacts`). */
  resumed(agent: Agent): void {
    const key = prKey(agent.repo, agent.issue.number);
    for (const fact of resumedFacts(this.store.review(key), agent.id)) this.record(key, fact);
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

  /**
   * The QA officer's instructions; rebuilt from GitHub and their checkout if Focus restarted since the review began,
   * when the recording of their browser starts again too (what it had so far went with the restart).
   */
  qaSystem(agent: Agent): Effect.Effect<string, GitHubError, GitHub | Workspace | Recordings> {
    return Effect.gen({ self: this }, function* () {
      const rt = this.rt(agent.id);
      if (!rt.qaSystem) {
        const pr = yield* (yield* GitHub).getPullRequest(agent.repo, agent.issue.number);
        const sha = this.store.reviews.get(prKey(agent.repo, agent.issue.number))?.sha ?? pr.headSha;
        const project = this.store.project(agent.projectId);
        rt.qaSystem = qaSystemAppend(agent, project, pr, sha, this.siblingsOf(agent), yield* this.checksIn(agent));
        if (qaVideoFor(project)) yield* (yield* Recordings).start(agent.id);
      }
      return rt.qaSystem;
    });
  }

  /** The commands of the repo's checks in the reviewer's checkout, for step 3 of QA's instructions: none, and QA works them out. */
  private checksIn(agent: Agent): Effect.Effect<string[], never, Workspace> {
    return Effect.gen({ self: this }, function* () {
      const workspace = yield* Workspace;
      const facts = yield* workspace.packageFacts(workspace.dir(this.reviewDir(agent)));
      return repoChecks(agent.repo, facts, this.store.project(agent.projectId).mergeChecks).commands;
    });
  }

  /** The QA station's Playbook: what QA does on the project, from its instructions as they'd be now and the clone Ops keeps of each repo. */
  playbook(projectId: string): Promise<QaPlaybook> {
    return this.runtime.runPromise(this.playbookOf(this.store.project(projectId)));
  }

  private playbookOf(project: Project): Effect.Effect<QaPlaybook, never, Workspace> {
    return Effect.gen(function* () {
      const workspace = yield* Workspace;
      const repos = yield* Effect.forEach(project.repos, (repo) => workspace.cloneFacts(repo).pipe(Effect.map((facts) => repoChecks(repo, facts, project.mergeChecks))));
      return qaPlaybook(qaOfficerFor(project.id).name, project, repos);
    });
  }

  /**
   * The QA officer's answer to the captain at the Playbook (`messages`: the talk so far, from the client), given the
   * Playbook as it is: what it says, and the change it proposes, kept to the settings it may change and those that
   * differ from how they are now. It changes nothing: applying it is the captain's (PATCH /projects/:id).
   */
  async chat(projectId: string, messages: unknown): Promise<QaChatReply> {
    const project = this.store.project(projectId);
    const turns = qaChatTurns(messages);
    const settings = this.store.settings;
    return this.runtime.runPromise(Effect.gen({ self: this }, function* () {
      const playbook = yield* this.playbookOf(project);
      const now = qaSettingsNow(project);
      const answer = yield* (yield* QaChat).answer({ officer: qaOfficerFor(projectId).name, projectName: project.name, playbook, now, who: qaWhoLine(settings, project.qaEffort), turns, settings });
      // weighed against the settings as they are once it answers, in case the captain changed one meanwhile
      const change = qaChatChange(answer.change, qaSettingsNow(this.store.project(projectId)));
      return { reply: answer.reply, ...(change && { change }) };
    }));
  }

  /**
   * The changed files QA's session opened, from its tool calls in its transcript, when Ops can read it (not in
   * the demo, nor for a cloud session): both rounds, when it was sent back.
   */
  private openedBy(agent: Agent): Effect.Effect<Set<string> | undefined> {
    const files = this.rt(agent.id).qaFiles;
    const read = this.core.ledger.readTranscript;
    const sessionId = agent.sessionId;
    return Effect.promise(async () => {
      if (!files || !read || !sessionId || agent.cloud) return undefined;
      const text = await read(sessionId).catch(() => undefined);
      return text ? openedFiles(toolCalls(text), files.changed) : undefined;
    });
  }

  /** Sends QA back once, in the same session, to the changed files its report left out or only skimmed, or it never opened. */
  private revisitFiles(agent: Agent, sessionId: string, revisit: Revisit): Effect.Effect<void, never, ManagerServices> {
    const files = this.rt(agent.id).qaFiles;
    const n = revisit.missing.length + revisit.unread.length + revisit.unopened.length;
    if (files) {
      files.askedAgain = true;
      files.sentBack = n;
    }
    this.print(agent, [{ kind: 'system', text: `✻ The report leaves out, only skimmed or never opened ${n} changed file${n === 1 ? '' : 's'}: back to QA to review ${n === 1 ? 'it' : 'them'} properly` }]);
    return this.core.sessions.runSession(agent, filesPrompt(revisit), sessionId).pipe(
      Effect.catch((err) => Effect.sync(() => this.core.sessions.fail(agent, err.message))),
    );
  }

  /**
   * Checks the proofs QA's report names in QA's own checkout, before anything is posted: runs each test and check, looks
   * up each screenshot (`prove`). The report to post: a fail none of whose proofs held is a pass with advice.
   */
  private proveReport(agent: Agent, report: QaReport, changed: readonly string[], shots: { taken: number; kept: number }): Effect.Effect<QaReport, never, Workspace> {
    return Effect.gen({ self: this }, function* () {
      if (report.verdict === 'pass' && !report.proofs?.length) return report;
      const workspace = yield* Workspace;
      const dir = workspace.dir(this.reviewDir(agent));
      const n = report.proofs?.length ?? 0;
      if (n) {
        this.update(agent, { activity: `Running QA's proof${n === 1 ? '' : 's'}` });
        this.print(agent, [{ kind: 'system', text: `✻ Ops checks ${n === 1 ? 'the proof' : `the ${n} proofs`} QA named before posting the report` }]);
      }
      const proven = yield* prove(report, { run: (args) => workspace.runIn(dir, args, PROOF_MS), read: (file) => workspace.readIn(dir, file), changed, shots });
      for (const p of proven.proofs ?? []) {
        const what = p.kind === 'test' ? p.file : p.kind === 'check' ? p.command : `screenshot ${p.screenshot ?? '?'}`;
        this.print(agent, [{ kind: p.outcome === 'failed' ? 'success' : 'system', text: `${p.outcome === 'failed' ? '✓ Proof holds' : '✗ Not proof'}: ${what}${p.note ? ` (${p.note})` : ''}` }]);
      }
      if (proven.advisory) this.print(agent, [{ kind: 'system', text: '✻ QA failed it, but no proof held: the verdict is a pass, with QA\'s findings as advice' }]);
      return proven;
    });
  }

  /**
   * Records the QA officer's verdict, posts it on the pull request, and moves on to the next review. Their session's
   * over: a review it leaves under test, with no report, or with Ops failing part way through finishing it, ends
   * without a verdict and goes to the captain (`leftWithoutVerdict`).
   */
  finishReview(agent: Agent, structured: unknown, text: string): Effect.Effect<void, never, ManagerServices> {
    return this.takeReport(agent, structured, text).pipe(
      Effect.catchDefect((defect) => Effect.sync(() => this.endWithoutVerdict(agent, `Ops couldn't finish their report: ${errorMessage(defect)}`))),
      Effect.tap(() => Effect.sync(() => this.sessionOver(agent, true))),
    );
  }

  /** Takes the QA officer's report: proves it, keeps their screenshots, and records and delivers the verdict. */
  private takeReport(agent: Agent, structured: unknown, text: string): Effect.Effect<void, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const number = agent.issue.number;
      const said = parseQaReport(structured, text);
      if (!said) {
        this.endWithoutVerdict(agent, 'Finished without a QA report. Send them a message to ask for one, or send the PR to QA again.');
        return;
      }
      // the PR merged or closed while they were at it: a verdict now would land on a PR that's gone
      if (agent.prGone) return;
      // a report that leaves changed files out goes back to QA once, naming them: a reviewer that skims a big diff
      // misses what's in the files it skipped (seen when bugs planted in merged PRs went uncaught; docs/qa.md)
      const files = this.rt(agent.id).qaFiles;
      const opened = yield* this.openedBy(agent);
      const revisit = filesToRevisit(said, files, opened);
      if (revisit && agent.sessionId) return yield* this.revisitFiles(agent, agent.sessionId, revisit);
      // the verdict blocks only with proof Ops checked itself (docs/qa.md#proof)
      const shots = this.rt(agent.id).shots;
      const report = qaProofFor(this.store.project(agent.projectId))
        ? yield* this.proveReport(agent, said, files?.changed ?? [], { taken: shots?.taken ?? 0, kept: shots?.frames.length ?? 0 })
        : said;
      if (agent.prGone) return;
      const review = this.store.reviews.get(prKey(agent.repo, number));
      const screenshots = yield* this.keepScreenshots(agent, report, review?.sha);
      const recording = yield* this.keepRecording(agent, review?.sha);
      const account = files && { changed: files.changed, opened: opened && [...opened], sentBack: files.sentBack };
      // marked as this verdict's own, so a restart can tell whether it went up (`deliverVerdict`)
      const body = `${qaComment(report, { officer: agent.name, sha: review?.sha, pr: pullUrl(agent.repo, number) }, screenshots, this.store.settings.attribution, account, recording)}${verdictMark(newId('verdict'))}`;
      const failedRounds = (review?.failedRounds ?? 0) + (report.verdict === 'pass' ? 0 : 1);
      // the verdict's on disk before it goes anywhere: a restart from here on posts it and tells everyone (`deliverVerdict`)
      this.record(prKey(agent.repo, number), { kind: 'reported', verdict: report.verdict, officer: agent.name, body, failedRounds, report, screenshots, files: account, sha: review?.sha });
      yield* this.deliverVerdict(agent.projectId, agent.repo, number);
    });
  }

  /**
   * Puts the verdict the PR's review journal holds onto the pull request, unless it's there already, then tells everyone
   * who hears of one: the board and ledger, the reviewer's station, whoever fixes a failed PR, and the PR's lead. From a
   * review's end, or at startup for one Focus shut down part way through.
   */
  private deliverVerdict(projectId: string, repo: string, number: number, recovering = false): Effect.Effect<void, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const key = prKey(repo, number);
      let journal = this.store.review(key);
      const agent = this.reviewerOn(repo, number);
      if (typeof journal.phase === 'object' && journal.phase.reported === 'posting' && journal.reported) {
        const body = journal.reported.body;
        // after a restart the comment may have gone up just as Focus went down: look before posting it again
        // (and if GitHub can't say, post it: twice beats never)
        const there = recovering && postedAlready(yield* GitHub.use((github) => github.pullRequestComments(repo, number)).pipe(Effect.orElseSucceed((): string[] => [])), body);
        const url = there ? undefined : yield* this.postVerdict(agent, repo, number, body);
        this.record(key, { kind: 'posted', ...(url && { url }) });
        journal = this.store.review(key);
      }
      if (journal.reported) yield* this.announceVerdict(projectId, repo, number, journal.reported, agent);
    });
  }

  /** The QA officer at work on the PR, while they still are. */
  private reviewerOn(repo: string, number: number): Agent | undefined {
    const seated = this.store.reviews.get(prKey(repo, number))?.agentId;
    const reviewer = seated ? this.store.agents.get(seated) : undefined;
    return reviewer?.task === 'review' && reviewer.repo === repo && reviewer.issue.number === number ? reviewer : undefined;
  }

  /** Comments the verdict on the PR: its link, or undefined when GitHub wouldn't take it (said in the reviewer's terminal). */
  private postVerdict(agent: Agent | undefined, repo: string, number: number, body: string): Effect.Effect<string | undefined, never, GitHub> {
    const say = (line: TermLine['kind'], text: string) => Effect.sync(() => agent && this.print(agent, [{ kind: line, text }]));
    if (agent) this.update(agent, { activity: 'Posting the QA report on the PR' });
    return GitHub.use((github) => github.commentOnPullRequest(repo, number, body)).pipe(
      Effect.tap((url) => say('system', `✻ Posted the QA report: ${url || 'done'}`)),
      Effect.map((url) => url || undefined),
      Effect.catch((err) => say('error', `✘ Couldn't post the QA report on the PR: ${err.message}`).pipe(Effect.as(undefined))),
    );
  }

  /** Tells everyone who hears of a verdict: the board and ledger, the reviewer's station, whoever fixes a failed PR, and its lead. */
  private announceVerdict(projectId: string, repo: string, number: number, verdict: Reported & { url?: string }, agent: Agent | undefined): Effect.Effect<void, never, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const { officer, report, screenshots, failedRounds, sha } = verdict;
      const pass = verdict.verdict === 'pass';
      // the board's review has the verdict since it was posted (the journal's `posted`)
      const done = this.store.reviews.get(prKey(repo, number));
      const checks = { pass: 0, fail: 0, skip: 0 };
      for (const c of report.checks) checks[c.result]++;
      this.core.ledger.record(projectId, { kind: 'qa-verdict', repo, pr: number, goal: this.core.leads.leadWith(repo, number)?.lead?.title, verdict: verdict.verdict, sha, reviewer: officer, checks, failedRounds });
      if (agent) this.reviewerDone(agent, pass, number, report.checks.length);
      this.hub.toast(pass ? 'success' : 'error', `${pass ? '✅' : '❌'} ${officer} ${report.advisory ? 'passed, with advice,' : pass ? 'passed' : 'failed'} ${repo.split('/')[1]}#${number}: ${truncate(report.summary, 120)}`, agent?.id);
      this.boardChanged(projectId);
      if (done) yield* this.qaNext(done, { kind: 'verdict', verdict: verdict.verdict, failedRounds });
      yield* this.core.leads.leadShielded(projectId, repo, number, report, failedRounds, screenshots);
      // the lead shipped again while QA tested: the verdict stands for the commit QA had, and QA goes on to the latest
      // (from GitHub's head, which has caught up by now, so a PR someone else pushed past the ship doesn't loop)
      const behind = done?.sha ? shippedSinceTested(done) : undefined;
      this.core.leads.leadHearsVerdict(repo, number, `QA officer ${officer}`, report, failedRounds, behind && done?.sha ? { tested: done.sha, shipped: behind } : undefined);
      this.record(prKey(repo, number), { kind: 'announced' });
      if (done && behind) this.requestReview(done.projectId, done.repo, done.number, done.title);
      this.nextReview(projectId);
    });
  }

  /** The reviewer's station after their verdict: it's in their terminal, they're done, and their session's digested. */
  private reviewerDone(agent: Agent, pass: boolean, number: number, checks: number): void {
    this.print(agent, [{ kind: pass ? 'success' : 'error', text: `${pass ? '✅ QA passed' : '❌ QA failed'} PR #${number} · ${checks} checks` }]);
    this.update(agent, { status: 'done', activity: `${pass ? '✅ Passed' : '❌ Failed'} PR #${number}`, finishedAt: Date.now() });
    this.core.ledger.digestSession(agent, [{ repo: agent.repo, pr: number }]);
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

  /**
   * Edits the recording of the QA officer's browser down and uploads it to the repo's QA evidence branch: nothing when
   * it wasn't recorded or they never acted in the browser. One that can't be edited, or whose MP4 can't be uploaded,
   * stays off the PR comment (without its GIF, the comment links the MP4 alone), and why goes to their terminal.
   */
  private keepRecording(agent: Agent, sha: string | undefined): Effect.Effect<QaRecording | undefined, never, GitHub | Recordings> {
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const failed = (what: string) => (err: { message: string }) => Effect.sync(() => {
        this.print(agent, [{ kind: 'error', text: `✘ Couldn't ${what}: ${err.message}` }]);
        return undefined;
      });
      if (qaVideoFor(this.store.project(agent.projectId))) this.update(agent, { activity: 'Editing the recording of the browser' });
      const edited = yield* (yield* Recordings).finish(agent.id).pipe(Effect.catch(failed('edit the recording of the browser')));
      if (!edited) return undefined;
      const at = Date.now();
      const upload = (ext: string, bytes: Buffer) =>
        github.uploadQaEvidence(agent.repo, recordingPath(agent.issue.number, sha, at, ext), bytes).pipe(Effect.catch(failed(`upload the recording's ${ext.toUpperCase()}`)));
      const mp4Url = yield* upload('mp4', edited.mp4);
      if (!mp4Url) return undefined;
      const gifUrl = edited.gif ? yield* upload('gif', edited.gif) : undefined;
      this.print(agent, [{ kind: 'system', text: `✻ Uploaded the recording of the browser (${clock(edited.realSeconds)} shown in ${clock(edited.shownSeconds)}) to the QA evidence branch` }]);
      return { mp4Url, ...(gifUrl && { gifUrl }), realSeconds: edited.realSeconds, shownSeconds: edited.shownSeconds, actions: edited.actions };
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
          if (review.followUp) this.record(prKey(review.repo, review.number), { kind: 'follow-up' });
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
   * Hands QA's findings, or the failing checks, to the developer who opened the PR, if they're still aboard;
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
        this.record(prKey(review.repo, review.number), { kind: 'follow-up', followUp: { kind: 'fixing', agentId: owner.id, agentName: owner.name, fixes } });
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
      this.record(prKey(review.repo, review.number), { kind: 'follow-up', followUp: { kind: 'fixing', agentId: agent.id, agentName: agent.name, fixes } });
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

  /**
   * Ends the review `agent` left under test without a verdict, now their session's over (`over`: Ops is done with their
   * last turn), and hands it to the captain: their station says why, and the next review in line starts.
   */
  sessionOver(agent: Agent, over = false): void {
    if (agent.task !== 'review') return;
    if (!leftWithoutVerdict(this.store.review(prKey(agent.repo, agent.issue.number)), agent, { closing: this.core.closing, over })) return;
    this.endWithoutVerdict(agent, 'Their session ended without a QA report. Send the PR to QA again.');
  }

  /** The review under test ends without a verdict, the captain's to send to QA again: in a 🙋 toast naming the PR and the reviewer. */
  private endWithoutVerdict(agent: Agent, error: string): void {
    const key = prKey(agent.repo, agent.issue.number);
    const review = this.store.review(key).phase === 'testing' ? this.record(key, { kind: 'ended', error, noVerdict: true }) : undefined;
    if (review) this.core.triages.needsYou(review, `${agent.name} ended QA on #${review.number} without a verdict`);
    // their station: failed, saying why (or as it was, if it already says so), and the next review in line starts
    if (agent.status === 'error') this.reviewEnded(agent, error);
    else this.core.sessions.fail(agent, error);
  }

  /** A review that ended without a verdict (stopped, failed, or its PR went away). */
  reviewEnded(agent: Agent, error: string): void {
    const review = this.store.reviews.get(prKey(agent.repo, agent.issue.number));
    if (review && (review.status === 'testing' || review.status === 'queued')) this.record(prKey(review.repo, review.number), { kind: 'ended', error });
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
      this.rt(qa.id).inbox.clear();
      if (!FINISHED.includes(qa.status)) {
        this.print(qa, [{ kind: 'system', text: `✻ ${goneReply(number, gone)}: stopping` }]);
        this.core.comms.stop(qa.id);
      }
    }
    const review = this.store.reviews.get(prKey(repo, number));
    if (!review) return;
    this.record(prKey(repo, number), { kind: 'gone', merged });
    this.core.triages.stopTriage(prKey(repo, number));
    // each reviewer kept a checkout of this PR for re-tests: nobody needs them now
    const reviewers = new Set([review.agentId ?? qaAgentId(review.projectId), qaAgentId(review.projectId), triageWorkspaceId(review.projectId)]);
    this.background(Workspace.use((w) => Effect.forEach(reviewers, (id) => w.remove(repo, reviewCheckoutId(id, repo, number)), { discard: true })));
    this.nextReview(review.projectId);
  }

  /**
   * Picks reviews back up at startup, from their journals: a verdict in hand goes onto its PR, and one whose reviewer's
   * turn carries on (`Sessions.recover`) carries on with it. Before the reviewers' own runs are recovered, so a reviewer
   * whose review starts again has nothing left to pick up. A PR the operations officer was looking at goes to the
   * captain. The rooms with reviews back in line: their queues move (`nextReview`) once the reviewers' runs are
   * recovered, so one picking their review back up isn't seated on another.
   */
  recover(onKey: boolean): Set<string> {
    const rooms = new Set<string>();
    for (const review of [...this.store.reviews.values()]) {
      const key = prKey(review.repo, review.number);
      if (review.followUp?.kind === 'triaging') this.record(key, { kind: 'follow-up', followUp: { kind: 'needs-you', reason: `${review.followUp.officer} was looking at it when Focus shut down` } });
      const reviewer = review.agentId ? this.store.agents.get(review.agentId) : undefined;
      const next = reviewRecovery(this.store.review(key), reviewer && recovery(this.store.run(reviewer.id), reviewer, onKey).kind);
      if (this.recoverReview(review, reviewer, next)) rooms.add(review.projectId);
    }
    return rooms;
  }

  /** Does what `reviewRecovery` says for one review: true when it's back in its room's queue. */
  private recoverReview(review: QaReview, reviewer: Agent | undefined, next: ReviewRecovery): boolean {
    const key = prKey(review.repo, review.number);
    switch (next.kind) {
      case 'none':
      case 'carry-on':
        return false;
      case 'queue':
        return true;
      case 'retest':
        this.record(key, { kind: 'precheck-retest' });
        return true;
      case 'restart':
        this.record(key, { kind: 'restarted' });
        // their run was setting up: it starts again from nothing when they're seated
        if (reviewer) this.store.journal(reviewer.id, { kind: 'reset' });
        return true;
      case 'interrupted':
        this.record(key, { kind: 'ended', error: next.error });
        return false;
      case 'post':
      case 'announce':
        if (reviewer) this.print(reviewer, [{ kind: 'system', text: `✻ Focus restarted before everyone heard QA's verdict: ${next.kind === 'post' ? 'posting it' : 'passing it on'}` }]);
        this.background(this.deliverVerdict(review.projectId, review.repo, review.number, true));
        return false;
    }
  }

  /**
   * Records a fact in the pull request's review journal (`key` its prKey): the board's review follows from it
   * (`Store.reviewJournal`), and every browser hears. The review as it is now (none once it's gone).
   */
  record(key: string, fact: ReviewFact): QaReview | undefined {
    const before = this.store.reviews.get(key);
    this.store.reviewJournal(key, fact);
    const review = this.store.reviews.get(key);
    if (review) this.hub.send({ type: 'review', review });
    else if (before) this.hub.send({ type: 'review-removed', repo: before.repo, number: before.number });
    return review;
  }
}
